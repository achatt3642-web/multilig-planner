#!/usr/bin/env python3
"""Local, research-only bridge to MAT Planner's knee_bone_masker pipeline.

The bridge deliberately imports MAT Planner's existing pipeline, registry, model
folders, and active Python runtime.  It does not copy model weights or claim
clinical validation.  Its public JSON contracts contain opaque content IDs and
geometry/provenance only; source paths, upload names, and DICOM identifiers are
never emitted.

Commands:
  capabilities
  probe --input <DICOM folder | NIfTI | .tar.gz>
  segment --input <DICOM folder | NIfTI | .tar.gz>
  serve --host 127.0.0.1 --port 4190

The HTTP API accepts uploaded files only.  Arbitrary local paths are available
only to the explicit CLI ``probe`` and ``segment`` commands.
"""

from __future__ import annotations

import argparse
import contextlib
import contextvars
import copy
import datetime as dt
import fcntl
import gzip
import hashlib
import importlib.metadata
import json
import math
import mimetypes
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import threading
import uuid
from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Callable, Iterable, Iterator, Mapping, Protocol, Sequence


BRIDGE_VERSION = "1.1.0"
API_VERSION = "1.0.0"
ADAPTER_ID = "mat-planner-knee-bone-masker-nnunetv2"
VALIDATION_STATE = "research_only"
CAPABILITIES_SCHEMA = "mat-nnunet-capabilities.v1"
PROBE_SCHEMA = "mat-nnunet-probe.v1"
RESULT_SCHEMA = "mat-nnunet-result.v1"
JOB_SCHEMA = "mat-nnunet-job.v1"
VIEWER_MESH_SCHEMA = "mat-viewer-mesh.v1"

DEFAULT_MAT_PLANNER_ROOT = Path(
    __file__
).resolve().parents[2] / Path(
    "Meniscus_project_noOA/MAT_planner_canonical_sync_20260405"
)
DEFAULT_STORAGE_ROOT = Path.home() / ".local" / "share" / "multilig-planner" / "segmentation"
DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024**3
DEFAULT_MAX_EXPANDED_BYTES = 32 * 1024**3
DEFAULT_MIN_FREE_AFTER_BYTES = 4 * 1024**3
DEFAULT_MAX_ARCHIVE_MEMBERS = 250_000
DEFAULT_MAX_COMPRESSION_RATIO = 500.0
DEFAULT_VIEWER_TARGET_FACES = 50_000
DEFAULT_MIN_INFERENCE_WORKING_BYTES = 4 * 1024**3
DEFAULT_API_PORT = 4190
# NIfTI-1 qform/sform fields are float32. Preserve geometry within this
# sub-micrometre serialization bound while still rejecting meaningful shifts.
GEOMETRY_REGISTRATION_TOLERANCE = 1e-5
MAX_MULTIPART_OVERHEAD_BYTES = 2 * 1024**2
REQUIRED_CLIENT_HEADER = "X-Multilig-Client"
REQUIRED_CLIENT_HEADER_VALUE = "1"
ALLOWED_BROWSER_ORIGINS = frozenset({
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    "http://127.0.0.1:4174",
    "http://localhost:4174",
})
SAFE_API_ASSET_KINDS = frozenset({"femur_viewer_mesh", "tibia_viewer_mesh", "patella_viewer_mesh"})

DICOM_LATERALITY_TAGS: tuple[tuple[str, str, str], ...] = (
    ("ImageLaterality", "dicom_image_laterality", "direct"),
    ("Laterality", "dicom_laterality", "direct"),
    ("BodyPartExamined", "dicom_body_part_examined", "description"),
    ("SeriesDescription", "dicom_series_description", "description"),
)
_DESCRIPTION_LEFT = re.compile(r"(?<![A-Z])(LEFT|LT|L)(?![A-Z])", re.IGNORECASE)
_DESCRIPTION_RIGHT = re.compile(r"(?<![A-Z])(RIGHT|RT|R)(?![A-Z])", re.IGNORECASE)

LPS_TO_RAS: list[float] = [
    -1.0, 0.0, 0.0, 0.0,
    0.0, -1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
]
IDENTITY_4: list[float] = [
    1.0, 0.0, 0.0, 0.0,
    0.0, 1.0, 0.0, 0.0,
    0.0, 0.0, 1.0, 0.0,
    0.0, 0.0, 0.0, 1.0,
]


class BridgeError(RuntimeError):
    """Expected user-facing bridge error with a stable machine code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class BridgeConfig:
    mat_planner_root: Path
    storage_root: Path
    registry_path: Path
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES
    max_expanded_bytes: int = DEFAULT_MAX_EXPANDED_BYTES
    min_free_after_bytes: int = DEFAULT_MIN_FREE_AFTER_BYTES
    max_archive_members: int = DEFAULT_MAX_ARCHIVE_MEMBERS
    max_compression_ratio: float = DEFAULT_MAX_COMPRESSION_RATIO
    viewer_target_faces: int = DEFAULT_VIEWER_TARGET_FACES
    min_inference_working_bytes: int = DEFAULT_MIN_INFERENCE_WORKING_BYTES
    api_port: int = DEFAULT_API_PORT

    @classmethod
    def from_values(
        cls,
        mat_planner_root: str | Path | None = None,
        storage_root: str | Path | None = None,
        registry_path: str | Path | None = None,
        **overrides: Any,
    ) -> "BridgeConfig":
        mat_root = Path(
            mat_planner_root
            or os.environ.get("MAT_PLANNER_ROOT")
            or DEFAULT_MAT_PLANNER_ROOT
        ).expanduser().resolve()
        store_root = Path(
            storage_root
            or os.environ.get("MULTILIG_SEGMENTATION_ROOT")
            or DEFAULT_STORAGE_ROOT
        ).expanduser().resolve()
        registry = Path(
            registry_path
            or os.environ.get("MAT_MODEL_REGISTRY")
            or (mat_root / "example_models.yaml")
        ).expanduser().resolve()
        return cls(
            mat_planner_root=mat_root,
            storage_root=store_root,
            registry_path=registry,
            **overrides,
        )


@dataclass(frozen=True)
class SourceDigest:
    source_id: str
    kind: str
    sha256: str
    byte_length: int
    file_count: int

    def public(self, asset_id: str | None = None) -> dict[str, Any]:
        data: dict[str, Any] = {
            "id": self.source_id,
            "kind": self.kind,
            "sha256": self.sha256,
            "byteLength": self.byte_length,
            "fileCount": self.file_count,
            "immutable": True,
        }
        if asset_id:
            data["assetId"] = asset_id
        return data


@dataclass(frozen=True)
class StoredAsset:
    asset_id: str
    kind: str
    sha256: str
    byte_length: int
    media_type: str
    payload_path: Path
    storage_name: str
    api_readable: bool = False

    def public(self) -> dict[str, Any]:
        value = {
            "assetId": self.asset_id,
            "kind": self.kind,
            "sha256": self.sha256,
            "byteLength": self.byte_length,
            "mediaType": self.media_type,
            "immutable": True,
            "apiReadable": self.api_readable,
        }
        if self.api_readable:
            value["url"] = f"/api/segmentation/assets/{self.asset_id}"
        return value


@dataclass(frozen=True)
class ArchiveInspection:
    member_count: int
    file_count: int
    expanded_bytes: int
    compressed_bytes: int
    maximum_depth: int

    def public(self) -> dict[str, Any]:
        return {
            "memberCount": self.member_count,
            "fileCount": self.file_count,
            "expandedBytes": self.expanded_bytes,
            "compressedBytes": self.compressed_bytes,
            "maximumDepth": self.maximum_depth,
            "safeToExtract": True,
        }


@dataclass(frozen=True)
class NiftiInspection:
    version: int
    dimensions: tuple[int, ...]
    datatype_code: int
    bits_per_voxel: int
    voxel_offset: int
    expected_voxel_bytes: int
    uncompressed_bytes: int
    compressed: bool
    compression_ratio: float

    def public(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "dimensions": list(self.dimensions),
            "datatypeCode": self.datatype_code,
            "bitsPerVoxel": self.bits_per_voxel,
            "voxelOffset": self.voxel_offset,
            "expectedVoxelBytes": self.expected_voxel_bytes,
            "uncompressedBytes": self.uncompressed_bytes,
            "compressed": self.compressed,
            "compressionRatio": self.compression_ratio,
            "safeForImageReader": True,
        }


@dataclass(frozen=True)
class ModelEvidence:
    model_id: str
    backend: str
    dataset: str
    trainer: str
    plans: str
    configuration: str
    folds: tuple[int, ...]
    checkpoint_name: str
    model_path: Path
    label_map: Mapping[int, str]


@dataclass(frozen=True)
class RunnerOutcome:
    standardized_mask_path: Path
    binary_mask_paths: Mapping[str, Path]
    raw_model_mask_path: Path | None
    selected_model: ModelEvidence
    selected_series: Mapping[str, Any]
    qc: Mapping[str, Any]
    selected_input_geometry: Mapping[str, Any]
    algorithm_source_sha256: str
    model_artifact_provenance: Mapping[str, Any]


@dataclass(frozen=True)
class ProcessedEvidence:
    artifacts: tuple[StoredAsset, ...]
    coordinate_frames: tuple[Mapping[str, Any], ...]
    geometry: Mapping[str, Any]
    label_inventory: tuple[Mapping[str, Any], ...]
    bones: tuple[Mapping[str, Any], ...]
    qc: Mapping[str, Any]
    warning_codes: tuple[str, ...]


class PipelineRunner(Protocol):
    def run(self, input_path: Path, output_dir: Path) -> RunnerOutcome: ...


class ArtifactProcessor(Protocol):
    def process(
        self,
        outcome: RunnerOutcome,
        store: "AssetStore",
        job_dir: Path,
    ) -> ProcessedEvidence: ...


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def write_bytes_new(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, mode)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def write_json_new(path: Path, value: Any) -> None:
    write_bytes_new(path, json.dumps(value, indent=2, sort_keys=True).encode("utf-8") + b"\n")


def sha256_stream(handle: BinaryIO, limit: int | None = None) -> tuple[str, int]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = handle.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if limit is not None and total > limit:
            raise BridgeError("SOURCE_TOO_LARGE", "The source exceeds the configured byte limit.")
        digest.update(chunk)
    return digest.hexdigest(), total


def sha256_file(path: Path, limit: int | None = None) -> tuple[str, int]:
    with path.open("rb") as handle:
        return sha256_stream(handle, limit=limit)


def _regular_directory_files(path: Path) -> list[Path]:
    files: list[Path] = []
    for candidate in sorted(path.rglob("*"), key=lambda item: item.relative_to(path).as_posix()):
        if candidate.is_symlink():
            raise BridgeError("UNSAFE_SOURCE", "DICOM source folders may not contain symbolic links.")
        try:
            mode = candidate.stat().st_mode
        except OSError as exc:
            raise BridgeError("SOURCE_READ_FAILED", "A source entry could not be inspected.") from exc
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise BridgeError("UNSAFE_SOURCE", "DICOM source folders may contain regular files only.")
        files.append(candidate)
    if not files:
        raise BridgeError("EMPTY_SOURCE", "The source folder does not contain any files.")
    return files


def digest_directory(path: Path, limit: int | None = None) -> SourceDigest:
    digest = hashlib.sha256()
    total = 0
    files = _regular_directory_files(path)
    for candidate in files:
        relative = candidate.relative_to(path).as_posix().encode("utf-8", errors="surrogateescape")
        digest.update(len(relative).to_bytes(8, "big"))
        digest.update(relative)
        with candidate.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if limit is not None and total > limit:
                    raise BridgeError("SOURCE_TOO_LARGE", "The source exceeds the configured byte limit.")
                digest.update(chunk)
    value = digest.hexdigest()
    return SourceDigest(f"source-sha256-{value}", "dicom_folder", value, total, len(files))


def digest_file(path: Path, kind: str, limit: int | None = None) -> SourceDigest:
    value, byte_length = sha256_file(path, limit=limit)
    return SourceDigest(f"source-sha256-{value}", kind, value, byte_length, 1)


def multiply_matrix4(left: Sequence[float], right: Sequence[float]) -> list[float]:
    if len(left) != 16 or len(right) != 16:
        raise ValueError("4x4 matrices require sixteen values")
    output = [0.0] * 16
    for row in range(4):
        for column in range(4):
            output[row * 4 + column] = sum(
                float(left[row * 4 + index]) * float(right[index * 4 + column])
                for index in range(4)
            )
    return output


def invert_matrix4(matrix: Sequence[float]) -> list[float]:
    if len(matrix) != 16 or not all(math.isfinite(float(value)) for value in matrix):
        raise BridgeError("INVALID_TRANSFORM", "A coordinate transform is non-finite or malformed.")
    augmented = [
        [float(matrix[row * 4 + column]) for column in range(4)]
        + [1.0 if row == column else 0.0 for column in range(4)]
        for row in range(4)
    ]
    for column in range(4):
        pivot_row = max(range(column, 4), key=lambda row: abs(augmented[row][column]))
        pivot = augmented[pivot_row][column]
        if abs(pivot) < 1e-12:
            raise BridgeError("INVALID_TRANSFORM", "A coordinate transform is singular.")
        augmented[column], augmented[pivot_row] = augmented[pivot_row], augmented[column]
        augmented[column] = [value / pivot for value in augmented[column]]
        for row in range(4):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                augmented[row][index] - factor * augmented[column][index]
                for index in range(8)
            ]
    return [augmented[row][column] for row in range(4) for column in range(4, 8)]


def transform_point(matrix: Sequence[float], point: Sequence[float]) -> list[float]:
    if len(matrix) != 16 or len(point) != 3:
        raise ValueError("Expected a 4x4 transform and a three-dimensional point")
    x, y, z = (float(value) for value in point)
    raw = [
        matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
        matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
        matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
        matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15],
    ]
    if not math.isfinite(raw[3]) or abs(raw[3]) < 1e-12:
        raise BridgeError("INVALID_TRANSFORM", "A transform produced an invalid homogeneous point.")
    return [raw[index] / raw[3] for index in range(3)]


def matrix_roundtrip_error(matrix: Sequence[float], size: Sequence[int]) -> float:
    inverse = invert_matrix4(matrix)
    extents = [max(0, int(value) - 1) for value in size]
    samples = ([0.0, 0.0, 0.0], [float(extents[0]), float(extents[1]), float(extents[2])])
    maximum = 0.0
    for point in samples:
        recovered = transform_point(inverse, transform_point(matrix, point))
        maximum = max(maximum, *(abs(recovered[index] - point[index]) for index in range(3)))
    return maximum


def voxel_to_lps_matrix(
    spacing: Sequence[float],
    direction: Sequence[float],
    origin: Sequence[float],
) -> list[float]:
    if len(spacing) != 3 or len(direction) != 9 or len(origin) != 3:
        raise BridgeError("INVALID_TRANSFORM", "Image geometry is incomplete.")
    if not all(math.isfinite(float(value)) for value in (*spacing, *direction, *origin)):
        raise BridgeError("INVALID_TRANSFORM", "Image geometry contains non-finite values.")
    if any(float(value) <= 0 for value in spacing):
        raise BridgeError("INVALID_TRANSFORM", "Image spacing must be positive.")
    return [
        float(direction[0]) * float(spacing[0]), float(direction[1]) * float(spacing[1]), float(direction[2]) * float(spacing[2]), float(origin[0]),
        float(direction[3]) * float(spacing[0]), float(direction[4]) * float(spacing[1]), float(direction[5]) * float(spacing[2]), float(origin[1]),
        float(direction[6]) * float(spacing[0]), float(direction[7]) * float(spacing[1]), float(direction[8]) * float(spacing[2]), float(origin[2]),
        0.0, 0.0, 0.0, 1.0,
    ]


def _safe_tar_parts(name: str) -> tuple[str, ...]:
    if not name or "\x00" in name or "\\" in name:
        raise BridgeError("UNSAFE_ARCHIVE", "The archive contains an invalid member path.")
    pure = PurePosixPath(name)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise BridgeError("UNSAFE_ARCHIVE", "The archive contains an unsafe member path.")
    if len(name.encode("utf-8", errors="surrogateescape")) > 1024:
        raise BridgeError("UNSAFE_ARCHIVE", "The archive contains an excessively long member path.")
    return tuple(pure.parts)


def _sanitized_tar_parts(parts: Sequence[str], is_directory: bool) -> tuple[str, ...]:
    """Map archive names to deterministic opaque staging names.

    Directory prefixes remain grouped, which preserves MAT's DICOM container
    discovery, while neither patient-derived folder names nor filenames are
    persisted outside the private source archive.
    """
    normalized = "/".join(parts)
    directory_count = len(parts) if is_directory else max(0, len(parts) - 1)
    output: list[str] = []
    for index in range(directory_count):
        prefix = "/".join(parts[: index + 1]).encode("utf-8", errors="surrogateescape")
        output.append(f"dir-{hashlib.sha256(prefix).hexdigest()[:20]}")
    if not is_directory:
        token = hashlib.sha256(normalized.encode("utf-8", errors="surrogateescape")).hexdigest()[:24]
        output.append(f"file-{token}.bin")
    return tuple(output)


def inspect_tar_archive(path: Path, config: BridgeConfig) -> ArchiveInspection:
    try:
        compressed_bytes = path.stat().st_size
    except OSError as exc:
        raise BridgeError("SOURCE_READ_FAILED", "The archive could not be inspected.") from exc
    if compressed_bytes <= 0:
        raise BridgeError("EMPTY_SOURCE", "The archive is empty.")
    seen: set[tuple[str, ...]] = set()
    member_count = 0
    file_count = 0
    expanded_bytes = 0
    maximum_depth = 0
    try:
        with tarfile.open(path, mode="r:gz") as archive:
            for member in archive:
                member_count += 1
                if member_count > config.max_archive_members:
                    raise BridgeError("ARCHIVE_TOO_MANY_MEMBERS", "The archive contains too many members.")
                parts = _safe_tar_parts(member.name)
                if parts in seen:
                    raise BridgeError("UNSAFE_ARCHIVE", "The archive contains duplicate member paths.")
                seen.add(parts)
                maximum_depth = max(maximum_depth, len(parts))
                if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                    raise BridgeError("UNSAFE_ARCHIVE", "Archive links and special files are not accepted.")
                if not (member.isdir() or member.isreg()):
                    raise BridgeError("UNSAFE_ARCHIVE", "The archive contains an unsupported member type.")
                if member.isreg():
                    if member.size < 0:
                        raise BridgeError("UNSAFE_ARCHIVE", "The archive contains an invalid file size.")
                    file_count += 1
                    expanded_bytes += int(member.size)
                    if expanded_bytes > config.max_expanded_bytes:
                        raise BridgeError("ARCHIVE_TOO_LARGE", "The expanded archive exceeds the configured limit.")
    except BridgeError:
        raise
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise BridgeError("INVALID_ARCHIVE", "The source is not a readable gzip tar archive.") from exc
    if file_count == 0:
        raise BridgeError("EMPTY_SOURCE", "The archive contains no regular files.")
    ratio = expanded_bytes / max(1, compressed_bytes)
    if ratio > config.max_compression_ratio:
        raise BridgeError("ARCHIVE_COMPRESSION_LIMIT", "The archive expansion ratio exceeds the configured limit.")
    return ArchiveInspection(member_count, file_count, expanded_bytes, compressed_bytes, maximum_depth)


def safe_extract_tar(path: Path, destination: Path, config: BridgeConfig) -> ArchiveInspection:
    inspection = inspect_tar_archive(path, config)
    destination.parent.mkdir(parents=True, exist_ok=True)
    free_bytes = shutil.disk_usage(destination.parent).free
    if free_bytes - inspection.expanded_bytes < config.min_free_after_bytes:
        raise BridgeError("INSUFFICIENT_DISK", "Insufficient free space for guarded archive extraction.")
    try:
        destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    except FileExistsError as exc:
        raise BridgeError("OUTPUT_EXISTS", "The extraction destination already exists; nothing was overwritten.") from exc
    try:
        with tarfile.open(path, mode="r:gz") as archive:
            sanitized_targets: set[tuple[str, ...]] = set()
            for member in archive:
                parts = _safe_tar_parts(member.name)
                safe_parts = _sanitized_tar_parts(parts, member.isdir())
                if safe_parts in sanitized_targets:
                    raise BridgeError("UNSAFE_ARCHIVE", "Archive staging-name collision detected.")
                sanitized_targets.add(safe_parts)
                target = destination.joinpath(*safe_parts)
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    raise BridgeError("INVALID_ARCHIVE", "An archive file could not be read.")
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                written = 0
                with source, os.fdopen(descriptor, "wb") as output:
                    while True:
                        chunk = source.read(min(1024 * 1024, int(member.size) - written + 1))
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > int(member.size):
                            raise BridgeError("INVALID_ARCHIVE", "An archive member exceeded its declared size.")
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if written != int(member.size):
                    raise BridgeError("INVALID_ARCHIVE", "An archive member ended before its declared size.")
    except BridgeError:
        raise
    except (tarfile.TarError, OSError, EOFError) as exc:
        raise BridgeError("ARCHIVE_EXTRACTION_FAILED", "Guarded archive extraction failed.") from exc
    return inspection


_ASSET_THREAD_LOCKS: dict[str, threading.Lock] = {}
_ASSET_THREAD_LOCKS_GUARD = threading.Lock()


def require_disk_capacity(path: Path, additional_bytes: int, reserve_bytes: int) -> None:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        free_bytes = shutil.disk_usage(probe).free
    except OSError as exc:
        raise BridgeError("DISK_PREFLIGHT_FAILED", "Available storage could not be measured safely.") from exc
    required = max(0, int(additional_bytes))
    reserve = max(0, int(reserve_bytes))
    if free_bytes - required < reserve:
        raise BridgeError("INSUFFICIENT_DISK", "Insufficient free space for the requested segmentation operation.")


class AssetStore:
    """Append-only, content-addressed local asset store."""

    def __init__(self, root: Path, min_free_after_bytes: int = 0):
        self.root = root
        self.min_free_after_bytes = max(0, int(min_free_after_bytes))
        self.assets_root = root / "assets"
        self.jobs_root = root / "jobs"
        self.incoming_root = root / "incoming"
        self.locks_root = root / "locks" / "assets"
        for directory in (self.assets_root, self.jobs_root, self.incoming_root, self.locks_root):
            directory.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _asset_id(sha256: str) -> str:
        return f"asset-sha256-{sha256}"

    @contextlib.contextmanager
    def hash_lock(self, sha256: str) -> Iterator[None]:
        if not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise BridgeError("INVALID_ASSET_HASH", "The asset hash is invalid.")
        with _ASSET_THREAD_LOCKS_GUARD:
            thread_lock = _ASSET_THREAD_LOCKS.setdefault(sha256, threading.Lock())
        with thread_lock:
            lock_path = self.locks_root / f"{sha256}.lock"
            with lock_path.open("a+b") as lock_handle:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)

    def _verify_asset_payload(self, asset: StoredAsset, metadata: Mapping[str, Any]) -> None:
        if asset.payload_path.is_file():
            actual_hash, actual_length = sha256_file(asset.payload_path)
            if actual_hash != asset.sha256 or actual_length != asset.byte_length:
                raise BridgeError("ASSET_INTEGRITY_FAILED", "A content-addressed asset failed hash verification.")
            return
        if asset.payload_path.is_dir():
            expected_payload_hash = str(metadata.get("payloadSha256", ""))
            expected_payload_length = int(metadata.get("payloadByteLength", -1))
            if not re.fullmatch(r"[0-9a-f]{64}", expected_payload_hash):
                raise BridgeError("ASSET_INTEGRITY_FAILED", "A directory asset lacks verifiable payload metadata.")
            actual = digest_directory(asset.payload_path)
            if actual.sha256 != expected_payload_hash or actual.byte_length != expected_payload_length:
                raise BridgeError("ASSET_INTEGRITY_FAILED", "A directory asset failed payload verification.")
            return
        raise BridgeError("ASSET_INCOMPLETE", "An asset payload is unavailable.")

    def _read_existing(self, asset_id: str) -> StoredAsset:
        directory = self.assets_root / asset_id
        metadata_path = directory / "metadata.json"
        if not metadata_path.is_file():
            raise BridgeError("ASSET_INCOMPLETE", "An existing content-addressed asset is incomplete.")
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            storage_name = str(metadata["storageName"])
            payload = directory / storage_name
            if not payload.exists():
                raise ValueError("payload missing")
            asset = StoredAsset(
                asset_id=asset_id,
                kind=str(metadata["kind"]),
                sha256=str(metadata["sha256"]),
                byte_length=int(metadata["byteLength"]),
                media_type=str(metadata["mediaType"]),
                payload_path=payload,
                storage_name=storage_name,
                api_readable=bool(metadata.get("apiReadable", False)),
            )
            self._verify_asset_payload(asset, metadata)
            return asset
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise BridgeError("ASSET_INCOMPLETE", "An existing content-addressed asset has invalid metadata.") from exc

    def register_file(
        self,
        source: Path,
        kind: str,
        media_type: str,
        suffix: str,
        expected_sha256: str | None = None,
        expected_length: int | None = None,
        api_readable: bool = False,
    ) -> StoredAsset:
        sha256, byte_length = sha256_file(source)
        if expected_sha256 and sha256 != expected_sha256:
            raise BridgeError("SOURCE_HASH_MISMATCH", "The source SHA-256 does not match the declared value.")
        if expected_length is not None and byte_length != expected_length:
            raise BridgeError("SOURCE_LENGTH_MISMATCH", "The source byte length does not match the declared value.")
        asset_id = self._asset_id(sha256)
        with self.hash_lock(sha256):
            asset_dir = self.assets_root / asset_id
            if asset_dir.exists():
                existing = self._read_existing(asset_id)
                if existing.sha256 != sha256 or existing.byte_length != byte_length:
                    raise BridgeError("ASSET_COLLISION", "Content-addressed asset verification failed.")
                return existing
            require_disk_capacity(self.assets_root, byte_length, self.min_free_after_bytes)
            asset_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
            safe_suffix = suffix if re.fullmatch(r"(?:\.[a-z0-9]+){0,2}", suffix) else ""
            storage_name = f"payload{safe_suffix}"
            target = asset_dir / storage_name
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
            with source.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
                shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
                output_handle.flush()
                os.fsync(output_handle.fileno())
            copied_hash, copied_length = sha256_file(target)
            if copied_hash != sha256 or copied_length != byte_length:
                raise BridgeError("ASSET_COPY_FAILED", "A copied asset failed immediate hash verification.")
            metadata = {
                "schemaVersion": "mat-nnunet-asset.v1",
                "assetId": asset_id,
                "kind": kind,
                "sha256": sha256,
                "byteLength": byte_length,
                "mediaType": media_type,
                "storageName": storage_name,
                "immutable": True,
                "apiReadable": bool(api_readable),
                "createdAt": utc_now(),
            }
            write_json_new(asset_dir / "metadata.json", metadata)
            return StoredAsset(asset_id, kind, sha256, byte_length, media_type, target, storage_name, bool(api_readable))

    def register_directory(self, source: Path, digest: SourceDigest) -> StoredAsset:
        asset_id = self._asset_id(digest.sha256)
        with self.hash_lock(digest.sha256):
            asset_dir = self.assets_root / asset_id
            if asset_dir.exists():
                return self._read_existing(asset_id)
            require_disk_capacity(self.assets_root, digest.byte_length, self.min_free_after_bytes)
            asset_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
            payload = asset_dir / "payload"
            payload.mkdir(mode=0o700, exist_ok=False)
            files = _regular_directory_files(source)
            for index, input_path in enumerate(files):
                output_path = payload / f"file-{index:08d}.dcm"
                descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
                with input_path.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
                    shutil.copyfileobj(input_handle, output_handle, length=1024 * 1024)
                    output_handle.flush()
                    os.fsync(output_handle.fileno())
            payload_digest = digest_directory(payload)
            if payload_digest.byte_length != digest.byte_length:
                raise BridgeError("ASSET_COPY_FAILED", "A copied DICOM directory failed byte-length verification.")
            metadata = {
                "schemaVersion": "mat-nnunet-asset.v1",
                "assetId": asset_id,
                "kind": "dicom_source_directory",
                "sha256": digest.sha256,
                "byteLength": digest.byte_length,
                "fileCount": digest.file_count,
                "mediaType": "application/dicom-directory",
                "storageName": "payload",
                "payloadSha256": payload_digest.sha256,
                "payloadByteLength": payload_digest.byte_length,
                "immutable": True,
                "apiReadable": False,
                "createdAt": utc_now(),
            }
            write_json_new(asset_dir / "metadata.json", metadata)
            return StoredAsset(asset_id, "dicom_source_directory", digest.sha256, digest.byte_length, "application/dicom-directory", payload, "payload", False)

    def get(self, asset_id: str) -> StoredAsset:
        if not re.fullmatch(r"asset-sha256-[0-9a-f]{64}", asset_id):
            raise BridgeError("INVALID_ASSET_ID", "The asset ID is invalid.")
        sha256 = asset_id.removeprefix("asset-sha256-")
        with self.hash_lock(sha256):
            return self._read_existing(asset_id)


def detect_source_kind(path: Path) -> str:
    if path.is_dir():
        return "dicom_folder"
    lower = path.name.lower()
    if lower.endswith(".nii") or lower.endswith(".nii.gz"):
        return "nifti"
    if lower.endswith(".tar.gz") or lower.endswith(".tgz"):
        return "dicom_tar_gz"
    raise BridgeError(
        "UNSUPPORTED_SOURCE",
        "Accepted sources are a DICOM folder, NIfTI file, or gzip tar archive.",
    )


def normalize_source_kind(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    aliases = {
        "nifti": "nifti",
        "nifti_mri": "nifti",
        "nii": "nifti",
        "dicom_tar_gz": "dicom_tar_gz",
        "dicom_archive": "dicom_tar_gz",
        "tar_gz": "dicom_tar_gz",
        "dicom_folder": "dicom_folder",
        "dicom_mri": "dicom_folder",
    }
    if normalized not in aliases:
        raise BridgeError("UNSUPPORTED_SOURCE", "The declared source kind is not supported.")
    return aliases[normalized]


def inspect_nifti(path: Path, config: BridgeConfig) -> NiftiInspection:
    datatype_bits = {
        2: 8,
        4: 16,
        8: 32,
        16: 32,
        64: 64,
        256: 8,
        512: 16,
        768: 32,
        1024: 64,
        1280: 64,
    }
    try:
        compressed_bytes = path.stat().st_size
        with path.open("rb") as initial:
            compressed = initial.read(2) == b"\x1f\x8b"
        if compressed:
            with gzip.open(path, "rb") as handle:
                header = handle.read(544)
        else:
            with path.open("rb") as handle:
                header = handle.read(544)
    except (OSError, EOFError, gzip.BadGzipFile) as exc:
        raise BridgeError("INVALID_NIFTI", "The uploaded NIfTI source could not be read.") from exc
    if len(header) < 348:
        raise BridgeError("INVALID_NIFTI", "The uploaded NIfTI header is incomplete.")
    header_size_le = struct.unpack_from("<i", header, 0)[0]
    header_size_be = struct.unpack_from(">i", header, 0)[0]
    if header_size_le in {348, 540}:
        endian = "<"
        header_size = header_size_le
    elif header_size_be in {348, 540}:
        endian = ">"
        header_size = header_size_be
    else:
        raise BridgeError("INVALID_NIFTI", "The NIfTI header-size marker is invalid.")
    if header_size == 348:
        if header[344:348] != b"n+1\x00":
            raise BridgeError("UNSUPPORTED_NIFTI_LAYOUT", "Only single-file NIfTI-1 images are accepted.")
        dimensions_raw = struct.unpack_from(f"{endian}8h", header, 40)
        datatype_code = int(struct.unpack_from(f"{endian}h", header, 70)[0])
        bits_per_voxel = int(struct.unpack_from(f"{endian}h", header, 72)[0])
        raw_offset = float(struct.unpack_from(f"{endian}f", header, 108)[0])
        if not math.isfinite(raw_offset) or abs(raw_offset - round(raw_offset)) > 1e-3:
            raise BridgeError("INVALID_NIFTI", "The NIfTI voxel offset is invalid.")
        voxel_offset = int(round(raw_offset))
        minimum_offset = 352
        version = 1
    else:
        if len(header) < 540 or not header[4:12].startswith(b"n+2\x00"):
            raise BridgeError("UNSUPPORTED_NIFTI_LAYOUT", "Only single-file NIfTI-2 images are accepted.")
        datatype_code = int(struct.unpack_from(f"{endian}h", header, 12)[0])
        bits_per_voxel = int(struct.unpack_from(f"{endian}h", header, 14)[0])
        dimensions_raw = struct.unpack_from(f"{endian}8q", header, 16)
        voxel_offset = int(struct.unpack_from(f"{endian}q", header, 168)[0])
        minimum_offset = 544
        version = 2
    dimensionality = int(dimensions_raw[0])
    if dimensionality < 3 or dimensionality > 7:
        raise BridgeError("INVALID_NIFTI_DIMENSIONS", "A three-dimensional NIfTI image is required.")
    dimensions = tuple(int(value) for value in dimensions_raw[1 : dimensionality + 1])
    if any(value < 1 for value in dimensions) or any(value < 2 for value in dimensions[:3]):
        raise BridgeError("INVALID_NIFTI_DIMENSIONS", "The NIfTI dimensions are invalid for a 3D MRI.")
    if any(value != 1 for value in dimensions[3:]):
        raise BridgeError("UNSUPPORTED_NIFTI_DIMENSIONS", "Multi-volume NIfTI inputs are not accepted.")
    expected_bits = datatype_bits.get(datatype_code)
    if expected_bits is None or bits_per_voxel != expected_bits:
        raise BridgeError("UNSUPPORTED_NIFTI_DATATYPE", "The NIfTI datatype/bit-depth combination is unsupported.")
    if voxel_offset < minimum_offset or voxel_offset > config.max_expanded_bytes:
        raise BridgeError("INVALID_NIFTI_OFFSET", "The NIfTI voxel offset is outside accepted bounds.")
    voxel_count = math.prod(dimensions)
    expected_voxel_bytes = voxel_count * bits_per_voxel // 8
    expected_total = voxel_offset + expected_voxel_bytes
    if expected_total > config.max_expanded_bytes:
        raise BridgeError("NIFTI_TOO_LARGE", "The expanded NIfTI volume exceeds the configured limit.")
    if compressed:
        uncompressed_bytes = 0
        try:
            with gzip.open(path, "rb") as handle:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    uncompressed_bytes += len(chunk)
                    if uncompressed_bytes > config.max_expanded_bytes:
                        raise BridgeError("NIFTI_TOO_LARGE", "The expanded NIfTI volume exceeds the configured limit.")
                    if uncompressed_bytes / max(1, compressed_bytes) > config.max_compression_ratio:
                        raise BridgeError("NIFTI_COMPRESSION_LIMIT", "The NIfTI compression ratio exceeds the configured limit.")
        except BridgeError:
            raise
        except (OSError, EOFError, gzip.BadGzipFile) as exc:
            raise BridgeError("INVALID_NIFTI", "The compressed NIfTI stream is invalid.") from exc
    else:
        uncompressed_bytes = compressed_bytes
    if uncompressed_bytes < expected_total:
        raise BridgeError("TRUNCATED_NIFTI", "The NIfTI payload is shorter than its declared voxel data.")
    ratio = uncompressed_bytes / max(1, compressed_bytes)
    if ratio > config.max_compression_ratio:
        raise BridgeError("NIFTI_COMPRESSION_LIMIT", "The NIfTI compression ratio exceeds the configured limit.")
    return NiftiInspection(
        version=version,
        dimensions=dimensions,
        datatype_code=datatype_code,
        bits_per_voxel=bits_per_voxel,
        voxel_offset=voxel_offset,
        expected_voxel_bytes=expected_voxel_bytes,
        uncompressed_bytes=uncompressed_bytes,
        compressed=compressed,
        compression_ratio=ratio,
    )


def validate_source_file(path: Path, kind: str, config: BridgeConfig) -> ArchiveInspection | NiftiInspection | None:
    if kind == "dicom_tar_gz":
        try:
            with path.open("rb") as handle:
                if handle.read(2) != b"\x1f\x8b":
                    raise BridgeError("INVALID_ARCHIVE", "A DICOM archive must be gzip compressed.")
        except OSError as exc:
            raise BridgeError("SOURCE_READ_FAILED", "The archive could not be read.") from exc
        return inspect_tar_archive(path, config)
    if kind == "nifti":
        return inspect_nifti(path, config)
    if kind == "dicom_folder":
        if not path.is_dir():
            raise BridgeError("INVALID_DICOM_SOURCE", "The DICOM source must be a folder.")
        _regular_directory_files(path)
        return None
    raise BridgeError("UNSUPPORTED_SOURCE", "The source kind is not supported.")


def _add_mat_import_path(config: BridgeConfig) -> None:
    if not config.mat_planner_root.is_dir():
        raise BridgeError("MAT_PLANNER_UNAVAILABLE", "The configured MAT Planner root is unavailable.")
    root_text = str(config.mat_planner_root)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)


def _safe_package_version(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def _mat_revision(config: BridgeConfig) -> str | None:
    try:
        process = subprocess.run(
            ["git", "-C", str(config.mat_planner_root), "rev-parse", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        value = process.stdout.strip().lower()
        return value if process.returncode == 0 and re.fullmatch(r"[0-9a-f]{40,64}", value) else None
    except (OSError, subprocess.SubprocessError):
        return None


def _algorithm_source_hash(config: BridgeConfig) -> str:
    digest = hashlib.sha256()
    package_root = config.mat_planner_root / "knee_bone_masker"
    required = {
        "pipeline.py", "io_utils.py", "router.py", "registry.py", "postprocess.py",
        "preprocess.py", "qc.py", "types.py", "adapters/base.py",
        "adapters/nnunetv2_adapter.py", "adapters/__init__.py", "__init__.py",
    }
    paths = sorted(
        (path for path in package_root.rglob("*.py") if "__pycache__" not in path.parts),
        key=lambda path: path.relative_to(package_root).as_posix(),
    ) if package_root.is_dir() else []
    present = {path.relative_to(package_root).as_posix() for path in paths}
    if not required.issubset(present):
        raise BridgeError("MAT_PIPELINE_INCOMPLETE", "The MAT segmentation pipeline is incomplete.")
    for path in paths:
        relative = f"knee_bone_masker/{path.relative_to(package_root).as_posix()}"
        digest.update(relative.encode("utf-8"))
        file_hash, file_length = sha256_file(path)
        digest.update(file_length.to_bytes(8, "big"))
        digest.update(bytes.fromhex(file_hash))
    registry_hash, registry_length = sha256_file(config.registry_path)
    digest.update(registry_length.to_bytes(8, "big"))
    digest.update(bytes.fromhex(registry_hash))
    return digest.hexdigest()


def _parse_model_folder(model_path: Path) -> tuple[str, str, str, str]:
    parts = model_path.name.split("__")
    if len(parts) != 3:
        return model_path.parent.name or "unknown", "unknown", "unknown", "unknown"
    trainer, plans, configuration = parts
    return model_path.parent.name or "unknown", trainer, plans, configuration


def _load_registry_specs(config: BridgeConfig) -> list[Any]:
    if not config.registry_path.is_file():
        raise BridgeError("REGISTRY_UNAVAILABLE", "The configured MAT model registry is unavailable.")
    _add_mat_import_path(config)
    try:
        from knee_bone_masker.registry import load_model_registry
        return list(load_model_registry(config.registry_path))
    except BridgeError:
        raise
    except Exception as exc:
        raise BridgeError("REGISTRY_INVALID", "The MAT model registry could not be loaded.") from exc


def _model_capability(spec: Any) -> dict[str, Any]:
    model_path = Path(str(spec.model_path or "")).expanduser().resolve() if spec.model_path else None
    dataset, trainer, plans, configuration = _parse_model_folder(model_path) if model_path else ("unknown",) * 4
    folds = [int(value) for value in (spec.use_folds or ())]
    checkpoint_name = str(spec.checkpoint_name or "checkpoint_final.pth")
    checkpoint_available = bool(
        model_path
        and model_path.is_dir()
        and folds
        and all((model_path / f"fold_{fold}" / checkpoint_name).is_file() for fold in folds)
    )
    return {
        "id": str(spec.id),
        "backend": str(spec.backend),
        "dataset": dataset,
        "trainer": trainer,
        "plans": plans,
        "configuration": configuration,
        "folds": folds,
        "checkpointName": checkpoint_name,
        "available": checkpoint_available,
        "checkpointSha256": None,
    }


def capabilities(config: BridgeConfig) -> dict[str, Any]:
    models: list[dict[str, Any]] = []
    import_error: str | None = None
    try:
        models = [_model_capability(spec) for spec in _load_registry_specs(config)]
    except BridgeError as exc:
        import_error = exc.code
    registry_sha256 = None
    if config.registry_path.is_file():
        registry_sha256 = sha256_file(config.registry_path)[0]
    return {
        "schemaVersion": CAPABILITIES_SCHEMA,
        "adapterId": ADAPTER_ID,
        "adapterVersion": BRIDGE_VERSION,
        "apiVersion": API_VERSION,
        "validationState": VALIDATION_STATE,
        "researchUseOnly": True,
        "accepts": ["dicom_tar_gz", "nifti", "dicom_folder_cli_only"],
        "requiredLabels": ["femur", "tibia", "fibula"],
        "producedLabels": ["femur", "tibia", "femur_cartilage", "tibia_cartilage"],
        "models": models,
        "maxUploadBytes": config.max_upload_bytes,
        "maxMultipartOverheadBytes": MAX_MULTIPART_OVERHEAD_BYTES,
        "maxExpandedArchiveBytes": config.max_expanded_bytes,
        "minInferenceWorkingBytes": config.min_inference_working_bytes,
        "requiredClientHeader": {"name": REQUIRED_CLIENT_HEADER, "value": REQUIRED_CLIENT_HEADER_VALUE},
        "registrySha256": registry_sha256,
        "matPlannerRevision": _mat_revision(config),
        "runtime": {
            "python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "nnunetv2": _safe_package_version("nnunetv2"),
            "SimpleITK": _safe_package_version("SimpleITK"),
        },
        "available": import_error is None and any(model["available"] for model in models),
        "unavailableReasonCode": import_error,
        "notices": [
            "Research-only MAT Planner segmentation adapter; not clinically validated.",
            "The current MAT registry has no fibula output label; fibula remains missing.",
            "Availability and successful inference do not constitute clinical validation.",
        ],
    }


def _dicom_container_summaries(root: Path, config: BridgeConfig) -> list[dict[str, Any]]:
    _add_mat_import_path(config)
    try:
        from knee_bone_masker.io_utils import discover_dicom_series
    except Exception as exc:
        raise BridgeError("MAT_PIPELINE_UNAVAILABLE", "MAT DICOM discovery could not be imported.") from exc
    directories = [root] + sorted((path for path in root.rglob("*") if path.is_dir()), key=lambda p: p.relative_to(root).as_posix())
    summaries: list[dict[str, Any]] = []
    for directory in directories:
        try:
            series = list(discover_dicom_series(directory))
        except Exception:
            continue
        if not series:
            continue
        total_files = sum(len(candidate.files) for candidate in series)
        relative = directory.relative_to(root).as_posix() if directory != root else "."
        token = hashlib.sha256(relative.encode("utf-8", errors="surrogateescape")).hexdigest()[:16]
        summaries.append({
            "path": directory,
            "containerId": f"container-{token}",
            "seriesCount": len(series),
            "dicomFileCount": total_files,
            "depth": 0 if directory == root else len(directory.relative_to(root).parts),
        })
    return summaries


def select_dicom_container(root: Path, config: BridgeConfig) -> tuple[Path, list[dict[str, Any]]]:
    summaries = _dicom_container_summaries(root, config)
    if not summaries:
        raise BridgeError("NO_DICOM_SERIES", "No readable DICOM MRI series was found in the source.")
    selected = sorted(
        summaries,
        key=lambda item: (-int(item["dicomFileCount"]), -int(item["seriesCount"]), int(item["depth"]), str(item["containerId"])),
    )[0]
    return Path(selected["path"]), summaries


def _sanitize_container_summary(item: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "containerId": str(item["containerId"]),
        "seriesCount": int(item["seriesCount"]),
        "dicomFileCount": int(item["dicomFileCount"]),
        "depth": int(item["depth"]),
    }


def _image_geometry_from_sitk(image: Any, frame_prefix: str = "source") -> dict[str, Any]:
    size = [int(value) for value in image.GetSize()]
    spacing = [float(value) for value in image.GetSpacing()]
    direction = [float(value) for value in image.GetDirection()]
    origin = [float(value) for value in image.GetOrigin()]
    voxel_to_lps = voxel_to_lps_matrix(spacing, direction, origin)
    voxel_to_ras = multiply_matrix4(LPS_TO_RAS, voxel_to_lps)
    inverse = invert_matrix4(voxel_to_ras)
    error = matrix_roundtrip_error(voxel_to_ras, size)
    if error > 1e-7:
        raise BridgeError("TRANSFORM_ROUNDTRIP_FAILED", "The image transform failed its round-trip check.")
    return {
        "sizeVoxels": size,
        "spacingMm": spacing,
        "originLpsMm": origin,
        "directionLps": direction,
        "voxelToDicomLps": voxel_to_lps,
        "voxelToPatientRas": voxel_to_ras,
        "patientRasToVoxel": inverse,
        "roundTripMaximumError": error,
        "framePrefix": frame_prefix,
    }


def probe_source(input_path: Path, config: BridgeConfig) -> dict[str, Any]:
    path = input_path.expanduser().resolve()
    if not path.exists():
        raise BridgeError("SOURCE_NOT_FOUND", "The requested source does not exist.")
    kind = detect_source_kind(path)
    if kind == "dicom_folder":
        source = digest_directory(path, limit=config.max_upload_bytes)
    else:
        source = digest_file(path, kind, limit=config.max_upload_bytes)
    inspection = validate_source_file(path, kind, config)
    result: dict[str, Any] = {
        "schemaVersion": PROBE_SCHEMA,
        "adapterId": ADAPTER_ID,
        "adapterVersion": BRIDGE_VERSION,
        "validationState": VALIDATION_STATE,
        "researchUseOnly": True,
        "source": source.public(),
        "warnings": ["RESEARCH_ONLY", "LATERALITY_REQUIRES_CLINICIAN_VERIFICATION"],
    }
    if isinstance(inspection, ArchiveInspection):
        result["archive"] = inspection.public()
        result["requiresGuardedExtractionForSeriesProbe"] = True
    elif kind == "dicom_folder":
        selected, summaries = select_dicom_container(path, config)
        selected_summary = next(item for item in summaries if Path(item["path"]) == selected)
        result["dicomContainers"] = [_sanitize_container_summary(item) for item in summaries]
        result["selectedContainerId"] = str(selected_summary["containerId"])
        if len(summaries) > 1:
            result["warnings"].append("MULTIPLE_DICOM_CONTAINERS_DETERMINISTIC_SELECTION")
    else:
        if isinstance(inspection, NiftiInspection):
            result["niftiHeader"] = inspection.public()
        _add_mat_import_path(config)
        try:
            import SimpleITK as sitk
            image = sitk.ReadImage(str(path))
            result["geometry"] = _image_geometry_from_sitk(image)
        except BridgeError:
            raise
        except Exception as exc:
            raise BridgeError("NIFTI_READ_FAILED", "MAT's image runtime could not read the NIfTI source.") from exc
    return result


def _model_evidence_from_spec(spec: Any) -> ModelEvidence:
    model_path = Path(str(spec.model_path or "")).expanduser().resolve()
    dataset, trainer, plans, configuration = _parse_model_folder(model_path)
    return ModelEvidence(
        model_id=str(spec.id),
        backend=str(spec.backend),
        dataset=dataset,
        trainer=trainer,
        plans=plans,
        configuration=configuration,
        folds=tuple(int(value) for value in (spec.use_folds or ())),
        checkpoint_name=str(spec.checkpoint_name or "checkpoint_final.pth"),
        model_path=model_path,
        label_map={int(key): str(value) for key, value in (spec.label_map or {}).items()},
    )


def _empty_laterality_hint(status: str) -> dict[str, Any]:
    return {
        "laterality": None,
        "status": status,
        "confidence": "none",
        "evidence": [],
        "requiresClinicianVerification": True,
    }


def _direct_laterality(value: Any) -> str | None:
    normalized = str(value or "").strip().upper()
    if normalized in {"L", "LEFT"}:
        return "left"
    if normalized in {"R", "RIGHT"}:
        return "right"
    return None


def _description_laterality(value: Any) -> str | None:
    """Return only a side token; never return or retain the source text."""
    normalized = str(value or "").strip().upper()
    if not normalized:
        return None
    has_left = bool(_DESCRIPTION_LEFT.search(normalized))
    has_right = bool(_DESCRIPTION_RIGHT.search(normalized))
    if has_left and has_right:
        return "conflict"
    if not has_left and not has_right:
        return None
    return "left" if has_left else "right"


def resolve_dicom_laterality_metadata(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Resolve a privacy-safe, unverified side hint from selected-series tags.

    Standard DICOM laterality attributes take precedence over descriptive
    tokens. Any disagreement, including a disagreement between a direct tag and
    description, is surfaced as a conflict rather than silently selecting a
    side. The returned evidence contains only tag kinds and normalized sides;
    raw header values and free-form descriptions never enter the public result.
    """
    direct: set[tuple[str, str]] = set()
    descriptions: set[tuple[str, str]] = set()
    for row in rows:
        for keyword, source, evidence_class in DICOM_LATERALITY_TAGS:
            value = row.get(keyword)
            side = _direct_laterality(value) if evidence_class == "direct" else _description_laterality(value)
            if side is None:
                continue
            target = direct if evidence_class == "direct" else descriptions
            if side == "conflict":
                target.update(((source, "left"), (source, "right")))
            else:
                target.add((source, side))

    all_evidence = sorted(
        direct | descriptions,
        key=lambda item: (
            next(index for index, (_keyword, source, _kind) in enumerate(DICOM_LATERALITY_TAGS) if source == item[0]),
            item[1],
        ),
    )
    evidence = [{"source": source, "laterality": side} for source, side in all_evidence]
    direct_sides = {side for _source, side in direct}
    description_sides = {side for _source, side in descriptions}
    all_sides = direct_sides | description_sides
    if len(all_sides) > 1:
        return {
            **_empty_laterality_hint("conflict"),
            "evidence": evidence,
        }
    if direct_sides:
        return {
            "laterality": next(iter(direct_sides)),
            "status": "resolved",
            "confidence": "high",
            "evidence": evidence,
            "requiresClinicianVerification": True,
        }
    if description_sides:
        return {
            "laterality": next(iter(description_sides)),
            "status": "resolved",
            "confidence": "low",
            "evidence": evidence,
            "requiresClinicianVerification": True,
        }
    return _empty_laterality_hint("absent")


def dicom_laterality_hint(files: Iterable[Path]) -> dict[str, Any]:
    """Read only four non-identifying laterality-related fields."""
    try:
        import pydicom
    except ImportError:
        return _empty_laterality_hint("absent")
    rows: list[dict[str, Any]] = []
    keywords = [keyword for keyword, _source, _kind in DICOM_LATERALITY_TAGS]
    for path in files:
        try:
            dataset = pydicom.dcmread(
                str(path),
                stop_before_pixels=True,
                specific_tags=keywords,
                force=False,
            )
        except Exception:
            continue
        rows.append({keyword: getattr(dataset, keyword, None) for keyword in keywords})
    return resolve_dicom_laterality_metadata(rows)


def _selected_series_laterality_hint(config: BridgeConfig, input_path: Path, result: Any) -> dict[str, Any]:
    fingerprint = result.selected_series
    if str(getattr(fingerprint, "source_kind", "")) != "dicom_series":
        return _empty_laterality_hint("not_applicable")
    _add_mat_import_path(config)
    try:
        from knee_bone_masker.io_utils import discover_dicom_series
        selected_series_id = str(getattr(fingerprint, "series_id", "") or "")
        candidates = list(discover_dicom_series(input_path))
        candidate = next((item for item in candidates if str(item.series_id) == selected_series_id), None)
        if candidate is None:
            return _empty_laterality_hint("absent")
        return dicom_laterality_hint(Path(path) for path in candidate.files)
    except Exception:
        # Laterality metadata is advisory. A missing/unsupported header reader
        # must not turn a successful segmentation into a failed job.
        return _empty_laterality_hint("absent")


def _selected_input_geometry(config: BridgeConfig, input_path: Path, result: Any) -> Mapping[str, Any]:
    _add_mat_import_path(config)
    try:
        from knee_bone_masker.io_utils import discover_dicom_series, load_dicom_series, load_nifti
        fingerprint = result.selected_series
        source_kind = str(getattr(fingerprint, "source_kind", ""))
        if source_kind == "nifti":
            image = load_nifti(input_path).image
        elif source_kind == "dicom_series":
            selected_series_id = str(getattr(fingerprint, "series_id", "") or "")
            candidates = list(discover_dicom_series(input_path))
            candidate = next((item for item in candidates if str(item.series_id) == selected_series_id), None)
            if candidate is None:
                raise BridgeError("SOURCE_GEOMETRY_UNAVAILABLE", "The selected DICOM series could not be reloaded for geometry verification.")
            image = load_dicom_series(candidate).image
        else:
            raise BridgeError("SOURCE_GEOMETRY_UNAVAILABLE", "The selected input image kind is unsupported for geometry verification.")
        return _image_geometry_from_sitk(image, frame_prefix="source")
    except BridgeError:
        raise
    except Exception as exc:
        raise BridgeError("SOURCE_GEOMETRY_UNAVAILABLE", "The selected input geometry could not be verified.") from exc


class MatPipelineRunner:
    def __init__(self, config: BridgeConfig):
        self.config = config

    def run(self, input_path: Path, output_dir: Path) -> RunnerOutcome:
        algorithm_before = _algorithm_source_hash(self.config)
        _add_mat_import_path(self.config)
        try:
            from knee_bone_masker.pipeline import BoneMaskPipeline
        except Exception as exc:
            raise BridgeError("MAT_PIPELINE_UNAVAILABLE", "MAT's knee_bone_masker pipeline could not be imported.") from exc
        pipeline = BoneMaskPipeline(registry_path=self.config.registry_path)
        pre_inference_models: dict[str, Mapping[str, Any]] = {}
        for spec in pipeline.specs:
            if str(spec.backend) != "nnunetv2":
                continue
            evidence = _model_evidence_from_spec(spec)
            pre_inference_models[evidence.model_id] = _selected_model_provenance(evidence)
        try:
            result = pipeline.segment(input_path=input_path, outdir=output_dir)
        except Exception as exc:
            raise BridgeError("SEGMENTATION_FAILED", "MAT nnUNet segmentation failed; inspect local job diagnostics.") from exc
        if not result.success or result.output_mask_path is None or result.selected_model is None:
            raise BridgeError("SEGMENTATION_FAILED", "MAT nnUNet segmentation produced no QC-passing mask.")
        if str(result.selected_model.backend) != "nnunetv2":
            raise BridgeError("POLICY_REJECTED_BACKEND", "The selected MAT backend was not nnUNetv2.")
        model = _model_evidence_from_spec(result.selected_model)
        before_model = pre_inference_models.get(model.model_id)
        after_model = _selected_model_provenance(model)
        if before_model is None or canonical_json_bytes(before_model) != canonical_json_bytes(after_model):
            raise BridgeError("MODEL_ARTIFACT_CHANGED", "The selected model artifacts changed during inference.")
        algorithm_after = _algorithm_source_hash(self.config)
        if algorithm_before != algorithm_after:
            raise BridgeError("ALGORITHM_SOURCE_CHANGED", "The MAT segmentation source changed during inference.")
        input_geometry = _selected_input_geometry(self.config, input_path, result)
        selected_attempt = next(
            (
                attempt
                for attempt in result.attempts
                if attempt.passed_qc and str(attempt.model_spec.id) == model.model_id
            ),
            None,
        )
        qc = {}
        if selected_attempt and isinstance(selected_attempt.report, dict):
            raw_qc = selected_attempt.report.get("qc")
            if isinstance(raw_qc, dict):
                qc = copy.deepcopy(raw_qc)
        raw_mask = None
        if selected_attempt and selected_attempt.output_mask_path:
            candidate = selected_attempt.output_mask_path.parent / "nnunet_output" / "case.nii.gz"
            if candidate.is_file():
                raw_mask = candidate
        binary = {
            name: output_dir / f"{name}_mask.nii.gz"
            for name in ("femur", "tibia", "femur_cartilage", "tibia_cartilage")
            if (output_dir / f"{name}_mask.nii.gz").is_file()
        }
        fingerprint = result.selected_series
        selected_series = {
            "sourceKind": str(getattr(fingerprint, "source_kind", "unknown")),
            "numFiles": int(getattr(fingerprint, "num_files", 0) or 0),
            "modality": str(getattr(fingerprint, "modality", "MR") or "MR"),
            "orientation": str(getattr(fingerprint, "orientation", "UNKNOWN") or "UNKNOWN"),
            "axesCode": str(getattr(fingerprint, "axes_code", "") or ""),
            "size": [int(value) for value in (getattr(fingerprint, "size", None) or ())],
            "spacingMm": [float(value) for value in (getattr(fingerprint, "spacing", None) or ())],
            "lateralityHint": _selected_series_laterality_hint(self.config, input_path, result),
        }
        return RunnerOutcome(
            standardized_mask_path=Path(result.output_mask_path),
            binary_mask_paths=binary,
            raw_model_mask_path=raw_mask,
            selected_model=model,
            selected_series=selected_series,
            qc=qc,
            selected_input_geometry=input_geometry,
            algorithm_source_sha256=algorithm_after,
            model_artifact_provenance=after_model,
        )


def _geometry_registration(source: Mapping[str, Any], label: Mapping[str, Any]) -> dict[str, Any]:
    source_size = [int(value) for value in source["sizeVoxels"]]
    label_size = [int(value) for value in label["sizeVoxels"]]
    source_matrix = [float(value) for value in source["voxelToPatientRas"]]
    label_matrix = [float(value) for value in label["voxelToPatientRas"]]
    source_inverse = [float(value) for value in source["patientRasToVoxel"]]
    label_inverse = [float(value) for value in label["patientRasToVoxel"]]
    if (
        len(source_size) != 3
        or len(label_size) != 3
        or any(value < 1 for value in (*source_size, *label_size))
        or any(len(matrix) != 16 for matrix in (source_matrix, label_matrix, source_inverse, label_inverse))
        or not all(
            math.isfinite(value)
            for matrix in (source_matrix, label_matrix, source_inverse, label_inverse)
            for value in matrix
        )
    ):
        raise BridgeError("SOURCE_MASK_GEOMETRY_MISMATCH", "Source or label-map geometry is malformed.")
    if source_size != label_size:
        raise BridgeError("SOURCE_MASK_GEOMETRY_MISMATCH", "The final label map size differs from the selected source image.")
    maximum_matrix_delta = max(abs(a - b) for a, b in zip(source_matrix, label_matrix))
    tolerance = GEOMETRY_REGISTRATION_TOLERANCE
    if maximum_matrix_delta > tolerance:
        raise BridgeError("SOURCE_MASK_GEOMETRY_MISMATCH", "The final label-map physical geometry differs from the selected source image.")
    expected_source_inverse = invert_matrix4(source_matrix)
    expected_label_inverse = invert_matrix4(label_matrix)
    source_inverse_delta = max(abs(a - b) for a, b in zip(source_inverse, expected_source_inverse))
    label_inverse_delta = max(abs(a - b) for a, b in zip(label_inverse, expected_label_inverse))
    if max(source_inverse_delta, label_inverse_delta) > tolerance:
        raise BridgeError("SOURCE_MASK_GEOMETRY_MISMATCH", "A source or label-map inverse transform is inconsistent.")
    source_to_label = multiply_matrix4(label_inverse, source_matrix)
    label_to_source = invert_matrix4(source_to_label)
    identity_delta = max(abs(value - IDENTITY_4[index]) for index, value in enumerate(source_to_label))
    if identity_delta > tolerance:
        raise BridgeError("SOURCE_MASK_GEOMETRY_MISMATCH", "The source-to-label registration is not identity preserving.")
    return {
        "verified": True,
        "sourceFrameId": "source-voxel-ijk",
        "labelFrameId": "label-voxel-ijk",
        "sourceVoxelToLabelVoxel": source_to_label,
        "labelVoxelToSourceVoxel": label_to_source,
        "maximumPhysicalMatrixDelta": maximum_matrix_delta,
        "maximumIdentityDelta": identity_delta,
        "maximumInverseMatrixDelta": max(source_inverse_delta, label_inverse_delta),
        "verificationTolerance": tolerance,
    }


def _coordinate_frames(
    geometry: Mapping[str, Any],
    source_geometry: Mapping[str, Any] | None = None,
) -> tuple[Mapping[str, Any], ...]:
    voxel_to_ras = [float(value) for value in geometry["voxelToPatientRas"]]
    ras_to_voxel = [float(value) for value in geometry["patientRasToVoxel"]]
    ras_to_lps = list(LPS_TO_RAS)
    frames: list[Mapping[str, Any]] = [
        {
            "id": "patient-ras",
            "kind": "dicom_patient",
            "name": "Patient RAS",
            "coordinateUnits": "mm",
            "physicalUnits": "mm",
            "sourceConvention": "RAS",
            "transformToPatientRas": list(IDENTITY_4),
            "transformFromPatientRas": list(IDENTITY_4),
            "scaleVerified": False,
        },
        {
            "id": "dicom-patient-lps",
            "kind": "dicom_patient",
            "name": "DICOM patient LPS",
            "coordinateUnits": "mm",
            "physicalUnits": "mm",
            "sourceConvention": "LPS",
            "transformToPatientRas": list(LPS_TO_RAS),
            "transformFromPatientRas": ras_to_lps,
            "scaleVerified": False,
        },
    ]
    if source_geometry is not None:
        frames.append({
            "id": "source-voxel-ijk",
            "kind": "voxel",
            "name": "Selected source image voxel IJK",
            "coordinateUnits": "index",
            "physicalUnits": "mm",
            "sourceConvention": "IJK",
            "spacingMm": list(source_geometry["spacingMm"]),
            "transformToPatientRas": list(source_geometry["voxelToPatientRas"]),
            "transformFromPatientRas": list(source_geometry["patientRasToVoxel"]),
            "roundTripMaximumError": float(source_geometry["roundTripMaximumError"]),
            "scaleVerified": False,
        })
    frames.extend([
        {
            "id": "label-voxel-ijk",
            "kind": "label_map",
            "name": "Immutable label-map voxel IJK",
            "coordinateUnits": "index",
            "physicalUnits": "mm",
            "sourceConvention": "IJK",
            "spacingMm": list(geometry["spacingMm"]),
            "transformToPatientRas": voxel_to_ras,
            "transformFromPatientRas": ras_to_voxel,
            "roundTripMaximumError": float(geometry["roundTripMaximumError"]),
            "scaleVerified": False,
        },
        {
            "id": "mesh-patient-ras",
            "kind": "mesh",
            "name": "Derived mesh patient RAS",
            "coordinateUnits": "mm",
            "physicalUnits": "mm",
            "sourceConvention": "RAS",
            "transformToPatientRas": list(IDENTITY_4),
            "transformFromPatientRas": list(IDENTITY_4),
            "scaleVerified": False,
        },
        {
            "id": "viewer-world",
            "kind": "viewer_world",
            "name": "MAT Viewer v2 world",
            "coordinateUnits": "mm",
            "physicalUnits": "mm",
            "sourceConvention": "VIEWER_WORLD",
            "transformToPatientRas": list(IDENTITY_4),
            "transformFromPatientRas": list(IDENTITY_4),
            "scaleVerified": False,
        },
    ])
    return tuple(frames)


def _label_inventory(image: Any, names: Mapping[int, str], namespace: str) -> tuple[Mapping[str, Any], ...]:
    import numpy as np
    import SimpleITK as sitk

    array = sitk.GetArrayViewFromImage(image)
    values, counts = np.unique(array, return_counts=True)
    voxel_volume = math.prod(float(value) for value in image.GetSpacing())
    records: list[Mapping[str, Any]] = []
    for raw_value, raw_count in zip(values.tolist(), counts.tolist()):
        label = int(round(float(raw_value)))
        if label == 0:
            continue
        count = int(raw_count)
        records.append({
            "namespace": namespace,
            "labelValue": label,
            "name": str(names.get(label, "unmapped")),
            "voxelCount": count,
            "volumeMm3": count * voxel_volume,
        })
    return tuple(records)


def _mesh_quality(faces: Sequence[Sequence[int]], vertex_count: int) -> dict[str, Any]:
    edge_counts: Counter[tuple[int, int]] = Counter()
    for face in faces:
        if len(face) != 3:
            continue
        a, b, c = (int(value) for value in face)
        edge_counts[tuple(sorted((a, b)))] += 1
        edge_counts[tuple(sorted((b, c)))] += 1
        edge_counts[tuple(sorted((c, a)))] += 1
    boundary_edges = sum(1 for count in edge_counts.values() if count == 1)
    nonmanifold_edges = sum(1 for count in edge_counts.values() if count > 2)
    return {
        "vertexCount": int(vertex_count),
        "triangleCount": int(len(faces)),
        "watertight": bool(edge_counts) and boundary_edges == 0 and nonmanifold_edges == 0,
        "manifold": nonmanifold_edges == 0,
        "boundaryEdgeCount": boundary_edges,
        "nonmanifoldEdgeCount": nonmanifold_edges,
        "selfIntersections": None,
        "reviewStatus": "unreviewed",
    }


def _viewer_mesh_payload(
    binary_image: Any,
    bone: str,
    voxel_to_ras: Sequence[float],
    target_faces: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    import numpy as np
    import SimpleITK as sitk
    from skimage import measure

    array = np.asarray(sitk.GetArrayViewFromImage(binary_image) > 0, dtype=np.uint8)
    if int(array.sum()) == 0:
        raise BridgeError("EMPTY_BONE_MASK", f"The {bone} mask is empty.")
    vertices_zyx = None
    faces = None
    step_used = 1
    for step_size in range(1, 9):
        vertices_candidate, faces_candidate, _normals, _values = measure.marching_cubes(
            array,
            level=0.5,
            step_size=step_size,
            allow_degenerate=False,
        )
        vertices_zyx = vertices_candidate
        faces = faces_candidate
        step_used = step_size
        if len(faces_candidate) <= max(500, target_faces):
            break
    if vertices_zyx is None or faces is None or len(faces) == 0:
        raise BridgeError("MESH_GENERATION_FAILED", f"No viewer mesh could be generated for {bone}.")
    vertices: list[list[float]] = []
    for z, y, x in vertices_zyx.tolist():
        ras = transform_point(voxel_to_ras, (x, y, z))
        vertices.append([round(float(value), 6) for value in ras])
    face_rows = [[int(value) for value in face] for face in faces.tolist()]
    quality = _mesh_quality(face_rows, len(vertices))
    quality["marchingCubesStepSize"] = step_used
    quality["deterministicDisplayDecimation"] = step_used > 1
    payload = {
        "schemaVersion": VIEWER_MESH_SCHEMA,
        "bone": bone,
        "frameId": "mesh-patient-ras",
        "units": "mm",
        "vertices": vertices,
        "faces": face_rows,
        "quality": quality,
    }
    return payload, quality


class MatArtifactProcessor:
    def __init__(self, config: BridgeConfig):
        self.config = config

    def process(self, outcome: RunnerOutcome, store: AssetStore, job_dir: Path) -> ProcessedEvidence:
        try:
            import SimpleITK as sitk
        except ImportError as exc:
            raise BridgeError("MAT_RUNTIME_INCOMPLETE", "SimpleITK is unavailable in the MAT runtime.") from exc
        standardized_image = sitk.ReadImage(str(outcome.standardized_mask_path))
        geometry = _image_geometry_from_sitk(standardized_image, frame_prefix="label")
        registration = _geometry_registration(outcome.selected_input_geometry, geometry)
        frames = _coordinate_frames(geometry, outcome.selected_input_geometry)
        binary_images: dict[str, Any] = {}
        for name, path in outcome.binary_mask_paths.items():
            if not path.is_file():
                continue
            binary_image = sitk.ReadImage(str(path))
            binary_geometry = _image_geometry_from_sitk(binary_image, frame_prefix=f"{name}-label")
            _geometry_registration(geometry, binary_geometry)
            binary_images[name] = binary_image
        artifacts: list[StoredAsset] = []
        standardized_asset = store.register_file(
            outcome.standardized_mask_path,
            "immutable_standardized_label_map",
            "application/vnd.nifti",
            ".nii.gz",
        )
        artifacts.append(standardized_asset)
        binary_assets: dict[str, StoredAsset] = {}
        for name in ("femur", "tibia", "femur_cartilage", "tibia_cartilage"):
            path = outcome.binary_mask_paths.get(name)
            if path is None or not path.is_file():
                continue
            asset = store.register_file(
                path,
                f"immutable_{name}_label_map",
                "application/vnd.nifti",
                ".nii.gz",
            )
            artifacts.append(asset)
            binary_assets[name] = asset
        raw_asset = None
        raw_image = None
        if outcome.raw_model_mask_path and outcome.raw_model_mask_path.is_file():
            raw_asset = store.register_file(
                outcome.raw_model_mask_path,
                "immutable_raw_model_label_map",
                "application/vnd.nifti",
                ".nii.gz",
            )
            artifacts.append(raw_asset)
            raw_image = sitk.ReadImage(str(outcome.raw_model_mask_path))
        inventory = list(_label_inventory(
            standardized_image,
            {1: "femur", 2: "tibia", 3: "femur_cartilage", 4: "tibia_cartilage"},
            "mat_standardized",
        ))
        if raw_image is not None:
            inventory.extend(_label_inventory(raw_image, outcome.selected_model.label_map, "raw_model"))
        standard_counts = {
            str(item["name"]): int(item["voxelCount"])
            for item in inventory
            if item["namespace"] == "mat_standardized"
        }
        warning_codes: list[str] = [
            "RESEARCH_ONLY",
            "CLINICIAN_REVIEW_REQUIRED",
            "LATERALITY_NOT_VERIFIED",
            "SCALE_NOT_VERIFIED",
            "ORIENTATION_NOT_VERIFIED",
            "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
            "DANGER_ANATOMY_NOT_EVALUATED",
        ]
        bones: list[Mapping[str, Any]] = []
        derived_dir = job_dir / "derived"
        derived_dir.mkdir(mode=0o700, exist_ok=False)
        voxel_to_ras = geometry["voxelToPatientRas"]
        for bone in ("femur", "tibia"):
            count = standard_counts.get(bone, 0)
            if count <= 0 or bone not in binary_images:
                bones.append({
                    "bone": bone,
                    "status": "missing",
                    "reviewStatus": "unreviewed",
                    "labelMapAssetId": None,
                    "viewerMeshAssetId": None,
                })
                warning_codes.append(f"{bone.upper()}_MISSING")
                continue
            binary_image = binary_images[bone]
            try:
                mesh_payload, mesh_quality = _viewer_mesh_payload(
                    binary_image,
                    bone,
                    voxel_to_ras,
                    self.config.viewer_target_faces,
                )
                mesh_path = derived_dir / f"{bone}-viewer-mesh.json"
                write_json_new(mesh_path, mesh_payload)
                mesh_asset = store.register_file(
                    mesh_path,
                    f"{bone}_viewer_mesh",
                    "application/json",
                    ".json",
                    api_readable=True,
                )
                artifacts.append(mesh_asset)
                mesh_id: str | None = mesh_asset.asset_id
            except Exception:
                mesh_quality = {
                    "vertexCount": None,
                    "triangleCount": None,
                    "watertight": None,
                    "manifold": None,
                    "warnings": ["viewer_mesh_generation_failed"],
                    "reviewStatus": "unreviewed",
                }
                mesh_id = None
                warning_codes.append(f"{bone.upper()}_VIEWER_MESH_NOT_GENERATED")
            bones.append({
                "bone": bone,
                "status": "present",
                "reviewStatus": "unreviewed",
                "voxelCount": count,
                "labelMapAssetId": binary_assets.get(bone).asset_id if bone in binary_assets else standardized_asset.asset_id,
                "viewerMeshAssetId": mesh_id,
                "coordinateFrameId": "mesh-patient-ras",
                "meshQuality": mesh_quality,
            })
        bones.append({
            "bone": "fibula",
            "status": "missing",
            "reviewStatus": "not_available",
            "voxelCount": 0,
            "labelMapAssetId": None,
            "viewerMeshAssetId": None,
            "reasonCode": "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
        })
        qc = {
            "matBasicQc": copy.deepcopy(dict(outcome.qc)),
            "sourceSeries": copy.deepcopy(dict(outcome.selected_series)),
            "segmentationReviewStatus": "unreviewed",
            "meshQualityReviewed": False,
        }
        geometry_public = {
            "sizeVoxels": list(geometry["sizeVoxels"]),
            "spacingMm": list(geometry["spacingMm"]),
            "orientation": str(outcome.selected_series.get("orientation", "UNKNOWN")),
            "axesCode": str(outcome.selected_series.get("axesCode", "")),
            "roundTripMaximumError": float(geometry["roundTripMaximumError"]),
            "sourceImage": {
                "sizeVoxels": list(outcome.selected_input_geometry["sizeVoxels"]),
                "spacingMm": list(outcome.selected_input_geometry["spacingMm"]),
                "originLpsMm": list(outcome.selected_input_geometry["originLpsMm"]),
                "directionLps": list(outcome.selected_input_geometry["directionLps"]),
                "frameId": "source-voxel-ijk",
            },
            "finalLabelMap": {
                "sizeVoxels": list(geometry["sizeVoxels"]),
                "spacingMm": list(geometry["spacingMm"]),
                "originLpsMm": list(geometry["originLpsMm"]),
                "directionLps": list(geometry["directionLps"]),
                "frameId": "label-voxel-ijk",
            },
            "sourceToLabelRegistration": registration,
        }
        return ProcessedEvidence(
            artifacts=tuple(artifacts),
            coordinate_frames=frames,
            geometry=geometry_public,
            label_inventory=tuple(inventory),
            bones=tuple(bones),
            qc=qc,
            warning_codes=tuple(dict.fromkeys(warning_codes)),
        )


def _selected_model_provenance(model: ModelEvidence) -> dict[str, Any]:
    checkpoint_records: list[dict[str, Any]] = []
    aggregate = hashlib.sha256()
    for fold in model.folds:
        checkpoint = model.model_path / f"fold_{fold}" / model.checkpoint_name
        if not checkpoint.is_file():
            raise BridgeError("CHECKPOINT_MISSING", "The selected MAT model checkpoint is unavailable.")
        value, byte_length = sha256_file(checkpoint)
        checkpoint_records.append({
            "fold": fold,
            "checkpointName": model.checkpoint_name,
            "sha256": value,
            "byteLength": byte_length,
        })
        aggregate.update(str(fold).encode("ascii"))
        aggregate.update(model.checkpoint_name.encode("utf-8"))
        aggregate.update(byte_length.to_bytes(8, "big"))
        aggregate.update(bytes.fromhex(value))
    configuration_records: list[dict[str, Any]] = []
    for file_name in ("plans.json", "dataset.json"):
        artifact = model.model_path / file_name
        if not artifact.is_file():
            raise BridgeError("MODEL_CONFIGURATION_MISSING", "A selected MAT model configuration artifact is unavailable.")
        value, byte_length = sha256_file(artifact)
        configuration_records.append({
            "name": file_name,
            "sha256": value,
            "byteLength": byte_length,
        })
        aggregate.update(file_name.encode("utf-8"))
        aggregate.update(byte_length.to_bytes(8, "big"))
        aggregate.update(bytes.fromhex(value))
    return {
        "id": model.model_id,
        "backend": model.backend,
        "dataset": model.dataset,
        "trainer": model.trainer,
        "plans": model.plans,
        "configuration": model.configuration,
        "folds": list(model.folds),
        "checkpointName": model.checkpoint_name,
        "checkpoints": checkpoint_records,
        "configurationArtifacts": configuration_records,
        "modelArtifactSha256": aggregate.hexdigest(),
    }


def _sanitize_laterality_hint(value: Mapping[str, Any]) -> dict[str, Any]:
    """Enforce the small non-PHI public laterality contract."""
    status = str(value.get("status", "absent"))
    if status not in {"resolved", "conflict", "absent", "not_applicable"}:
        status = "absent"
    laterality = value.get("laterality")
    if laterality not in {"left", "right"}:
        laterality = None
    confidence = str(value.get("confidence", "none"))
    if confidence not in {"high", "low", "none"}:
        confidence = "none"
    allowed_sources = {source for _keyword, source, _kind in DICOM_LATERALITY_TAGS}
    evidence: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    raw_evidence = value.get("evidence", [])
    if isinstance(raw_evidence, Sequence) and not isinstance(raw_evidence, (str, bytes)):
        for item in raw_evidence:
            if not isinstance(item, Mapping):
                continue
            source = str(item.get("source", ""))
            side = str(item.get("laterality", ""))
            key = (source, side)
            if source not in allowed_sources or side not in {"left", "right"} or key in seen:
                continue
            seen.add(key)
            evidence.append({"source": source, "laterality": side})
    evidence.sort(key=lambda item: (
        next(index for index, (_keyword, source, _kind) in enumerate(DICOM_LATERALITY_TAGS) if source == item["source"]),
        item["laterality"],
    ))
    if status != "resolved":
        laterality = None
        confidence = "none"
    elif laterality is None:
        status = "conflict" if len({item["laterality"] for item in evidence}) > 1 else "absent"
        confidence = "none"
    elif confidence == "high" and not any(
        item["source"] in {"dicom_image_laterality", "dicom_laterality"}
        for item in evidence
    ):
        confidence = "low"
    if status == "resolved" and confidence == "none":
        confidence = "low"
    return {
        "laterality": laterality,
        "status": status,
        "confidence": confidence,
        "evidence": evidence,
        "requiresClinicianVerification": True,
    }


def build_result_manifest(
    config: BridgeConfig,
    run_id: str,
    source: SourceDigest,
    source_asset: StoredAsset,
    outcome: RunnerOutcome,
    processed: ProcessedEvidence,
    extra_warning_codes: Iterable[str] = (),
) -> dict[str, Any]:
    registry_sha256 = sha256_file(config.registry_path)[0]
    algorithm_source_sha256 = _algorithm_source_hash(config)
    if algorithm_source_sha256 != outcome.algorithm_source_sha256:
        raise BridgeError("ALGORITHM_SOURCE_CHANGED", "The MAT segmentation source changed after inference.")
    model = _selected_model_provenance(outcome.selected_model)
    if canonical_json_bytes(model) != canonical_json_bytes(outcome.model_artifact_provenance):
        raise BridgeError("MODEL_ARTIFACT_CHANGED", "The selected model artifacts changed after inference.")
    raw_laterality_hint = outcome.selected_series.get("lateralityHint")
    if not isinstance(raw_laterality_hint, Mapping):
        raw_laterality_hint = _empty_laterality_hint(
            "not_applicable" if source.kind == "nifti" else "absent"
        )
    laterality_hint = _sanitize_laterality_hint(raw_laterality_hint)
    hint_warning_codes: tuple[str, ...] = ()
    if laterality_hint["status"] == "resolved":
        hint_warning_codes = ("DICOM_LATERALITY_HINT_REQUIRES_VERIFICATION",)
    elif laterality_hint["status"] == "conflict":
        hint_warning_codes = ("DICOM_LATERALITY_CONFLICT",)
    elif source.kind != "nifti":
        hint_warning_codes = ("DICOM_LATERALITY_ABSENT",)
    warnings = tuple(dict.fromkeys((*processed.warning_codes, *extra_warning_codes, *hint_warning_codes)))
    bone_status = {str(item["bone"]): str(item["status"]) for item in processed.bones}
    public_artifacts: list[dict[str, Any]] = []
    seen_asset_ids: set[str] = set()
    for asset in processed.artifacts:
        if asset.asset_id in seen_asset_ids:
            continue
        seen_asset_ids.add(asset.asset_id)
        public_artifacts.append(asset.public())
    result = {
        "schemaVersion": RESULT_SCHEMA,
        "runId": run_id,
        "adapterId": ADAPTER_ID,
        "adapterVersion": BRIDGE_VERSION,
        "validationState": VALIDATION_STATE,
        "researchUseOnly": True,
        "generatedAt": utc_now(),
        "source": source.public(),
        "lateralityHint": laterality_hint,
        "algorithm": {
            "name": "MAT Planner knee_bone_masker.BoneMaskPipeline",
            "algorithmSourceSha256": algorithm_source_sha256,
            "matPlannerRevision": _mat_revision(config),
            "registrySha256": registry_sha256,
            "nnunetv2Version": _safe_package_version("nnunetv2"),
            "model": model,
        },
        "coordinateFrames": [copy.deepcopy(dict(frame)) for frame in processed.coordinate_frames],
        "geometry": copy.deepcopy(dict(processed.geometry)),
        "labelInventory": [copy.deepcopy(dict(item)) for item in processed.label_inventory],
        "bones": [copy.deepcopy(dict(item)) for item in processed.bones],
        "requiredLabelStatus": {
            "femur": bone_status.get("femur", "missing"),
            "tibia": bone_status.get("tibia", "missing"),
            "fibula": bone_status.get("fibula", "missing"),
        },
        "artifacts": public_artifacts,
        "qc": copy.deepcopy(dict(processed.qc)),
        "warningCodes": list(warnings),
        "reviewGates": {
            "lateralityVerified": False,
            "scaleVerified": False,
            "orientationVerified": False,
            "boneIdentitiesVerified": False,
            "sourceLabelMapsImmutable": True,
        },
        "notEvaluated": [
            "fibula segmentation",
            "posterior neurovascular and other danger anatomy",
            "cortex/articular clearance against imported meshes",
        ],
        "notice": "Research-only segmentation output requiring clinician review; not an operative recommendation.",
    }
    forbidden = (str(config.mat_planner_root), str(config.storage_root))
    serialized = json.dumps(result, sort_keys=True)
    if any(value and value in serialized for value in forbidden):
        raise BridgeError("PRIVACY_CONTRACT_FAILED", "A local path entered the public result contract.")
    return result


_EVENT_LOCKS: dict[str, threading.Lock] = {}
_EVENT_LOCKS_GUARD = threading.Lock()


def _job_lock(job_id: str) -> threading.Lock:
    with _EVENT_LOCKS_GUARD:
        return _EVENT_LOCKS.setdefault(job_id, threading.Lock())


def _validate_job_id(job_id: str) -> None:
    if not re.fullmatch(r"job-[0-9a-f]{16}-[0-9a-f]{12}", job_id):
        raise BridgeError("INVALID_JOB_ID", "The segmentation job ID is invalid.")


def append_job_event(
    job_dir: Path,
    status: str,
    progress: float,
    result: Mapping[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    if status not in {"queued", "running", "completed", "failed"}:
        raise ValueError("Unsupported job status")
    job_id = job_dir.name
    _validate_job_id(job_id)
    with _job_lock(job_id):
        events_dir = job_dir / "events"
        events_dir.mkdir(mode=0o700, exist_ok=True)
        existing = sorted(events_dir.glob("*.json"))
        sequence = len(existing) + 1
        event = {
            "schemaVersion": JOB_SCHEMA,
            "jobId": job_id,
            "status": status,
            "progress": max(0.0, min(1.0, float(progress))),
            "updatedAt": utc_now(),
            "result": copy.deepcopy(dict(result)) if result is not None else None,
            "error": error,
        }
        write_json_new(events_dir / f"{sequence:06d}.json", event)
        return event


def read_job(store: AssetStore, job_id: str) -> dict[str, Any]:
    _validate_job_id(job_id)
    with _job_lock(job_id):
        job_dir = store.jobs_root / job_id
        events = sorted((job_dir / "events").glob("*.json")) if job_dir.is_dir() else []
        if not events:
            raise BridgeError("JOB_NOT_FOUND", "The segmentation job was not found.")
        try:
            value = json.loads(events[-1].read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BridgeError("JOB_STATE_INVALID", "The segmentation job state is unreadable.") from exc
        return value


def create_job(store: AssetStore, source: SourceDigest, source_asset: StoredAsset) -> tuple[str, Path]:
    random_token = uuid.uuid4().hex[:12]
    job_id = f"job-{source.sha256[:16]}-{random_token}"
    job_dir = store.jobs_root / job_id
    job_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
    write_json_new(job_dir / "source.json", {
        "schemaVersion": "mat-nnunet-job-source.v1",
        "jobId": job_id,
        "source": source.public(asset_id=source_asset.asset_id),
    })
    append_job_event(job_dir, "queued", 0.0)
    return job_id, job_dir


def _prepare_pipeline_input(
    config: BridgeConfig,
    source_asset: StoredAsset,
    source_kind: str,
    job_dir: Path,
) -> tuple[Path, tuple[str, ...]]:
    warnings: list[str] = []
    if source_kind == "nifti":
        return source_asset.payload_path, tuple(warnings)
    if source_kind == "dicom_folder":
        selected, summaries = select_dicom_container(source_asset.payload_path, config)
        if len(summaries) > 1:
            warnings.append("MULTIPLE_DICOM_CONTAINERS_DETERMINISTIC_SELECTION")
        return selected, tuple(warnings)
    if source_kind == "dicom_tar_gz":
        extraction_root = job_dir / "input" / "extracted"
        safe_extract_tar(source_asset.payload_path, extraction_root, config)
        selected, summaries = select_dicom_container(extraction_root, config)
        if len(summaries) > 1:
            warnings.append("MULTIPLE_DICOM_CONTAINERS_DETERMINISTIC_SELECTION")
        return selected, tuple(warnings)
    raise BridgeError("UNSUPPORTED_SOURCE", "The source kind is not supported for segmentation.")


def execute_job(
    config: BridgeConfig,
    store: AssetStore,
    job_id: str,
    source: SourceDigest,
    source_asset: StoredAsset,
    runner: PipelineRunner | None = None,
    processor: ArtifactProcessor | None = None,
) -> dict[str, Any]:
    _validate_job_id(job_id)
    job_dir = store.jobs_root / job_id
    try:
        append_job_event(job_dir, "running", 0.05)
        pipeline_input, preparation_warnings = _prepare_pipeline_input(
            config,
            source_asset,
            source.kind,
            job_dir,
        )
        append_job_event(job_dir, "running", 0.12)
        require_disk_capacity(
            job_dir,
            config.min_inference_working_bytes,
            config.min_free_after_bytes,
        )
        inference_dir = job_dir / "inference"
        inference_dir.mkdir(mode=0o700, exist_ok=False)
        selected_runner = runner or MatPipelineRunner(config)
        outcome = selected_runner.run(pipeline_input, inference_dir)
        append_job_event(job_dir, "running", 0.82)
        selected_processor = processor or MatArtifactProcessor(config)
        processed = selected_processor.process(outcome, store, job_dir)
        append_job_event(job_dir, "running", 0.94)
        result = build_result_manifest(
            config,
            job_id,
            source,
            source_asset,
            outcome,
            processed,
            extra_warning_codes=preparation_warnings,
        )
        write_json_new(job_dir / "manifest.json", result)
        return append_job_event(job_dir, "completed", 1.0, result=result)
    except BridgeError as exc:
        return append_job_event(job_dir, "failed", 1.0, error=exc.code)
    except Exception:
        return append_job_event(job_dir, "failed", 1.0, error="INTERNAL_SEGMENTATION_ERROR")


def _source_suffix(kind: str, compressed_nifti: bool = True) -> str:
    if kind == "dicom_tar_gz":
        return ".tar.gz"
    if kind == "nifti":
        return ".nii.gz" if compressed_nifti else ".nii"
    return ""


def _source_media_type(kind: str) -> str:
    return {
        "dicom_tar_gz": "application/gzip",
        "nifti": "application/vnd.nifti",
        "dicom_folder": "application/dicom-directory",
    }[kind]


def register_cli_source(path: Path, config: BridgeConfig, store: AssetStore) -> tuple[SourceDigest, StoredAsset]:
    resolved = path.expanduser().resolve()
    if not resolved.exists():
        raise BridgeError("SOURCE_NOT_FOUND", "The requested source does not exist.")
    kind = detect_source_kind(resolved)
    if kind == "dicom_folder":
        source = digest_directory(resolved, limit=config.max_upload_bytes)
        validate_source_file(resolved, kind, config)
        asset = store.register_directory(resolved, source)
        return source, asset
    source = digest_file(resolved, kind, limit=config.max_upload_bytes)
    validate_source_file(resolved, kind, config)
    compressed = resolved.name.lower().endswith(".gz")
    asset = store.register_file(
        resolved,
        f"{kind}_source",
        _source_media_type(kind),
        _source_suffix(kind, compressed_nifti=compressed),
        expected_sha256=source.sha256,
        expected_length=source.byte_length,
    )
    return source, asset


def _write_upload_stream_new(path: Path, upload: Any, limit: int) -> tuple[str, int]:
    """Synchronous helper used by tests; FastAPI uses the async equivalent."""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    digest = hashlib.sha256()
    total = 0
    with os.fdopen(descriptor, "wb") as output:
        while True:
            chunk = upload.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise BridgeError("SOURCE_TOO_LARGE", "The upload exceeds the configured byte limit.")
            digest.update(chunk)
            output.write(chunk)
        output.flush()
        os.fsync(output.fileno())
    return digest.hexdigest(), total


def validate_api_request_headers(
    method: str,
    path: str,
    headers: Mapping[str, str],
    config: BridgeConfig,
) -> None:
    normalized = {str(key).lower(): str(value).strip() for key, value in headers.items()}
    allowed_hosts = {
        f"127.0.0.1:{config.api_port}",
        f"localhost:{config.api_port}",
        f"[::1]:{config.api_port}",
    }
    if normalized.get("host", "").lower() not in allowed_hosts:
        raise BridgeError("API_HOST_REJECTED", "The API Host header is not an allowed loopback endpoint.")
    origin = normalized.get("origin")
    if origin is not None and origin not in ALLOWED_BROWSER_ORIGINS:
        raise BridgeError("API_ORIGIN_REJECTED", "The browser Origin is not allowed.")
    is_job_endpoint = path == "/api/segmentation/jobs"
    upper_method = method.upper()
    if is_job_endpoint and upper_method in {"POST", "OPTIONS"} and origin not in ALLOWED_BROWSER_ORIGINS:
        raise BridgeError("API_ORIGIN_REQUIRED", "Job requests require an exact allowed browser Origin.")
    if not is_job_endpoint or upper_method != "POST":
        return
    if normalized.get(REQUIRED_CLIENT_HEADER.lower()) != REQUIRED_CLIENT_HEADER_VALUE:
        raise BridgeError("API_CLIENT_HEADER_REQUIRED", "The required Multilig client header is missing.")
    if normalized.get("transfer-encoding"):
        raise BridgeError("CONTENT_LENGTH_REQUIRED", "Chunked job uploads are not accepted.")
    raw_length = normalized.get("content-length", "")
    if not re.fullmatch(r"[0-9]+", raw_length):
        raise BridgeError("CONTENT_LENGTH_REQUIRED", "A finite Content-Length is required before multipart parsing.")
    content_length = int(raw_length)
    if content_length <= 0:
        raise BridgeError("CONTENT_LENGTH_REQUIRED", "A positive Content-Length is required.")
    maximum = config.max_upload_bytes + MAX_MULTIPART_OVERHEAD_BYTES
    if content_length > maximum:
        raise BridgeError("REQUEST_TOO_LARGE", "The multipart request exceeds the configured upload bound.")


def create_fastapi_app(config: BridgeConfig, runner_factory: Callable[[], PipelineRunner] | None = None) -> Any:
    try:
        from fastapi import FastAPI, File, Form, HTTPException, UploadFile
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import FileResponse, JSONResponse
    except ImportError as exc:
        raise BridgeError("MAT_RUNTIME_INCOMPLETE", "FastAPI is unavailable in the MAT runtime.") from exc

    store = AssetStore(config.storage_root, min_free_after_bytes=config.min_free_after_bytes)
    app = FastAPI(
        title="Multilig Planner MAT nnUNet bridge",
        version=API_VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(ALLOWED_BROWSER_ORIGINS),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", REQUIRED_CLIENT_HEADER],
    )

    class ApiSecurityMiddleware:
        def __init__(self, inner_app: Any):
            self.inner_app = inner_app

        async def __call__(self, scope: Mapping[str, Any], receive: Any, send: Any) -> None:
            if scope.get("type") != "http":
                await self.inner_app(scope, receive, send)
                return
            header_map = {
                key.decode("latin-1").lower(): value.decode("latin-1")
                for key, value in scope.get("headers", [])
            }
            try:
                validate_api_request_headers(
                    str(scope.get("method", "GET")),
                    str(scope.get("path", "")),
                    header_map,
                    config,
                )
                if (
                    str(scope.get("method", "GET")).upper() == "POST"
                    and str(scope.get("path", "")) == "/api/segmentation/jobs"
                ):
                    content_length = int(header_map["content-length"])
                    require_disk_capacity(
                        config.storage_root,
                        content_length * 3,
                        config.min_free_after_bytes,
                    )
            except BridgeError as exc:
                status_code = (
                    507
                    if exc.code in {"INSUFFICIENT_DISK", "DISK_PREFLIGHT_FAILED"}
                    else 413
                    if exc.code == "REQUEST_TOO_LARGE"
                    else 411
                    if exc.code == "CONTENT_LENGTH_REQUIRED"
                    else 403
                )
                response = JSONResponse(
                    status_code=status_code,
                    content={"detail": {"code": exc.code, "message": exc.message}},
                )
                await response(scope, receive, send)
                return
            await self.inner_app(scope, receive, send)

    app.add_middleware(ApiSecurityMiddleware)
    inference_slot = threading.BoundedSemaphore(value=1)
    app.state.inference_slot = inference_slot

    def http_error(exc: BridgeError, status_code: int = 400) -> HTTPException:
        return HTTPException(status_code=status_code, detail={"code": exc.code, "message": exc.message})

    @app.get("/api/segmentation/capabilities")
    def get_capabilities() -> dict[str, Any]:
        return capabilities(config)

    @app.post("/api/segmentation/jobs")
    async def post_job(
        source: Any = File(...),
        source_kind: str = Form(...),
        source_sha256: str | None = Form(default=None),
        source_byte_length: int | None = Form(default=None),
    ) -> dict[str, Any]:
        acquired = inference_slot.acquire(blocking=False)
        if not acquired:
            raise http_error(BridgeError("SEGMENTATION_BUSY", "Another segmentation job is already running."), status_code=409)
        slot_transferred = False
        try:
            kind = normalize_source_kind(source_kind)
            if kind == "dicom_folder":
                raise BridgeError("UNSUPPORTED_HTTP_SOURCE", "HTTP uploads accept tar.gz or NIfTI, not local folders.")
            incoming = store.incoming_root / f"incoming-{uuid.uuid4().hex}.payload"
            descriptor = os.open(incoming, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            digest = hashlib.sha256()
            total = 0
            with os.fdopen(descriptor, "wb") as output:
                while True:
                    chunk = await source.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > config.max_upload_bytes:
                        raise BridgeError("SOURCE_TOO_LARGE", "The upload exceeds the configured byte limit.")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            actual_hash = digest.hexdigest()
            if source_sha256 is not None:
                declared = source_sha256.strip().lower()
                if not re.fullmatch(r"[0-9a-f]{64}", declared) or declared != actual_hash:
                    raise BridgeError("SOURCE_HASH_MISMATCH", "The uploaded source SHA-256 does not match the declaration.")
            if source_byte_length is not None and int(source_byte_length) != total:
                raise BridgeError("SOURCE_LENGTH_MISMATCH", "The uploaded source byte length does not match the declaration.")
            source_digest = SourceDigest(f"source-sha256-{actual_hash}", kind, actual_hash, total, 1)
            validate_source_file(incoming, kind, config)
            with incoming.open("rb") as uploaded_handle:
                compressed = kind == "dicom_tar_gz" or uploaded_handle.read(2) == b"\x1f\x8b"
            source_asset = store.register_file(
                incoming,
                f"{kind}_source",
                _source_media_type(kind),
                _source_suffix(kind, compressed_nifti=compressed),
                expected_sha256=actual_hash,
                expected_length=total,
            )
            job_id, _job_dir = create_job(store, source_digest, source_asset)
            runner = runner_factory() if runner_factory else None
            def run_and_release() -> None:
                try:
                    execute_job(config, store, job_id, source_digest, source_asset, runner)
                finally:
                    inference_slot.release()

            thread = threading.Thread(
                target=run_and_release,
                daemon=True,
                name=f"segmentation-{job_id}",
            )
            thread.start()
            slot_transferred = True
            return read_job(store, job_id)
        except BridgeError as exc:
            raise http_error(exc) from exc
        finally:
            if acquired and not slot_transferred:
                inference_slot.release()

    @app.get("/api/segmentation/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        try:
            return read_job(store, job_id)
        except BridgeError as exc:
            raise http_error(exc, status_code=404 if exc.code == "JOB_NOT_FOUND" else 400) from exc

    @app.get("/api/segmentation/assets/{asset_id}")
    def get_asset(asset_id: str) -> Any:
        try:
            asset = store.get(asset_id)
            if (
                not asset.api_readable
                or asset.kind not in SAFE_API_ASSET_KINDS
                or asset.media_type != "application/json"
                or not asset.payload_path.is_file()
            ):
                raise BridgeError("ASSET_ACCESS_DENIED", "Source, raw, and non-viewer assets are never served by this API.")
            guessed = mimetypes.guess_extension(asset.media_type) or Path(asset.storage_name).suffix
            return FileResponse(
                path=asset.payload_path,
                media_type=asset.media_type,
                filename=f"asset{guessed or ''}",
            )
        except BridgeError as exc:
            status_code = 403 if exc.code == "ASSET_ACCESS_DENIED" else 404 if exc.code in {"ASSET_INCOMPLETE"} else 400
            raise http_error(exc, status_code=status_code) from exc

    return app


def _config_from_args(args: argparse.Namespace) -> BridgeConfig:
    return BridgeConfig.from_values(
        mat_planner_root=getattr(args, "mat_planner_root", None),
        storage_root=getattr(args, "storage_root", None),
        registry_path=getattr(args, "registry", None),
        max_upload_bytes=int(getattr(args, "max_upload_bytes", DEFAULT_MAX_UPLOAD_BYTES)),
        max_expanded_bytes=int(getattr(args, "max_expanded_bytes", DEFAULT_MAX_EXPANDED_BYTES)),
        min_free_after_bytes=int(getattr(args, "min_free_after_bytes", DEFAULT_MIN_FREE_AFTER_BYTES)),
        max_archive_members=int(getattr(args, "max_archive_members", DEFAULT_MAX_ARCHIVE_MEMBERS)),
        viewer_target_faces=int(getattr(args, "viewer_target_faces", DEFAULT_VIEWER_TARGET_FACES)),
        min_inference_working_bytes=int(
            getattr(args, "min_inference_working_bytes", DEFAULT_MIN_INFERENCE_WORKING_BYTES)
        ),
        api_port=int(getattr(args, "port", DEFAULT_API_PORT)),
    )


def _add_runtime_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--mat-planner-root", default=None)
    parser.add_argument("--storage-root", default=None)
    parser.add_argument("--registry", default=None)
    parser.add_argument("--max-upload-bytes", type=int, default=DEFAULT_MAX_UPLOAD_BYTES)
    parser.add_argument("--max-expanded-bytes", type=int, default=DEFAULT_MAX_EXPANDED_BYTES)
    parser.add_argument("--min-free-after-bytes", type=int, default=DEFAULT_MIN_FREE_AFTER_BYTES)
    parser.add_argument("--max-archive-members", type=int, default=DEFAULT_MAX_ARCHIVE_MEMBERS)
    parser.add_argument("--viewer-target-faces", type=int, default=DEFAULT_VIEWER_TARGET_FACES)
    parser.add_argument(
        "--min-inference-working-bytes",
        type=int,
        default=DEFAULT_MIN_INFERENCE_WORKING_BYTES,
    )


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Research-only bridge to MAT Planner's nnUNetv2 bone segmentation.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    capability_parser = subparsers.add_parser("capabilities", help="Report the local MAT pipeline capability contract.")
    _add_runtime_options(capability_parser)
    probe_parser = subparsers.add_parser("probe", help="Safely inspect a local source without running inference.")
    probe_parser.add_argument("--input", required=True)
    _add_runtime_options(probe_parser)
    segment_parser = subparsers.add_parser("segment", help="Run the canonical MAT nnUNetv2 pipeline on a local source.")
    segment_parser.add_argument("--input", required=True)
    _add_runtime_options(segment_parser)
    serve_parser = subparsers.add_parser("serve", help="Serve the loopback-only upload/job API.")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=4190)
    _add_runtime_options(serve_parser)
    return parser


def _print_json(value: Any, stream: Any = sys.stdout) -> None:
    stream.write(json.dumps(value, indent=2, sort_keys=True) + "\n")
    stream.flush()


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_cli_parser()
    args = parser.parse_args(argv)
    config = _config_from_args(args)
    try:
        if args.command == "capabilities":
            _print_json(capabilities(config))
            return 0
        if args.command == "probe":
            _print_json(probe_source(Path(args.input), config))
            return 0
        if args.command == "segment":
            store = AssetStore(config.storage_root, min_free_after_bytes=config.min_free_after_bytes)
            source, source_asset = register_cli_source(Path(args.input), config, store)
            job_id, _job_dir = create_job(store, source, source_asset)
            event = execute_job(config, store, job_id, source, source_asset)
            _print_json(event)
            return 0 if event["status"] == "completed" else 2
        if args.command == "serve":
            allowed_hosts = {"127.0.0.1", "localhost", "::1"}
            if str(args.host).strip().lower() not in allowed_hosts:
                raise BridgeError("LOOPBACK_REQUIRED", "The segmentation API may bind to loopback only.")
            try:
                import uvicorn
            except ImportError as exc:
                raise BridgeError("MAT_RUNTIME_INCOMPLETE", "uvicorn is unavailable in the MAT runtime.") from exc
            app = create_fastapi_app(config)
            uvicorn.run(app, host=str(args.host), port=int(args.port), access_log=True)
            return 0
        raise BridgeError("UNKNOWN_COMMAND", "The requested command is unsupported.")
    except BridgeError as exc:
        _print_json({"error": {"code": exc.code, "message": exc.message}}, stream=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
