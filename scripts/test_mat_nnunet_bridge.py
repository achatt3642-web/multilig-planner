from __future__ import annotations

import concurrent.futures
import gzip
import hashlib
import io
import json
import struct
import sys
import tarfile
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock


SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import mat_nnunet_bridge as bridge


def new_work_dir(label: str) -> Path:
    # Intentionally not auto-cleaned: the workstation-wide task explicitly
    # forbids deletion. These fixtures are tiny and live under the OS temp root.
    return Path(tempfile.mkdtemp(prefix=f"multilig-{label}-"))


def write_new(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(data)


def make_tar(path: Path, entries: list[tuple[str, bytes, str]]) -> None:
    with tarfile.open(path, "x:gz") as archive:
        for name, payload, kind in entries:
            info = tarfile.TarInfo(name)
            if kind == "file":
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))
            elif kind == "dir":
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
            elif kind == "symlink":
                info.type = tarfile.SYMTYPE
                info.linkname = "target"
                archive.addfile(info)
            else:
                raise AssertionError(kind)


def make_nifti1_bytes(
    dimensions: tuple[int, ...] = (4, 4, 4),
    datatype_code: int = 2,
    bits_per_voxel: int = 8,
    voxel_offset: int = 352,
) -> bytes:
    header = bytearray(max(352, voxel_offset if voxel_offset > 0 else 352))
    struct.pack_into("<i", header, 0, 348)
    raw_dimensions = [len(dimensions), *dimensions, *([1] * (7 - len(dimensions)))]
    struct.pack_into("<8h", header, 40, *raw_dimensions)
    struct.pack_into("<h", header, 70, datatype_code)
    struct.pack_into("<h", header, 72, bits_per_voxel)
    struct.pack_into("<8f", header, 76, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0)
    struct.pack_into("<f", header, 108, float(voxel_offset))
    header[344:348] = b"n+1\x00"
    voxel_count = 1
    for value in dimensions:
        voxel_count *= max(0, value)
    payload_length = voxel_count * max(0, bits_per_voxel) // 8
    return bytes(header) + (b"\x00" * payload_length)


def fake_mat_root(root: Path) -> tuple[Path, Path]:
    mat_root = root / "mat"
    for relative in (
        "knee_bone_masker/pipeline.py",
        "knee_bone_masker/io_utils.py",
        "knee_bone_masker/router.py",
        "knee_bone_masker/registry.py",
        "knee_bone_masker/postprocess.py",
        "knee_bone_masker/preprocess.py",
        "knee_bone_masker/qc.py",
        "knee_bone_masker/types.py",
        "knee_bone_masker/__init__.py",
        "knee_bone_masker/adapters/base.py",
        "knee_bone_masker/adapters/__init__.py",
        "knee_bone_masker/adapters/nnunetv2_adapter.py",
    ):
        write_new(mat_root / relative, f"# fake {relative}\n".encode())
    registry = mat_root / "example_models.yaml"
    write_new(registry, b"[]\n")
    return mat_root, registry


class DicomLateralityHintTests(unittest.TestCase):
    def test_direct_tags_resolve_with_high_confidence_without_retaining_text(self) -> None:
        hint = bridge.resolve_dicom_laterality_metadata([
            {
                "ImageLaterality": "R",
                "Laterality": "RIGHT",
                "BodyPartExamined": "KNEE",
                "SeriesDescription": "RIGHT KNEE PATIENT-SPECIFIC FREE TEXT",
            },
        ])
        self.assertEqual(hint["laterality"], "right")
        self.assertEqual(hint["status"], "resolved")
        self.assertEqual(hint["confidence"], "high")
        self.assertTrue(hint["requiresClinicianVerification"])
        serialized = json.dumps(hint)
        self.assertNotIn("PATIENT-SPECIFIC", serialized)
        self.assertEqual(
            {entry["source"] for entry in hint["evidence"]},
            {"dicom_image_laterality", "dicom_laterality", "dicom_series_description"},
        )

    def test_description_token_is_a_low_confidence_seed(self) -> None:
        hint = bridge.resolve_dicom_laterality_metadata([
            {"BodyPartExamined": "KNEE", "SeriesDescription": "KNEE RT"},
            {"BodyPartExamined": "KNEE", "SeriesDescription": "RIGHT KNEE"},
        ])
        self.assertEqual(hint, {
            "laterality": "right",
            "status": "resolved",
            "confidence": "low",
            "evidence": [{"source": "dicom_series_description", "laterality": "right"}],
            "requiresClinicianVerification": True,
        })

    def test_any_cross_source_disagreement_is_a_visible_conflict(self) -> None:
        hint = bridge.resolve_dicom_laterality_metadata([
            {"ImageLaterality": "L", "SeriesDescription": "RIGHT KNEE"},
        ])
        self.assertIsNone(hint["laterality"])
        self.assertEqual(hint["status"], "conflict")
        self.assertEqual(hint["confidence"], "none")
        self.assertEqual(
            {(entry["source"], entry["laterality"]) for entry in hint["evidence"]},
            {("dicom_image_laterality", "left"), ("dicom_series_description", "right")},
        )

        bilateral_description = bridge.resolve_dicom_laterality_metadata([
            {"SeriesDescription": "LEFT AND RIGHT KNEES"},
        ])
        self.assertEqual(bilateral_description["status"], "conflict")
        self.assertIsNone(bilateral_description["laterality"])


class ArchiveSafetyTests(unittest.TestCase):
    def config(self, root: Path, **overrides: object) -> bridge.BridgeConfig:
        mat_root, registry = fake_mat_root(root)
        values = {
            "mat_planner_root": mat_root,
            "storage_root": root / "store",
            "registry_path": registry,
            "max_expanded_bytes": 1024 * 1024,
            "min_free_after_bytes": 0,
            "max_archive_members": 20,
        }
        values.update(overrides)
        return bridge.BridgeConfig(**values)

    def test_guarded_extract_accepts_regular_files_without_overwrite(self) -> None:
        root = new_work_dir("tar-ok")
        archive = root / "source.tar.gz"
        make_tar(archive, [("series", b"", "dir"), ("series/one", b"DICOM", "file")])
        config = self.config(root)
        inspection = bridge.inspect_tar_archive(archive, config)
        self.assertEqual(inspection.file_count, 1)
        destination = root / "extracted"
        bridge.safe_extract_tar(archive, destination, config)
        extracted_files = [path for path in destination.rglob("*") if path.is_file()]
        self.assertEqual(len(extracted_files), 1)
        self.assertEqual(extracted_files[0].read_bytes(), b"DICOM")
        self.assertRegex(extracted_files[0].name, r"^file-[0-9a-f]{24}\.bin$")
        self.assertNotIn("series", extracted_files[0].as_posix())
        with self.assertRaisesRegex(bridge.BridgeError, "nothing was overwritten"):
            bridge.safe_extract_tar(archive, destination, config)

    def test_rejects_traversal_links_duplicates_and_size_bombs(self) -> None:
        scenarios = {
            "traversal": [("../outside", b"x", "file")],
            "link": [("unsafe", b"", "symlink")],
            "duplicate": [("same", b"a", "file"), ("same", b"b", "file")],
        }
        for name, entries in scenarios.items():
            with self.subTest(name=name):
                root = new_work_dir(f"tar-{name}")
                archive = root / "source.tar.gz"
                make_tar(archive, entries)
                with self.assertRaises(bridge.BridgeError):
                    bridge.inspect_tar_archive(archive, self.config(root))
        root = new_work_dir("tar-size")
        archive = root / "source.tar.gz"
        make_tar(archive, [("large", b"x" * 2048, "file")])
        with self.assertRaisesRegex(bridge.BridgeError, "expanded archive"):
            bridge.inspect_tar_archive(archive, self.config(root, max_expanded_bytes=1024))

    def test_preflights_disk_before_creating_destination(self) -> None:
        root = new_work_dir("tar-disk")
        archive = root / "source.tar.gz"
        make_tar(archive, [("series/one", b"x" * 128, "file")])
        config = self.config(root, min_free_after_bytes=10**30)
        destination = root / "not-created"
        with self.assertRaisesRegex(bridge.BridgeError, "free space"):
            bridge.safe_extract_tar(archive, destination, config)
        self.assertFalse(destination.exists())


class NiftiPreflightTests(unittest.TestCase):
    def config(self, root: Path, **overrides: object) -> bridge.BridgeConfig:
        mat_root, registry = fake_mat_root(root)
        values = {
            "mat_planner_root": mat_root,
            "storage_root": root / "store",
            "registry_path": registry,
            "max_expanded_bytes": 1024 * 1024,
            "min_free_after_bytes": 0,
        }
        values.update(overrides)
        return bridge.BridgeConfig(**values)

    def test_accepts_bounded_scalar_3d_nifti_and_gzip(self) -> None:
        root = new_work_dir("nifti-valid")
        payload = make_nifti1_bytes((4, 5, 6))
        plain = root / "image.nii"
        compressed = root / "image.nii.gz"
        write_new(plain, payload)
        write_new(compressed, gzip.compress(payload))
        plain_result = bridge.inspect_nifti(plain, self.config(root))
        compressed_result = bridge.inspect_nifti(compressed, self.config(new_work_dir("nifti-valid-gz")))
        self.assertEqual(plain_result.dimensions, (4, 5, 6))
        self.assertFalse(plain_result.compressed)
        self.assertEqual(plain_result.expected_voxel_bytes, 120)
        self.assertTrue(compressed_result.compressed)
        self.assertEqual(compressed_result.uncompressed_bytes, len(payload))

    def test_rejects_invalid_dimensions_datatype_offset_and_truncation(self) -> None:
        cases = {
            "two-dimensional": make_nifti1_bytes((4, 4)),
            "multi-volume": make_nifti1_bytes((4, 4, 4, 2)),
            "datatype": make_nifti1_bytes((4, 4, 4), datatype_code=128, bits_per_voxel=24),
            "offset": make_nifti1_bytes((4, 4, 4), voxel_offset=100),
            "truncated": make_nifti1_bytes((4, 4, 4))[:-1],
        }
        for name, payload in cases.items():
            with self.subTest(name=name):
                root = new_work_dir(f"nifti-{name}")
                path = root / "image.nii"
                write_new(path, payload)
                with self.assertRaises(bridge.BridgeError):
                    bridge.inspect_nifti(path, self.config(root))

    def test_rejects_declared_size_and_compression_ratio_bombs(self) -> None:
        root = new_work_dir("nifti-size")
        plain = root / "image.nii"
        write_new(plain, make_nifti1_bytes((4, 4, 4)))
        with self.assertRaisesRegex(bridge.BridgeError, "expanded NIfTI"):
            bridge.inspect_nifti(plain, self.config(root, max_expanded_bytes=400))

        compressed_root = new_work_dir("nifti-ratio")
        compressed = compressed_root / "image.nii.gz"
        write_new(compressed, gzip.compress(make_nifti1_bytes((64, 64, 64))))
        with self.assertRaisesRegex(bridge.BridgeError, "compression ratio"):
            bridge.inspect_nifti(
                compressed,
                self.config(compressed_root, max_compression_ratio=2.0),
            )


class AssetStoreIntegrityTests(unittest.TestCase):
    def test_disk_capacity_preflight_precedes_asset_copy(self) -> None:
        root = new_work_dir("asset-disk")
        store = bridge.AssetStore(root / "store", min_free_after_bytes=100)
        source = root / "source.bin"
        write_new(source, b"payload")
        usage = types.SimpleNamespace(total=1000, used=950, free=50)
        with mock.patch.object(bridge.shutil, "disk_usage", return_value=usage):
            with self.assertRaisesRegex(bridge.BridgeError, "free space"):
                store.register_file(source, "private", "application/octet-stream", ".bin")
        self.assertEqual(list(store.assets_root.glob("asset-sha256-*")), [])

    def test_concurrent_same_hash_registration_is_single_and_verified(self) -> None:
        root = new_work_dir("asset-concurrent")
        store = bridge.AssetStore(root / "store")
        source = root / "mesh.json"
        write_new(source, b'{"schemaVersion":"mat-viewer-mesh.v1","vertices":[]}')

        def register() -> bridge.StoredAsset:
            return store.register_file(
                source,
                "femur_viewer_mesh",
                "application/json",
                ".json",
                api_readable=True,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            assets = list(executor.map(lambda _index: register(), range(16)))
        self.assertEqual(len({asset.asset_id for asset in assets}), 1)
        asset = store.get(assets[0].asset_id)
        self.assertTrue(asset.api_readable)
        self.assertEqual(len(list(store.assets_root.glob("asset-sha256-*"))), 1)

    def test_existing_private_content_cannot_be_escalated_to_api_readable(self) -> None:
        root = new_work_dir("asset-role")
        store = bridge.AssetStore(root / "store")
        source = root / "same.json"
        write_new(source, b'{"private":true}')
        private = store.register_file(source, "private_evidence", "application/json", ".json")
        reused = store.register_file(
            source,
            "femur_viewer_mesh",
            "application/json",
            ".json",
            api_readable=True,
        )
        self.assertEqual(reused.asset_id, private.asset_id)
        self.assertFalse(reused.api_readable)

    def test_get_rejects_tampered_payload(self) -> None:
        root = new_work_dir("asset-tamper")
        store = bridge.AssetStore(root / "store")
        expected = b"expected"
        claimed_hash = hashlib.sha256(expected).hexdigest()
        asset_id = f"asset-sha256-{claimed_hash}"
        asset_dir = store.assets_root / asset_id
        asset_dir.mkdir(mode=0o700)
        write_new(asset_dir / "payload.bin", b"tampered")
        bridge.write_json_new(asset_dir / "metadata.json", {
            "schemaVersion": "mat-nnunet-asset.v1",
            "assetId": asset_id,
            "kind": "immutable_raw_model_label_map",
            "sha256": claimed_hash,
            "byteLength": len(expected),
            "mediaType": "application/octet-stream",
            "storageName": "payload.bin",
            "immutable": True,
            "apiReadable": False,
        })
        with self.assertRaisesRegex(bridge.BridgeError, "hash verification"):
            store.get(asset_id)

    def test_read_job_uses_the_same_lock_as_event_writes(self) -> None:
        root = new_work_dir("job-lock")
        store = bridge.AssetStore(root / "store")
        source_file = root / "source.bin"
        write_new(source_file, b"source")
        source_hash, source_length = bridge.sha256_file(source_file)
        source = bridge.SourceDigest(f"source-sha256-{source_hash}", "nifti", source_hash, source_length, 1)
        source_asset = store.register_file(source_file, "nifti_source", "application/octet-stream", ".bin")
        job_id, _job_dir = bridge.create_job(store, source, source_asset)
        lock = bridge._job_lock(job_id)
        started = threading.Event()

        def read() -> dict[str, object]:
            started.set()
            return bridge.read_job(store, job_id)

        lock.acquire()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(read)
                self.assertTrue(started.wait(timeout=1.0))
                with self.assertRaises(concurrent.futures.TimeoutError):
                    future.result(timeout=0.05)
                lock.release()
                result = future.result(timeout=1.0)
                self.assertEqual(result["status"], "queued")
        finally:
            if lock.locked():
                lock.release()


class TransformAndContractTests(unittest.TestCase):
    def test_lps_voxel_transform_is_reversible_and_flips_to_ras_once(self) -> None:
        voxel_lps = bridge.voxel_to_lps_matrix(
            spacing=(0.5, 0.75, 2.0),
            direction=(0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0),
            origin=(100.0, 50.0, -20.0),
        )
        voxel_ras = bridge.multiply_matrix4(bridge.LPS_TO_RAS, voxel_lps)
        patient = bridge.transform_point(voxel_ras, (2.0, 4.0, 3.0))
        self.assertEqual(patient, [-103.0, -51.0, -26.0])
        recovered = bridge.transform_point(bridge.invert_matrix4(voxel_ras), patient)
        for actual, expected in zip(recovered, (2.0, 4.0, 3.0)):
            self.assertAlmostEqual(actual, expected, places=10)
        self.assertLess(bridge.matrix_roundtrip_error(voxel_ras, (64, 80, 32)), 1e-9)

    def test_capabilities_are_research_only_and_expose_no_model_paths(self) -> None:
        root = new_work_dir("capabilities")
        mat_root, registry = fake_mat_root(root)
        model_path = root / "private" / "Dataset500_KneeMRI" / "Trainer__Plans__3d_fullres"
        checkpoint = model_path / "fold_1" / "checkpoint_best.pth"
        write_new(checkpoint, b"checkpoint")
        spec = types.SimpleNamespace(
            id="model-one",
            backend="nnunetv2",
            model_path=str(model_path),
            use_folds=(1,),
            checkpoint_name="checkpoint_best.pth",
        )
        config = bridge.BridgeConfig(mat_root, root / "store", registry)
        with mock.patch.object(bridge, "_load_registry_specs", return_value=[spec]), mock.patch.object(bridge, "_mat_revision", return_value="a" * 40):
            value = bridge.capabilities(config)
        self.assertEqual(value["schemaVersion"], bridge.CAPABILITIES_SCHEMA)
        self.assertEqual(value["validationState"], "research_only")
        self.assertTrue(value["researchUseOnly"])
        serialized = json.dumps(value)
        self.assertNotIn(str(root), serialized)
        self.assertIn("fibula", value["requiredLabels"])

    def test_source_and_label_geometry_require_verified_identity_registration(self) -> None:
        matrix = bridge.multiply_matrix4(
            bridge.LPS_TO_RAS,
            bridge.voxel_to_lps_matrix(
                (0.6, 0.7, 1.2),
                (0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0),
                (12.0, -8.0, 3.0),
            ),
        )
        geometry = {
            "sizeVoxels": [32, 40, 24],
            "spacingMm": [0.6, 0.7, 1.2],
            "voxelToPatientRas": matrix,
            "patientRasToVoxel": bridge.invert_matrix4(matrix),
            "roundTripMaximumError": 0.0,
        }
        registration = bridge._geometry_registration(geometry, geometry)
        self.assertTrue(registration["verified"])
        self.assertLessEqual(registration["maximumIdentityDelta"], 1e-12)
        frames = bridge._coordinate_frames(geometry, geometry)
        self.assertEqual(len(frames), 6)
        source_frame = next(frame for frame in frames if frame["id"] == "source-voxel-ijk")
        self.assertEqual(source_frame["transformToPatientRas"], matrix)

        nifti_float32_roundtrip = dict(geometry)
        quantized_matrix = list(matrix)
        quantized_matrix[3] += 3.3e-6
        nifti_float32_roundtrip["voxelToPatientRas"] = quantized_matrix
        nifti_float32_roundtrip["patientRasToVoxel"] = bridge.invert_matrix4(quantized_matrix)
        quantized_registration = bridge._geometry_registration(geometry, nifti_float32_roundtrip)
        self.assertTrue(quantized_registration["verified"])
        self.assertEqual(quantized_registration["verificationTolerance"], bridge.GEOMETRY_REGISTRATION_TOLERANCE)

        shifted = dict(geometry)
        shifted_matrix = list(matrix)
        shifted_matrix[3] += 0.001
        shifted["voxelToPatientRas"] = shifted_matrix
        shifted["patientRasToVoxel"] = bridge.invert_matrix4(shifted_matrix)
        with self.assertRaisesRegex(bridge.BridgeError, "physical geometry"):
            bridge._geometry_registration(geometry, shifted)

        inconsistent_inverse = dict(geometry)
        inconsistent_inverse["patientRasToVoxel"] = list(bridge.IDENTITY_4)
        with self.assertRaisesRegex(bridge.BridgeError, "inverse transform"):
            bridge._geometry_registration(geometry, inconsistent_inverse)

    def test_artifact_processor_rejects_binary_mask_geometry_mismatch(self) -> None:
        try:
            import SimpleITK as sitk
        except ImportError:
            self.skipTest("SimpleITK is required for the MAT artifact geometry seam")

        root = new_work_dir("binary-geometry")
        mat_root, registry = fake_mat_root(root)
        config = bridge.BridgeConfig(
            mat_root,
            root / "store",
            registry,
            min_free_after_bytes=0,
        )
        standardized_path = root / "standardized.nii.gz"
        binary_path = root / "femur.nii.gz"
        standardized = sitk.Image([4, 4, 4], sitk.sitkUInt8)
        standardized.SetSpacing((0.5, 0.6, 0.7))
        standardized.SetOrigin((1.0, 2.0, 3.0))
        standardized[1, 1, 1] = 1
        sitk.WriteImage(standardized, str(standardized_path))
        mismatched = sitk.Image(standardized)
        mismatched.SetOrigin((1.001, 2.0, 3.0))
        sitk.WriteImage(mismatched, str(binary_path))
        source_geometry = bridge._image_geometry_from_sitk(standardized)
        outcome = bridge.RunnerOutcome(
            standardized_mask_path=standardized_path,
            binary_mask_paths={"femur": binary_path},
            raw_model_mask_path=None,
            selected_model=bridge.ModelEvidence(
                model_id="model",
                backend="nnunetv2",
                dataset="dataset",
                trainer="trainer",
                plans="plans",
                configuration="3d_fullres",
                folds=(0,),
                checkpoint_name="checkpoint.pth",
                model_path=root / "model",
                label_map={7: "femur"},
            ),
            selected_series={"orientation": "SAGITTAL", "axesCode": "LPS"},
            qc={},
            selected_input_geometry=source_geometry,
            algorithm_source_sha256="unused",
            model_artifact_provenance={},
        )
        job_dir = root / "job"
        job_dir.mkdir(mode=0o700)
        with self.assertRaisesRegex(bridge.BridgeError, "physical geometry"):
            bridge.MatArtifactProcessor(config).process(
                outcome,
                bridge.AssetStore(config.storage_root),
                job_dir,
            )


class ProvenanceTests(unittest.TestCase):
    def test_algorithm_hash_covers_all_python_pipeline_sources(self) -> None:
        root = new_work_dir("algorithm-hash")
        mat_root, registry = fake_mat_root(root)
        config = bridge.BridgeConfig(mat_root, root / "store", registry)
        before = bridge._algorithm_source_hash(config)
        write_new(mat_root / "knee_bone_masker" / "adapters" / "future_adapter.py", b"# included in provenance\n")
        after = bridge._algorithm_source_hash(config)
        self.assertNotEqual(before, after)

    def test_model_provenance_hashes_checkpoints_plans_and_dataset(self) -> None:
        root = new_work_dir("model-hash")
        model_path = root / "Dataset500_KneeMRI" / "Trainer__Plans__3d_fullres"
        write_new(model_path / "fold_0" / "checkpoint_best.pth", b"checkpoint-0")
        write_new(model_path / "fold_1" / "checkpoint_best.pth", b"checkpoint-1")
        write_new(model_path / "plans.json", b'{"plans":1}')
        write_new(model_path / "dataset.json", b'{"dataset":1}')
        model = bridge.ModelEvidence(
            model_id="model",
            backend="nnunetv2",
            dataset="Dataset500_KneeMRI",
            trainer="Trainer",
            plans="Plans",
            configuration="3d_fullres",
            folds=(0, 1),
            checkpoint_name="checkpoint_best.pth",
            model_path=model_path,
            label_map={7: "femur", 8: "tibia"},
        )
        value = bridge._selected_model_provenance(model)
        self.assertEqual([item["fold"] for item in value["checkpoints"]], [0, 1])
        self.assertEqual(
            [item["name"] for item in value["configurationArtifacts"]],
            ["plans.json", "dataset.json"],
        )
        component_hashes = {
            item["sha256"]
            for item in (*value["checkpoints"], *value["configurationArtifacts"])
        }
        self.assertEqual(len(component_hashes), 4)
        self.assertRegex(value["modelArtifactSha256"], r"^[0-9a-f]{64}$")


class ApiSecurityTests(unittest.TestCase):
    def config(self, root: Path, **overrides: object) -> bridge.BridgeConfig:
        mat_root, registry = fake_mat_root(root)
        values = {
            "mat_planner_root": mat_root,
            "storage_root": root / "store",
            "registry_path": registry,
            "max_upload_bytes": 1024 * 1024,
            "max_expanded_bytes": 1024 * 1024,
            "min_free_after_bytes": 0,
            "api_port": 4190,
        }
        values.update(overrides)
        return bridge.BridgeConfig(**values)

    @staticmethod
    def accepted_headers(content_length: str = "100") -> dict[str, str]:
        return {
            "Host": "127.0.0.1:4190",
            "Origin": "http://127.0.0.1:4173",
            bridge.REQUIRED_CLIENT_HEADER: bridge.REQUIRED_CLIENT_HEADER_VALUE,
            "Content-Length": content_length,
        }

    def test_preflight_header_contract_rejects_ambiguous_uploads(self) -> None:
        root = new_work_dir("api-headers")
        config = self.config(root)
        bridge.validate_api_request_headers(
            "POST",
            "/api/segmentation/jobs",
            self.accepted_headers(),
            config,
        )
        invalid_cases = {
            "host": {**self.accepted_headers(), "Host": "evil.example:4190"},
            "origin": {**self.accepted_headers(), "Origin": "http://127.0.0.1.evil:4173"},
            "client": {key: value for key, value in self.accepted_headers().items() if key != bridge.REQUIRED_CLIENT_HEADER},
            "length": {key: value for key, value in self.accepted_headers().items() if key != "Content-Length"},
            "chunked": {**self.accepted_headers(), "Transfer-Encoding": "chunked"},
            "oversized": {
                **self.accepted_headers(),
                "Content-Length": str(config.max_upload_bytes + bridge.MAX_MULTIPART_OVERHEAD_BYTES + 1),
            },
        }
        for name, headers in invalid_cases.items():
            with self.subTest(name=name), self.assertRaises(bridge.BridgeError):
                bridge.validate_api_request_headers("POST", "/api/segmentation/jobs", headers, config)

    def test_asgi_middleware_cors_busy_and_asset_allowlist(self) -> None:
        from fastapi.testclient import TestClient

        root = new_work_dir("api-asgi")
        config = self.config(root)
        store = bridge.AssetStore(config.storage_root)
        private_path = root / "private.nii.gz"
        safe_path = root / "mesh.json"
        write_new(private_path, b"private-label-map")
        write_new(safe_path, b'{"schemaVersion":"mat-viewer-mesh.v1"}')
        private_asset = store.register_file(
            private_path,
            "immutable_standardized_label_map",
            "application/vnd.nifti",
            ".nii.gz",
        )
        safe_asset = store.register_file(
            safe_path,
            "femur_viewer_mesh",
            "application/json",
            ".json",
            api_readable=True,
        )
        app = bridge.create_fastapi_app(config)
        origin = "http://127.0.0.1:4173"
        with TestClient(app, base_url="http://127.0.0.1:4190") as client:
            preflight = client.options(
                "/api/segmentation/jobs",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type,x-multilig-client",
                },
            )
            self.assertEqual(preflight.status_code, 200)
            self.assertEqual(preflight.headers["access-control-allow-origin"], origin)
            self.assertIn("x-multilig-client", preflight.headers["access-control-allow-headers"].lower())

            missing_client = client.post(
                "/api/segmentation/jobs",
                content=b"x",
                headers={"Origin": origin, "Content-Type": "multipart/form-data; boundary=x"},
            )
            self.assertEqual(missing_client.status_code, 403)
            self.assertEqual(missing_client.json()["detail"]["code"], "API_CLIENT_HEADER_REQUIRED")

            safe_response = client.get(
                f"/api/segmentation/assets/{safe_asset.asset_id}",
                headers={"Origin": origin},
            )
            self.assertEqual(safe_response.status_code, 200)
            self.assertEqual(safe_response.content, safe_path.read_bytes())
            private_response = client.get(
                f"/api/segmentation/assets/{private_asset.asset_id}",
                headers={"Origin": origin},
            )
            self.assertEqual(private_response.status_code, 403)
            self.assertEqual(private_response.json()["detail"]["code"], "ASSET_ACCESS_DENIED")

            self.assertTrue(app.state.inference_slot.acquire(blocking=False))
            try:
                busy = client.post(
                    "/api/segmentation/jobs",
                    files={"source": ("image.nii", make_nifti1_bytes(), "application/octet-stream")},
                    data={"source_kind": "nifti"},
                    headers={
                        "Origin": origin,
                        bridge.REQUIRED_CLIENT_HEADER: bridge.REQUIRED_CLIENT_HEADER_VALUE,
                    },
                )
                self.assertEqual(busy.status_code, 409)
                self.assertEqual(busy.json()["detail"]["code"], "SEGMENTATION_BUSY")
            finally:
                app.state.inference_slot.release()

    def test_asgi_rejects_upload_before_multipart_parsing_when_disk_is_low(self) -> None:
        from fastapi.testclient import TestClient

        root = new_work_dir("api-disk")
        config = self.config(root, min_free_after_bytes=100)
        app = bridge.create_fastapi_app(config)
        usage = types.SimpleNamespace(total=1000, used=950, free=50)
        with mock.patch.object(bridge.shutil, "disk_usage", return_value=usage):
            with TestClient(app, base_url="http://127.0.0.1:4190") as client:
                response = client.post(
                    "/api/segmentation/jobs",
                    content=b"not-even-valid-multipart",
                    headers={
                        "Origin": "http://127.0.0.1:4173",
                        bridge.REQUIRED_CLIENT_HEADER: bridge.REQUIRED_CLIENT_HEADER_VALUE,
                        "Content-Type": "multipart/form-data; boundary=x",
                    },
                )
        self.assertEqual(response.status_code, 507)
        self.assertEqual(response.json()["detail"]["code"], "INSUFFICIENT_DISK")


class FakePipelineSeamTests(unittest.TestCase):
    class FakeRunner:
        def __init__(self, model: bridge.ModelEvidence, config: bridge.BridgeConfig):
            self.model = model
            self.config = config

        def run(self, input_path: Path, output_dir: Path) -> bridge.RunnerOutcome:
            self.last_input = input_path
            standardized = output_dir / "bone_mask.nii.gz"
            write_new(standardized, b"standardized-mask")
            femur = output_dir / "femur_mask.nii.gz"
            tibia = output_dir / "tibia_mask.nii.gz"
            write_new(femur, b"femur-mask")
            write_new(tibia, b"tibia-mask")
            raw = output_dir / "raw.nii.gz"
            write_new(raw, b"raw-mask")
            return bridge.RunnerOutcome(
                standardized_mask_path=standardized,
                binary_mask_paths={"femur": femur, "tibia": tibia},
                raw_model_mask_path=raw,
                selected_model=self.model,
                selected_series={"orientation": "SAGITTAL", "axesCode": "LPS", "numFiles": 160},
                qc={"passed": True, "score": 96.0},
                selected_input_geometry={
                    "sizeVoxels": [8, 8, 8],
                    "spacingMm": [0.5, 0.5, 1.0],
                    "originLpsMm": [0.0, 0.0, 0.0],
                    "directionLps": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
                    "voxelToPatientRas": [-0.5, 0.0, 0.0, 0.0, 0.0, -0.5, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                    "patientRasToVoxel": [-2.0, 0.0, 0.0, 0.0, 0.0, -2.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                    "roundTripMaximumError": 0.0,
                },
                algorithm_source_sha256=bridge._algorithm_source_hash(self.config),
                model_artifact_provenance=bridge._selected_model_provenance(self.model),
            )

    class FakeProcessor:
        def process(
            self,
            outcome: bridge.RunnerOutcome,
            store: bridge.AssetStore,
            job_dir: Path,
        ) -> bridge.ProcessedEvidence:
            label_asset = store.register_file(
                outcome.standardized_mask_path,
                "immutable_standardized_label_map",
                "application/vnd.nifti",
                ".nii.gz",
            )
            voxel_to_ras = bridge.multiply_matrix4(
                bridge.LPS_TO_RAS,
                bridge.voxel_to_lps_matrix((0.5, 0.5, 1.0), bridge.IDENTITY_4[:3] + bridge.IDENTITY_4[4:7] + bridge.IDENTITY_4[8:11], (0.0, 0.0, 0.0)),
            )
            geometry = {
                "spacingMm": [0.5, 0.5, 1.0],
                "voxelToPatientRas": voxel_to_ras,
                "patientRasToVoxel": bridge.invert_matrix4(voxel_to_ras),
                "roundTripMaximumError": 0.0,
            }
            frames = bridge._coordinate_frames(geometry)
            bones = (
                {"bone": "femur", "status": "present", "reviewStatus": "unreviewed", "labelMapAssetId": label_asset.asset_id, "viewerMeshAssetId": None},
                {"bone": "tibia", "status": "present", "reviewStatus": "unreviewed", "labelMapAssetId": label_asset.asset_id, "viewerMeshAssetId": None},
                {"bone": "fibula", "status": "missing", "reviewStatus": "not_available", "labelMapAssetId": None, "viewerMeshAssetId": None},
            )
            return bridge.ProcessedEvidence(
                artifacts=(label_asset, label_asset),
                coordinate_frames=frames,
                geometry={"sizeVoxels": [8, 8, 8], "spacingMm": [0.5, 0.5, 1.0], "orientation": "SAGITTAL", "axesCode": "LPS", "roundTripMaximumError": 0.0},
                label_inventory=(
                    {"namespace": "mat_standardized", "labelValue": 1, "name": "femur", "voxelCount": 10, "volumeMm3": 2.5},
                    {"namespace": "mat_standardized", "labelValue": 2, "name": "tibia", "voxelCount": 11, "volumeMm3": 2.75},
                ),
                bones=bones,
                qc={"matBasicQc": {"passed": True}, "segmentationReviewStatus": "unreviewed"},
                warning_codes=("RESEARCH_ONLY", "FIBULA_NOT_PRODUCED_BY_MAT_MODEL"),
            )

    def test_fake_pipeline_builds_append_only_completed_manifest_without_paths(self) -> None:
        root = new_work_dir("fake-job")
        mat_root, registry = fake_mat_root(root)
        model_path = root / "models" / "Dataset500_KneeMRI" / "Trainer__Plans__3d_fullres"
        checkpoint = model_path / "fold_1" / "checkpoint_best.pth"
        write_new(checkpoint, b"checkpoint-contents")
        write_new(model_path / "plans.json", b'{"plans":"fake"}\n')
        write_new(model_path / "dataset.json", b'{"dataset":"fake"}\n')
        config = bridge.BridgeConfig(
            mat_root,
            root / "store",
            registry,
            min_free_after_bytes=0,
            min_inference_working_bytes=0,
        )
        store = bridge.AssetStore(config.storage_root)
        source_path = root / "opaque-input.nii.gz"
        write_new(source_path, b"source-bytes")
        source_hash, source_length = bridge.sha256_file(source_path)
        source = bridge.SourceDigest(f"source-sha256-{source_hash}", "nifti", source_hash, source_length, 1)
        source_asset = store.register_file(source_path, "nifti_source", "application/vnd.nifti", ".nii.gz")
        model = bridge.ModelEvidence(
            model_id="fake-model",
            backend="nnunetv2",
            dataset="Dataset500_KneeMRI",
            trainer="Trainer",
            plans="Plans",
            configuration="3d_fullres",
            folds=(1,),
            checkpoint_name="checkpoint_best.pth",
            model_path=model_path,
            label_map={7: "femur", 8: "tibia"},
        )
        job_id, job_dir = bridge.create_job(store, source, source_asset)
        event = bridge.execute_job(
            config,
            store,
            job_id,
            source,
            source_asset,
            runner=self.FakeRunner(model, config),
            processor=self.FakeProcessor(),
        )
        self.assertEqual(event["status"], "completed")
        self.assertEqual(event["result"]["runId"], job_id)
        self.assertEqual(event["result"]["requiredLabelStatus"], {"femur": "present", "tibia": "present", "fibula": "missing"})
        gates = event["result"]["reviewGates"]
        self.assertFalse(gates["lateralityVerified"])
        self.assertFalse(gates["scaleVerified"])
        self.assertFalse(gates["orientationVerified"])
        self.assertFalse(gates["boneIdentitiesVerified"])
        self.assertTrue(gates["sourceLabelMapsImmutable"])
        self.assertEqual(event["result"]["validationState"], "research_only")
        self.assertEqual(event["result"]["lateralityHint"], {
            "laterality": None,
            "status": "not_applicable",
            "confidence": "none",
            "evidence": [],
            "requiresClinicianVerification": True,
        })
        self.assertNotIn("assetId", event["result"]["source"])
        self.assertNotIn("url", event["result"]["source"])
        self.assertEqual(len(event["result"]["artifacts"]), 1)
        self.assertFalse(event["result"]["artifacts"][0]["apiReadable"])
        serialized = json.dumps(event["result"])
        self.assertNotIn(str(root), serialized)
        self.assertNotIn("opaque-input", serialized)
        events = sorted((job_dir / "events").glob("*.json"))
        self.assertGreaterEqual(len(events), 5)
        self.assertTrue((job_dir / "manifest.json").is_file())


if __name__ == "__main__":
    unittest.main()
