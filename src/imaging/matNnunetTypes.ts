/**
 * Versioned browser-to-local-service contract for MAT Planner's nnUNet v2
 * adapter. The bridge is research-only. It never conveys filesystem paths,
 * patient demographics, or clinician verification state.
 */

export const MAT_NNUNET_ADAPTER_ID = "mat-planner-knee-bone-masker-nnunetv2" as const;
export const MAT_NNUNET_CAPABILITIES_SCHEMA = "mat-nnunet-capabilities.v1" as const;
export const MAT_NNUNET_RESULT_SCHEMA = "mat-nnunet-result.v1" as const;
export const MAT_NNUNET_JOB_SCHEMA = "mat-nnunet-job.v1" as const;

export type MatNnunetSourceKind = "dicom_tar_gz" | "nifti";
export type MatNnunetBoneLabel = "femur" | "tibia" | "fibula";
export type MatNnunetLabelStatus = "segmented" | "missing" | "failed";
export type MatNnunetJobStatus = "queued" | "running" | "completed" | "failed";
export type MatNnunetModelStatus = "available" | "unavailable";
export type MatNnunetFrameKind = "dicom_patient" | "voxel" | "label_map" | "mesh" | "viewer_world";
export type MatNnunetSourceConvention = "RAS" | "LPS" | "IJK" | "MODEL_LOCAL" | "VIEWER_WORLD";
export type MatNnunetArtifactKind = "immutable_labelmap" | "surface_mesh";
export type MatNnunetImageOrientation = "SAGITTAL" | "CORONAL" | "AXIAL" | "UNKNOWN";
export type MatNnunetLateralityHintStatus = "resolved" | "conflict" | "absent" | "not_applicable";
export type MatNnunetLateralityHintConfidence = "high" | "low" | "none";
export type MatNnunetLateralityEvidenceSource =
  | "dicom_image_laterality"
  | "dicom_laterality"
  | "dicom_body_part_examined"
  | "dicom_series_description";
export type MatNnunetArtifactMediaType =
  | "application/x-nifti"
  | "application/vnd.nifti"
  | "application/gzip"
  | "application/json"
  | "model/stl"
  | "model/gltf-binary"
  | "application/vnd.vtk";

/** Validated machine code. Runtime parsing rejects paths and free-form text. */
export type MatNnunetWarningCode = string;

export type MatNnunetLabelIssueCode =
  | "MODEL_DOES_NOT_PREDICT_LABEL"
  | "NO_COMPONENT_FOUND"
  | "LABEL_GENERATION_FAILED"
  | "MESH_GENERATION_FAILED"
  | "FIBULA_NOT_PRODUCED_BY_MAT_MODEL";

export type MatNnunetMatrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type MatNnunetVector3 = readonly [number, number, number];

export interface MatNnunetCapabilityModel {
  id: string;
  algorithm: "nnUNetv2";
  version: string | null;
  sha256: string | null;
  status: MatNnunetModelStatus;
  labels: MatNnunetBoneLabel[];
}

export interface MatNnunetCapabilities {
  schemaVersion: typeof MAT_NNUNET_CAPABILITIES_SCHEMA;
  adapterId: typeof MAT_NNUNET_ADAPTER_ID;
  apiVersion: string;
  validationState: "research_only";
  researchUseOnly: true;
  accepts: MatNnunetSourceKind[];
  produces: MatNnunetArtifactKind[];
  requiredLabels: MatNnunetBoneLabel[];
  models: MatNnunetCapabilityModel[];
  maxUploadBytes: number;
}

export interface MatNnunetCoordinateFrameManifest {
  id: string;
  kind: MatNnunetFrameKind;
  units: "mm";
  sourceConvention: MatNnunetSourceConvention;
  transformToPatientRas: MatNnunetMatrix4;
  spacingMm?: MatNnunetVector3;
  dimensions?: MatNnunetVector3;
}

export interface MatNnunetArtifactManifest {
  id: string;
  kind: MatNnunetArtifactKind;
  mediaType: MatNnunetArtifactMediaType;
  sha256: string;
  byteLength: number;
  immutable: true;
  coordinateFrameId: string;
}

export interface MatNnunetMeshQualityManifest {
  manifold: boolean;
  watertight: boolean;
  vertexCount: number;
  triangleCount: number;
  boundaryEdgeCount: number;
  nonmanifoldEdgeCount: number;
  selfIntersections: number | null;
  /** True only when marching-cubes step size reduced the display mesh. */
  deterministicDisplayDecimation: boolean;
  marchingCubesStepSize: number;
  reviewStatus: "unreviewed";
}

/**
 * Privacy-safe advisory metadata. Raw DICOM values and free-form descriptions
 * are never exposed. A resolved side is still not clinician verification.
 */
export interface MatNnunetLateralityHint {
  laterality: "left" | "right" | null;
  status: MatNnunetLateralityHintStatus;
  confidence: MatNnunetLateralityHintConfidence;
  evidence: Array<{
    source: MatNnunetLateralityEvidenceSource;
    laterality: "left" | "right";
  }>;
  requiresClinicianVerification: true;
}

export type MatNnunetNotEvaluatedCode =
  | "fibula_segmentation"
  | "posterior_danger_anatomy"
  | "cortex_articular_clearance";

export interface MatNnunetSegmentedLabelManifest {
  label: MatNnunetBoneLabel;
  status: "segmented";
  labelValue: number;
  labelMap: MatNnunetArtifactManifest;
  mesh: MatNnunetArtifactManifest;
  meshQuality: MatNnunetMeshQualityManifest;
  warningCodes: MatNnunetWarningCode[];
}

export interface MatNnunetUnavailableLabelManifest {
  label: MatNnunetBoneLabel;
  status: "missing" | "failed";
  issueCode: MatNnunetLabelIssueCode;
  warningCodes: MatNnunetWarningCode[];
}

export type MatNnunetLabelManifest =
  | MatNnunetSegmentedLabelManifest
  | MatNnunetUnavailableLabelManifest;

export interface MatNnunetSegmentationManifest {
  schemaVersion: typeof MAT_NNUNET_RESULT_SCHEMA;
  adapterId: typeof MAT_NNUNET_ADAPTER_ID;
  runId: string;
  adapterVersion: string;
  validationState: "research_only";
  researchUseOnly: true;
  generatedAt: string;
  source: {
    kind: MatNnunetSourceKind;
    sha256: string;
    byteLength: number;
    immutable: true;
  };
  lateralityHint: MatNnunetLateralityHint;
  algorithm: {
    name: "nnUNetv2";
    modelId: string;
    modelVersion: string | null;
    modelSha256: string;
    pipelineName: string;
    modelDataset: string;
    modelTrainer: string;
    modelPlans: string;
    modelConfiguration: string;
    modelFolds: number[];
    checkpointName: string;
    checkpoints: Array<{
      fold: number;
      checkpointName: string;
      sha256: string;
      byteLength: number;
    }>;
    configurationArtifacts: Array<{
      name: "plans.json" | "dataset.json";
      sha256: string;
      byteLength: number;
    }>;
    nnunetv2Version: string | null;
    matPlannerRevision: string;
    registrySha256: string;
    algorithmSourceSha256: string;
  };
  coordinateFrames: MatNnunetCoordinateFrameManifest[];
  geometry: {
    spacingMm: MatNnunetVector3;
    sizeVoxels: MatNnunetVector3;
    orientation: "SAGITTAL" | "CORONAL" | "AXIAL" | "UNKNOWN";
    axesCode: string;
  };
  labels: MatNnunetLabelManifest[];
  notEvaluatedCodes: MatNnunetNotEvaluatedCode[];
  warningCodes: MatNnunetWarningCode[];
  review: {
    laterality: "unverified";
    scaleVerified: false;
    orientationVerified: false;
    boneIdentitiesVerified: false;
    meshQualityVerified: false;
    sourceLabelMapsImmutable: true;
  };
}

export interface MatNnunetJob {
  schemaVersion: typeof MAT_NNUNET_JOB_SCHEMA;
  jobId: string;
  status: MatNnunetJobStatus;
  progress?: number;
  updatedAt: string;
  result?: MatNnunetSegmentationManifest;
  error?: {
    code: string;
    message?: string;
  };
}

const SOURCE_KINDS = new Set<MatNnunetSourceKind>(["dicom_tar_gz", "nifti"]);
const BONE_LABELS = new Set<MatNnunetBoneLabel>(["femur", "tibia", "fibula"]);
const MODEL_STATUSES = new Set<MatNnunetModelStatus>(["available", "unavailable"]);
const FRAME_KINDS = new Set<MatNnunetFrameKind>(["dicom_patient", "voxel", "label_map", "mesh", "viewer_world"]);
const SOURCE_CONVENTIONS = new Set<MatNnunetSourceConvention>(["RAS", "LPS", "IJK", "MODEL_LOCAL", "VIEWER_WORLD"]);
const ARTIFACT_KINDS = new Set<MatNnunetArtifactKind>(["immutable_labelmap", "surface_mesh"]);
const IMAGE_ORIENTATIONS = new Set<MatNnunetImageOrientation>(["SAGITTAL", "CORONAL", "AXIAL", "UNKNOWN"]);
const LATERALITY_HINT_STATUSES = new Set<MatNnunetLateralityHintStatus>(["resolved", "conflict", "absent", "not_applicable"]);
const LATERALITY_HINT_CONFIDENCES = new Set<MatNnunetLateralityHintConfidence>(["high", "low", "none"]);
const LATERALITY_EVIDENCE_SOURCES = new Set<MatNnunetLateralityEvidenceSource>([
  "dicom_image_laterality",
  "dicom_laterality",
  "dicom_body_part_examined",
  "dicom_series_description",
]);
const MEDIA_TYPES = new Set<MatNnunetArtifactMediaType>([
  "application/x-nifti",
  "application/vnd.nifti",
  "application/gzip",
  "application/json",
  "model/stl",
  "model/gltf-binary",
  "application/vnd.vtk",
]);
const LABEL_ISSUE_CODES = new Set<MatNnunetLabelIssueCode>([
  "MODEL_DOES_NOT_PREDICT_LABEL",
  "NO_COMPONENT_FOUND",
  "LABEL_GENERATION_FAILED",
  "MESH_GENERATION_FAILED",
  "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
]);
const NOT_EVALUATED_CODES = new Set<MatNnunetNotEvaluatedCode>([
  "fibula_segmentation",
  "posterior_danger_anatomy",
  "cortex_articular_clearance",
]);
const JOB_STATUSES = new Set<MatNnunetJobStatus>(["queued", "running", "completed", "failed"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_WARNING_CODE = /^[A-Z][A-Z0-9_]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/i;

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${context} must be a non-empty string`);
  return value;
}

function safeId(value: unknown, context: string): string {
  const parsed = stringValue(value, context);
  if (!SAFE_ID.test(parsed)) throw new Error(`${context} must be an opaque identifier, not a path or free text`);
  return parsed;
}

function sha256(value: unknown, context: string): string {
  const parsed = stringValue(value, context);
  if (!SHA256.test(parsed)) throw new Error(`${context} must be a 64-character SHA-256 digest`);
  return parsed.toLowerCase();
}

function positiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function finiteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, context: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`${context} is unsupported`);
  return value as T;
}

function arrayValue(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function uniqueEnums<T extends string>(value: unknown, allowed: ReadonlySet<T>, context: string): T[] {
  const result = arrayValue(value, context).map((item, index) => enumValue(item, allowed, `${context}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${context} must not contain duplicates`);
  return result;
}

function vector3(value: unknown, context: string, integers: boolean): MatNnunetVector3 {
  const values = arrayValue(value, context);
  if (values.length !== 3) throw new Error(`${context} must contain exactly three values`);
  const parsed = values.map((item, index) => finiteNumber(item, `${context}[${index}]`));
  if (parsed.some((item) => item <= 0)) throw new Error(`${context} values must be positive`);
  if (integers && parsed.some((item) => !Number.isSafeInteger(item))) throw new Error(`${context} values must be integers`);
  return parsed as unknown as MatNnunetVector3;
}

function finiteVector(value: unknown, length: number, context: string): number[] {
  const values = arrayValue(value, context);
  if (values.length !== length) throw new Error(`${context} must contain exactly ${length} values`);
  return values.map((item, index) => finiteNumber(item, `${context}[${index}]`));
}

function matrixIsNonsingular(matrix: readonly number[]): boolean {
  const work = Array.from({ length: 4 }, (_, row) => matrix.slice(row * 4, row * 4 + 4));
  const scale = Math.max(1, ...matrix.map((item) => Math.abs(item)));
  const tolerance = scale * Number.EPSILON * 256;
  for (let column = 0; column < 4; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(work[row][column]) > Math.abs(work[pivotRow][column])) pivotRow = row;
    }
    if (Math.abs(work[pivotRow][column]) <= tolerance) return false;
    [work[column], work[pivotRow]] = [work[pivotRow], work[column]];
    const pivot = work[column][column];
    for (let row = column + 1; row < 4; row += 1) {
      const factor = work[row][column] / pivot;
      for (let next = column; next < 4; next += 1) work[row][next] -= factor * work[column][next];
    }
  }
  return true;
}

export function parseMatNnunetMatrix4(value: unknown, context = "transform"): MatNnunetMatrix4 {
  const values = arrayValue(value, context);
  if (values.length !== 16) throw new Error(`${context} must contain exactly 16 row-major values`);
  const parsed = values.map((item, index) => finiteNumber(item, `${context}[${index}]`));
  const homogeneous = Math.abs(parsed[12]) <= 1e-9
    && Math.abs(parsed[13]) <= 1e-9
    && Math.abs(parsed[14]) <= 1e-9
    && Math.abs(parsed[15] - 1) <= 1e-9;
  if (!homogeneous) throw new Error(`${context} must be a homogeneous affine transform`);
  if (!matrixIsNonsingular(parsed)) throw new Error(`${context} must be non-singular`);
  return parsed as unknown as MatNnunetMatrix4;
}

function parseFrame(value: unknown, index: number): MatNnunetCoordinateFrameManifest {
  const item = record(value, `coordinateFrames[${index}]`);
  if (item.units !== "mm") throw new Error(`coordinateFrames[${index}].units must be mm`);
  const kind = enumValue(item.kind, FRAME_KINDS, `coordinateFrames[${index}].kind`);
  const frame: MatNnunetCoordinateFrameManifest = {
    id: safeId(item.id, `coordinateFrames[${index}].id`),
    kind,
    units: "mm",
    sourceConvention: enumValue(item.sourceConvention, SOURCE_CONVENTIONS, `coordinateFrames[${index}].sourceConvention`),
    transformToPatientRas: parseMatNnunetMatrix4(item.transformToPatientRas, `coordinateFrames[${index}].transformToPatientRas`),
  };
  if (item.spacingMm !== undefined) frame.spacingMm = vector3(item.spacingMm, `coordinateFrames[${index}].spacingMm`, false);
  if (item.dimensions !== undefined) frame.dimensions = vector3(item.dimensions, `coordinateFrames[${index}].dimensions`, true);
  if ((kind === "voxel" || kind === "label_map") && (!frame.spacingMm || !frame.dimensions)) {
    throw new Error(`coordinateFrames[${index}] must preserve spacing and dimensions`);
  }
  return frame;
}

function parseArtifact(value: unknown, context: string): MatNnunetArtifactManifest {
  const item = record(value, context);
  if (item.immutable !== true) throw new Error(`${context}.immutable must remain true`);
  return {
    id: safeId(item.id, `${context}.id`),
    kind: enumValue(item.kind, ARTIFACT_KINDS, `${context}.kind`),
    mediaType: enumValue(item.mediaType, MEDIA_TYPES, `${context}.mediaType`),
    sha256: sha256(item.sha256, `${context}.sha256`),
    byteLength: positiveInteger(item.byteLength, `${context}.byteLength`),
    immutable: true,
    coordinateFrameId: safeId(item.coordinateFrameId, `${context}.coordinateFrameId`),
  };
}

function parseWarningCodes(value: unknown, context: string): MatNnunetWarningCode[] {
  const codes = arrayValue(value, context).map((item, index) => {
    const code = stringValue(item, `${context}[${index}]`);
    if (!SAFE_WARNING_CODE.test(code)) throw new Error(`${context}[${index}] must be a safe machine code`);
    return code;
  });
  if (new Set(codes).size !== codes.length) throw new Error(`${context} must not contain duplicates`);
  return codes;
}

function parseLateralityHint(
  value: unknown,
  sourceKind: MatNnunetSourceKind,
): MatNnunetLateralityHint {
  if (value === undefined) {
    return {
      laterality: null,
      status: sourceKind === "nifti" ? "not_applicable" : "absent",
      confidence: "none",
      evidence: [],
      requiresClinicianVerification: true,
    };
  }
  const item = record(value, "segmentation result.lateralityHint");
  if (item.requiresClinicianVerification !== true) {
    throw new Error("segmentation result.lateralityHint cannot claim clinician verification");
  }
  const status = enumValue(item.status, LATERALITY_HINT_STATUSES, "segmentation result.lateralityHint.status");
  const confidence = enumValue(
    item.confidence,
    LATERALITY_HINT_CONFIDENCES,
    "segmentation result.lateralityHint.confidence",
  );
  const laterality = item.laterality === null
    ? null
    : enumValue(item.laterality, new Set(["left", "right"] as const), "segmentation result.lateralityHint.laterality");
  const evidence = arrayValue(item.evidence, "segmentation result.lateralityHint.evidence").map((entry, index) => {
    const evidenceItem = record(entry, `segmentation result.lateralityHint.evidence[${index}]`);
    return {
      source: enumValue(
        evidenceItem.source,
        LATERALITY_EVIDENCE_SOURCES,
        `segmentation result.lateralityHint.evidence[${index}].source`,
      ),
      laterality: enumValue(
        evidenceItem.laterality,
        new Set(["left", "right"] as const),
        `segmentation result.lateralityHint.evidence[${index}].laterality`,
      ),
    };
  });
  const evidenceKeys = evidence.map((entry) => `${entry.source}:${entry.laterality}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) {
    throw new Error("segmentation result.lateralityHint.evidence must not contain duplicates");
  }
  const evidenceSides = new Set(evidence.map((entry) => entry.laterality));
  const hasDirectEvidence = evidence.some((entry) =>
    entry.source === "dicom_image_laterality" || entry.source === "dicom_laterality"
  );
  if (status === "resolved") {
    if (sourceKind === "nifti" || laterality === null || evidence.length === 0 || evidenceSides.size !== 1 || !evidenceSides.has(laterality)) {
      throw new Error("A resolved DICOM laterality hint must have unanimous evidence for one side");
    }
    if ((confidence === "high") !== hasDirectEvidence || confidence === "none") {
      throw new Error("DICOM laterality hint confidence does not match its evidence source");
    }
  } else {
    if (laterality !== null || confidence !== "none") {
      throw new Error("An unresolved DICOM laterality hint cannot select a side or confidence");
    }
    if (status === "conflict" && evidenceSides.size < 2) {
      throw new Error("A DICOM laterality conflict requires evidence for both sides");
    }
    if ((status === "absent" || status === "not_applicable") && evidence.length > 0) {
      throw new Error("An absent or inapplicable laterality hint cannot contain evidence");
    }
    if ((sourceKind === "nifti") !== (status === "not_applicable")) {
      throw new Error("Laterality metadata is only inapplicable for a NIfTI source");
    }
  }
  return {
    laterality,
    status,
    confidence,
    evidence,
    requiresClinicianVerification: true,
  };
}

function parseMeshQuality(value: unknown, context: string): MatNnunetMeshQualityManifest {
  const item = record(value, context);
  if (typeof item.manifold !== "boolean" || typeof item.watertight !== "boolean") {
    throw new Error(`${context} manifold/watertight values must be boolean`);
  }
  if (typeof item.deterministicDisplayDecimation !== "boolean" || item.reviewStatus !== "unreviewed") {
    throw new Error(`${context} decimation state must be boolean and review state must remain unreviewed`);
  }
  const selfIntersections = item.selfIntersections === null
    ? null
    : nonNegativeInteger(item.selfIntersections, `${context}.selfIntersections`);
  return {
    manifold: item.manifold,
    watertight: item.watertight,
    vertexCount: positiveInteger(item.vertexCount, `${context}.vertexCount`),
    triangleCount: positiveInteger(item.triangleCount, `${context}.triangleCount`),
    boundaryEdgeCount: nonNegativeInteger(item.boundaryEdgeCount, `${context}.boundaryEdgeCount`),
    nonmanifoldEdgeCount: nonNegativeInteger(item.nonmanifoldEdgeCount, `${context}.nonmanifoldEdgeCount`),
    selfIntersections,
    deterministicDisplayDecimation: item.deterministicDisplayDecimation,
    marchingCubesStepSize: positiveInteger(item.marchingCubesStepSize, `${context}.marchingCubesStepSize`),
    reviewStatus: "unreviewed",
  };
}

function parseLabel(value: unknown, index: number): MatNnunetLabelManifest {
  const item = record(value, `labels[${index}]`);
  const label = enumValue(item.label, BONE_LABELS, `labels[${index}].label`);
  const status = enumValue(item.status, new Set<MatNnunetLabelStatus>(["segmented", "missing", "failed"]), `labels[${index}].status`);
  const warningCodes = parseWarningCodes(item.warningCodes, `labels[${index}].warningCodes`);
  if (status === "segmented") {
    const labelMap = parseArtifact(item.labelMap, `labels[${index}].labelMap`);
    const mesh = parseArtifact(item.mesh, `labels[${index}].mesh`);
    if (labelMap.kind !== "immutable_labelmap") throw new Error(`labels[${index}].labelMap has the wrong artifact kind`);
    if (mesh.kind !== "surface_mesh") throw new Error(`labels[${index}].mesh has the wrong artifact kind`);
    return {
      label,
      status,
      labelValue: positiveInteger(item.labelValue, `labels[${index}].labelValue`),
      labelMap,
      mesh,
      meshQuality: parseMeshQuality(item.meshQuality, `labels[${index}].meshQuality`),
      warningCodes,
    };
  }
  return {
    label,
    status,
    issueCode: enumValue(item.issueCode, LABEL_ISSUE_CODES, `labels[${index}].issueCode`),
    warningCodes,
  };
}

function assertExactRequiredLabels(labels: readonly MatNnunetBoneLabel[], context: string): void {
  if (labels.length !== BONE_LABELS.size || [...BONE_LABELS].some((label) => !labels.includes(label))) {
    throw new Error(`${context} must explicitly include femur, tibia, and fibula`);
  }
}

export function parseMatNnunetCapabilities(value: unknown): MatNnunetCapabilities {
  const item = record(value, "capabilities");
  if (item.schemaVersion !== MAT_NNUNET_CAPABILITIES_SCHEMA) throw new Error("Unsupported capabilities schema version");
  if (item.adapterId !== MAT_NNUNET_ADAPTER_ID) throw new Error("Unexpected segmentation adapter");
  if (item.validationState !== "research_only" || item.researchUseOnly !== true) {
    throw new Error("MAT nnUNet adapter must remain research_only");
  }
  const requiredLabels = uniqueEnums(item.requiredLabels, BONE_LABELS, "capabilities.requiredLabels");
  assertExactRequiredLabels(requiredLabels, "capabilities.requiredLabels");
  const rawAccepts = arrayValue(item.accepts, "capabilities.accepts").map((entry, index) => {
    const accepted = stringValue(entry, `capabilities.accepts[${index}]`);
    if (!["dicom_tar_gz", "nifti", "dicom_folder_cli_only"].includes(accepted)) {
      throw new Error(`capabilities.accepts[${index}] is unsupported`);
    }
    return accepted;
  });
  if (new Set(rawAccepts).size !== rawAccepts.length) throw new Error("capabilities.accepts must not contain duplicates");
  const accepts = rawAccepts.filter((entry): entry is MatNnunetSourceKind => SOURCE_KINDS.has(entry as MatNnunetSourceKind));
  const producedLabels = item.producedLabels === undefined
    ? requiredLabels
    : arrayValue(item.producedLabels, "capabilities.producedLabels").map((entry, index) => stringValue(entry, `capabilities.producedLabels[${index}]`));
  const modelBoneLabels = producedLabels.filter((entry): entry is MatNnunetBoneLabel => BONE_LABELS.has(entry as MatNnunetBoneLabel));
  const models = arrayValue(item.models, "capabilities.models").map((value, index): MatNnunetCapabilityModel => {
    const model = record(value, `capabilities.models[${index}]`);
    const algorithm = model.algorithm ?? model.backend;
    if (algorithm !== "nnUNetv2" && algorithm !== "nnunetv2") {
      throw new Error(`capabilities.models[${index}] must use nnUNetv2`);
    }
    const labels = model.labels === undefined
      ? [...modelBoneLabels]
      : uniqueEnums(model.labels, BONE_LABELS, `capabilities.models[${index}].labels`);
    const version = model.version === undefined || model.version === null
      ? null
      : safeId(model.version, `capabilities.models[${index}].version`);
    const rawHash = model.sha256 ?? model.checkpointSha256;
    const modelHash = rawHash === undefined || rawHash === null
      ? null
      : sha256(rawHash, `capabilities.models[${index}].checkpointSha256`);
    const status = model.status === undefined
      ? (model.available === true ? "available" : model.available === false ? "unavailable" : null)
      : enumValue(model.status, MODEL_STATUSES, `capabilities.models[${index}].status`);
    if (status === null) throw new Error(`capabilities.models[${index}].available must be boolean`);
    return {
      id: safeId(model.id, `capabilities.models[${index}].id`),
      algorithm: "nnUNetv2",
      version,
      sha256: modelHash,
      status,
      labels,
    };
  });
  return {
    schemaVersion: MAT_NNUNET_CAPABILITIES_SCHEMA,
    adapterId: MAT_NNUNET_ADAPTER_ID,
    apiVersion: safeId(item.apiVersion, "capabilities.apiVersion"),
    validationState: "research_only",
    researchUseOnly: true,
    accepts,
    produces: item.produces === undefined
      ? ["immutable_labelmap", "surface_mesh"]
      : uniqueEnums(item.produces, ARTIFACT_KINDS, "capabilities.produces"),
    requiredLabels,
    models,
    maxUploadBytes: positiveInteger(item.maxUploadBytes, "capabilities.maxUploadBytes"),
  };
}

interface BridgeArtifactEvidence {
  id: string;
  kind: string;
  mediaType: MatNnunetArtifactMediaType;
  sha256: string;
  byteLength: number;
  immutable: true;
  apiReadable: boolean;
}

function multiply4(left: readonly number[], right: readonly number[]): number[] {
  return Array.from({ length: 16 }, (_, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    let sum = 0;
    for (let inner = 0; inner < 4; inner += 1) sum += left[row * 4 + inner] * right[inner * 4 + column];
    return sum;
  });
}

function assertInverseTransforms(
  forward: MatNnunetMatrix4,
  inverse: MatNnunetMatrix4,
  context: string,
): void {
  const products = [multiply4(forward, inverse), multiply4(inverse, forward)];
  for (const product of products) {
    const error = Math.max(...product.map((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0))));
    if (!Number.isFinite(error) || error > 1e-6) throw new Error(`${context} transforms are not reversible`);
  }
}

function bridgeArtifact(value: unknown, index: number): BridgeArtifactEvidence {
  const item = record(value, `segmentation result.artifacts[${index}]`);
  const id = safeId(item.assetId, `segmentation result.artifacts[${index}].assetId`);
  if (item.immutable !== true) throw new Error(`segmentation result.artifacts[${index}].immutable must remain true`);
  const kind = stringValue(item.kind, `segmentation result.artifacts[${index}].kind`);
  if (!/^[a-z][a-z0-9_]{0,95}$/.test(kind)) throw new Error(`segmentation result.artifacts[${index}].kind is invalid`);
  const artifactSha256 = sha256(item.sha256, `segmentation result.artifacts[${index}].sha256`);
  if (id !== `asset-sha256-${artifactSha256}`) throw new Error(`segmentation result.artifacts[${index}].assetId must match its SHA-256`);
  if (typeof item.apiReadable !== "boolean") throw new Error(`segmentation result.artifacts[${index}].apiReadable must be boolean`);
  if (item.apiReadable) {
    if (item.url !== `/api/segmentation/assets/${id}`) {
      throw new Error(`segmentation result.artifacts[${index}].url must be the declared loopback asset route`);
    }
    if (!/^(femur|tibia)_viewer_mesh$/.test(kind) || item.mediaType !== "application/json") {
      throw new Error(`segmentation result.artifacts[${index}] exposes an unsupported public asset role`);
    }
  } else if (item.url !== undefined) {
    throw new Error(`segmentation result.artifacts[${index}] must not expose a URL for a protected asset`);
  }
  return {
    id,
    kind,
    mediaType: enumValue(item.mediaType, MEDIA_TYPES, `segmentation result.artifacts[${index}].mediaType`),
    sha256: artifactSha256,
    byteLength: positiveInteger(item.byteLength, `segmentation result.artifacts[${index}].byteLength`),
    immutable: true,
    apiReadable: item.apiReadable,
  };
}

function normalizeBridgeWarningCodes(value: unknown): MatNnunetWarningCode[] {
  const raw = parseWarningCodes(value, "segmentation result.warningCodes");
  const aliases: Record<string, string> = {
    LATERALITY_NOT_VERIFIED: "LATERALITY_UNVERIFIED",
    SCALE_NOT_VERIFIED: "SCALE_UNVERIFIED",
    ORIENTATION_NOT_VERIFIED: "ORIENTATION_UNVERIFIED",
    FIBULA_NOT_PRODUCED_BY_MAT_MODEL: "FIBULA_NOT_PREDICTED",
  };
  return [...new Set(raw.flatMap((code) => aliases[code] ? [code, aliases[code]] : [code]))];
}

function normalizeBridgeCoordinateFrames(value: unknown, dimensions: MatNnunetVector3): Record<string, unknown>[] {
  return arrayValue(value, "segmentation result.coordinateFrames").map((entry, index) => {
    const item = record(entry, `segmentation result.coordinateFrames[${index}]`);
    if (item.physicalUnits !== "mm") throw new Error(`segmentation result.coordinateFrames[${index}].physicalUnits must be mm`);
    if (item.scaleVerified !== false) throw new Error(`segmentation result.coordinateFrames[${index}] scale must remain unverified`);
    const kind = enumValue(item.kind, FRAME_KINDS, `segmentation result.coordinateFrames[${index}].kind`);
    const forward = parseMatNnunetMatrix4(
      item.transformToPatientRas,
      `segmentation result.coordinateFrames[${index}].transformToPatientRas`,
    );
    const inverse = parseMatNnunetMatrix4(
      item.transformFromPatientRas,
      `segmentation result.coordinateFrames[${index}].transformFromPatientRas`,
    );
    assertInverseTransforms(forward, inverse, `segmentation result.coordinateFrames[${index}]`);
    const normalized: Record<string, unknown> = {
      id: safeId(item.id, `segmentation result.coordinateFrames[${index}].id`),
      kind,
      units: "mm",
      sourceConvention: enumValue(
        item.sourceConvention,
        SOURCE_CONVENTIONS,
        `segmentation result.coordinateFrames[${index}].sourceConvention`,
      ),
      transformToPatientRas: forward,
    };
    if (kind === "voxel" || kind === "label_map") {
      normalized.spacingMm = vector3(item.spacingMm, `segmentation result.coordinateFrames[${index}].spacingMm`, false);
      normalized.dimensions = dimensions;
      if (item.coordinateUnits !== "index") throw new Error(`segmentation result.coordinateFrames[${index}].coordinateUnits must be index`);
    } else if (item.coordinateUnits !== "mm") {
      throw new Error(`segmentation result.coordinateFrames[${index}].coordinateUnits must be mm`);
    }
    return normalized;
  });
}

function normalizeBridgeResult(rawValue: Record<string, unknown>): Record<string, unknown> {
  const geometry = record(rawValue.geometry, "segmentation result.geometry");
  const dimensions = vector3(geometry.sizeVoxels, "segmentation result.geometry.sizeVoxels", true);
  const spacing = vector3(geometry.spacingMm, "segmentation result.geometry.spacingMm", false);
  const orientation = enumValue(
    geometry.orientation,
    IMAGE_ORIENTATIONS,
    "segmentation result.geometry.orientation",
  );
  const axesCode = stringValue(geometry.axesCode, "segmentation result.geometry.axesCode").toUpperCase();
  if (
    axesCode.length !== 3
    || !["L", "R"].some((axis) => axesCode.includes(axis))
    || !["A", "P"].some((axis) => axesCode.includes(axis))
    || !["S", "I"].some((axis) => axesCode.includes(axis))
  ) throw new Error("segmentation result.geometry.axesCode must contain one LR, AP, and SI axis");
  const roundTripError = finiteNumber(geometry.roundTripMaximumError, "segmentation result.geometry.roundTripMaximumError");
  if (roundTripError < 0 || roundTripError > 1e-4) throw new Error("segmentation result geometry transform round-trip error is too large");
  const sourceImageGeometry = record(geometry.sourceImage, "segmentation result.geometry.sourceImage");
  const finalLabelGeometry = record(geometry.finalLabelMap, "segmentation result.geometry.finalLabelMap");
  const sourceGeometrySize = vector3(sourceImageGeometry.sizeVoxels, "segmentation result.geometry.sourceImage.sizeVoxels", true);
  const labelGeometrySize = vector3(finalLabelGeometry.sizeVoxels, "segmentation result.geometry.finalLabelMap.sizeVoxels", true);
  const sourceGeometrySpacing = vector3(sourceImageGeometry.spacingMm, "segmentation result.geometry.sourceImage.spacingMm", false);
  const labelGeometrySpacing = vector3(finalLabelGeometry.spacingMm, "segmentation result.geometry.finalLabelMap.spacingMm", false);
  finiteVector(sourceImageGeometry.originLpsMm, 3, "segmentation result.geometry.sourceImage.originLpsMm");
  finiteVector(finalLabelGeometry.originLpsMm, 3, "segmentation result.geometry.finalLabelMap.originLpsMm");
  finiteVector(sourceImageGeometry.directionLps, 9, "segmentation result.geometry.sourceImage.directionLps");
  finiteVector(finalLabelGeometry.directionLps, 9, "segmentation result.geometry.finalLabelMap.directionLps");
  if (sourceImageGeometry.frameId !== "source-voxel-ijk" || finalLabelGeometry.frameId !== "label-voxel-ijk") {
    throw new Error("Segmentation source/final geometry must identify the declared indexed frames");
  }
  if (
    sourceGeometrySize.some((value, index) => value !== dimensions[index])
    || labelGeometrySize.some((value, index) => value !== dimensions[index])
    || sourceGeometrySpacing.some((value, index) => Math.abs(value - spacing[index]) > 1e-7)
    || labelGeometrySpacing.some((value, index) => Math.abs(value - spacing[index]) > 1e-7)
  ) throw new Error("Segmentation source and final label-map geometry must match the registered image geometry");
  const registration = record(geometry.sourceToLabelRegistration, "segmentation result.geometry.sourceToLabelRegistration");
  if (
    registration.verified !== true
    || registration.sourceFrameId !== "source-voxel-ijk"
    || registration.labelFrameId !== "label-voxel-ijk"
  ) throw new Error("Segmentation source-to-label registration must be explicitly verified");
  const sourceToLabel = parseMatNnunetMatrix4(
    registration.sourceVoxelToLabelVoxel,
    "segmentation result.geometry.sourceToLabelRegistration.sourceVoxelToLabelVoxel",
  );
  const labelToSource = parseMatNnunetMatrix4(
    registration.labelVoxelToSourceVoxel,
    "segmentation result.geometry.sourceToLabelRegistration.labelVoxelToSourceVoxel",
  );
  assertInverseTransforms(sourceToLabel, labelToSource, "segmentation result.geometry.sourceToLabelRegistration");
  const registrationTolerance = finiteNumber(
    registration.verificationTolerance,
    "segmentation result.geometry.sourceToLabelRegistration.verificationTolerance",
  );
  const registrationErrors = [
    "maximumPhysicalMatrixDelta",
    "maximumIdentityDelta",
    "maximumInverseMatrixDelta",
  ].map((key) => finiteNumber(registration[key], `segmentation result.geometry.sourceToLabelRegistration.${key}`));
  if (
    registrationTolerance <= 0
    || registrationTolerance > 1e-4
    || registrationErrors.some((error) => error < 0 || error > registrationTolerance)
    || sourceToLabel.some((value, index) => Math.abs(value - (index % 5 === 0 ? 1 : 0)) > registrationTolerance)
  ) throw new Error("Segmentation source-to-label registration exceeds its declared tolerance");
  const coordinateFrames = normalizeBridgeCoordinateFrames(rawValue.coordinateFrames, dimensions);
  const labelFrame = coordinateFrames.find((frame) => frame.kind === "label_map");
  if (!labelFrame) throw new Error("Segmentation result requires an immutable label-map coordinate frame");

  const artifacts = arrayValue(rawValue.artifacts, "segmentation result.artifacts").map(bridgeArtifact);
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  if (artifactById.size !== artifacts.length) throw new Error("Segmentation artifact identifiers must be unique");

  const inventory = arrayValue(rawValue.labelInventory, "segmentation result.labelInventory").map((entry, index) => {
    const item = record(entry, `segmentation result.labelInventory[${index}]`);
    const namespace = safeId(item.namespace, `segmentation result.labelInventory[${index}].namespace`);
    const name = safeId(item.name, `segmentation result.labelInventory[${index}].name`);
    return {
      namespace,
      name,
      labelValue: positiveInteger(item.labelValue, `segmentation result.labelInventory[${index}].labelValue`),
    };
  });
  const labelValueByBone = new Map<MatNnunetBoneLabel, number>();
  for (const item of inventory) {
    if (item.namespace === "mat_standardized" && BONE_LABELS.has(item.name as MatNnunetBoneLabel)) {
      const bone = item.name as MatNnunetBoneLabel;
      if (labelValueByBone.has(bone)) throw new Error(`Multiple standardized inventory values exist for ${bone}`);
      labelValueByBone.set(bone, item.labelValue);
    }
  }

  const warningCodes = normalizeBridgeWarningCodes(rawValue.warningCodes);
  const requiredStatus = record(rawValue.requiredLabelStatus, "segmentation result.requiredLabelStatus");
  const rawBones = arrayValue(rawValue.bones, "segmentation result.bones");
  const seenBones = new Set<MatNnunetBoneLabel>();
  const normalizedLabels = rawBones.map((entry, index): Record<string, unknown> => {
    const item = record(entry, `segmentation result.bones[${index}]`);
    const bone = enumValue(item.bone, BONE_LABELS, `segmentation result.bones[${index}].bone`);
    if (seenBones.has(bone)) throw new Error("Segmentation bone statuses must be unique");
    seenBones.add(bone);
    const rawStatus = stringValue(item.status, `segmentation result.bones[${index}].status`);
    if (rawStatus !== "present" && rawStatus !== "missing") throw new Error(`segmentation result.bones[${index}].status is unsupported`);
    if (requiredStatus[bone] !== rawStatus) throw new Error(`requiredLabelStatus does not match the ${bone} record`);
    const reviewStatus = stringValue(item.reviewStatus, `segmentation result.bones[${index}].reviewStatus`);
    if (rawStatus === "present" && reviewStatus !== "unreviewed") throw new Error(`${bone} must remain unreviewed`);
    if (rawStatus === "missing") {
      if (reviewStatus !== "unreviewed" && reviewStatus !== "not_available") throw new Error(`${bone} missing status is invalid`);
      return {
        label: bone,
        status: "missing",
        issueCode: bone === "fibula" ? "FIBULA_NOT_PRODUCED_BY_MAT_MODEL" : "NO_COMPONENT_FOUND",
        warningCodes: bone === "fibula" ? ["FIBULA_NOT_PRODUCED_BY_MAT_MODEL", "FIBULA_NOT_PREDICTED", "LABEL_MISSING"] : ["LABEL_MISSING"],
      };
    }

    const labelMapId = safeId(item.labelMapAssetId, `segmentation result.bones[${index}].labelMapAssetId`);
    const labelMap = artifactById.get(labelMapId);
    if (!labelMap) throw new Error(`${bone} references an unknown label-map artifact`);
    if (
      labelMap.kind !== `immutable_${bone}_label_map`
      || labelMap.mediaType !== "application/vnd.nifti"
      || labelMap.apiReadable
    ) throw new Error(`${bone} references an artifact with the wrong protected label-map role`);
    const meshId = item.viewerMeshAssetId === null || item.viewerMeshAssetId === undefined
      ? null
      : safeId(item.viewerMeshAssetId, `segmentation result.bones[${index}].viewerMeshAssetId`);
    const mesh = meshId ? artifactById.get(meshId) : undefined;
    if (!mesh) {
      return {
        label: bone,
        status: "failed",
        issueCode: "MESH_GENERATION_FAILED",
        warningCodes: ["LABEL_FAILED", `${bone.toUpperCase()}_VIEWER_MESH_NOT_GENERATED`],
      };
    }
    if (
      mesh.kind !== `${bone}_viewer_mesh`
      || mesh.mediaType !== "application/json"
      || !mesh.apiReadable
    ) throw new Error(`${bone} references an artifact with the wrong public viewer-mesh role`);
    const meshFrameId = safeId(item.coordinateFrameId, `segmentation result.bones[${index}].coordinateFrameId`);
    const labelValue = labelValueByBone.get(bone);
    if (!labelValue) throw new Error(`${bone} is present but lacks a standardized label value`);
    const meshQuality = parseMeshQuality(item.meshQuality, `segmentation result.bones[${index}].meshQuality`);
    return {
      label: bone,
      status: "segmented",
      labelValue,
      labelMap: {
        id: labelMap.id,
        kind: "immutable_labelmap",
        mediaType: labelMap.mediaType,
        sha256: labelMap.sha256,
        byteLength: labelMap.byteLength,
        immutable: true,
        coordinateFrameId: labelFrame.id,
      },
      mesh: {
        id: mesh.id,
        kind: "surface_mesh",
        mediaType: mesh.mediaType,
        sha256: mesh.sha256,
        byteLength: mesh.byteLength,
        immutable: true,
        coordinateFrameId: meshFrameId,
      },
      meshQuality,
      warningCodes: ["MESH_QUALITY_UNVERIFIED"],
    };
  });
  assertExactRequiredLabels([...seenBones], "segmentation result.bones");

  const gates = record(rawValue.reviewGates, "segmentation result.reviewGates");
  if (
    gates.lateralityVerified !== false
    || gates.scaleVerified !== false
    || gates.orientationVerified !== false
    || gates.boneIdentitiesVerified !== false
    || gates.sourceLabelMapsImmutable !== true
  ) {
    throw new Error("Segmentation review flags must remain unverified until clinician review");
  }
  const qc = record(rawValue.qc, "segmentation result.qc");
  if (qc.meshQualityReviewed !== undefined && qc.meshQualityReviewed !== false) {
    throw new Error("Segmentation mesh quality must remain unverified until clinician review");
  }
  const notEvaluatedMap = new Map<string, MatNnunetNotEvaluatedCode>([
    ["fibula segmentation", "fibula_segmentation"],
    ["posterior neurovascular and other danger anatomy", "posterior_danger_anatomy"],
    ["cortex/articular clearance against imported meshes", "cortex_articular_clearance"],
  ]);
  const notEvaluatedCodes = arrayValue(rawValue.notEvaluated, "segmentation result.notEvaluated").map((entry, index) => {
    const label = stringValue(entry, `segmentation result.notEvaluated[${index}]`);
    const code = notEvaluatedMap.get(label);
    if (!code) throw new Error(`segmentation result.notEvaluated[${index}] is unsupported`);
    return code;
  });
  if (new Set(notEvaluatedCodes).size !== notEvaluatedCodes.length) {
    throw new Error("segmentation result.notEvaluated must not contain duplicates");
  }

  const algorithm = record(rawValue.algorithm, "segmentation result.algorithm");
  if (algorithm.name !== "MAT Planner knee_bone_masker.BoneMaskPipeline") {
    throw new Error("Unexpected MAT segmentation pipeline");
  }
  const model = record(algorithm.model, "segmentation result.algorithm.model");
  if (model.backend !== "nnunetv2") throw new Error("MAT segmentation result must use nnUNetv2");
  const checkpoints = arrayValue(model.checkpoints, "segmentation result.algorithm.model.checkpoints");
  if (checkpoints.length === 0) throw new Error("At least one hashed nnUNet checkpoint is required");
  const checkpointFolds = new Set<number>();
  const parsedCheckpoints = checkpoints.map((entry, index) => {
    const checkpoint = record(entry, `segmentation result.algorithm.model.checkpoints[${index}]`);
    if (typeof checkpoint.fold !== "number" || !Number.isSafeInteger(checkpoint.fold) || checkpoint.fold < 0) {
      throw new Error(`segmentation result.algorithm.model.checkpoints[${index}].fold must be a non-negative integer`);
    }
    if (checkpointFolds.has(checkpoint.fold)) throw new Error("nnUNet checkpoint folds must be unique");
    checkpointFolds.add(checkpoint.fold);
    return {
      fold: checkpoint.fold,
      checkpointName: safeId(checkpoint.checkpointName, `segmentation result.algorithm.model.checkpoints[${index}].checkpointName`),
      sha256: sha256(checkpoint.sha256, `segmentation result.algorithm.model.checkpoints[${index}].sha256`),
      byteLength: positiveInteger(checkpoint.byteLength, `segmentation result.algorithm.model.checkpoints[${index}].byteLength`),
    };
  });
  const modelFolds = arrayValue(model.folds, "segmentation result.algorithm.model.folds").map((fold, index) => {
    if (typeof fold !== "number" || !Number.isSafeInteger(fold) || fold < 0) {
      throw new Error(`segmentation result.algorithm.model.folds[${index}] must be a non-negative integer`);
    }
    return fold;
  });
  if (new Set(modelFolds).size !== modelFolds.length || modelFolds.some((fold) => !checkpointFolds.has(fold)) || modelFolds.length !== checkpointFolds.size) {
    throw new Error("nnUNet model folds must exactly match checkpoint evidence");
  }
  const configurationArtifacts = arrayValue(
    model.configurationArtifacts,
    "segmentation result.algorithm.model.configurationArtifacts",
  ).map((entry, index) => {
    const artifact = record(entry, `segmentation result.algorithm.model.configurationArtifacts[${index}]`);
    if (artifact.name !== "plans.json" && artifact.name !== "dataset.json") {
      throw new Error(`segmentation result.algorithm.model.configurationArtifacts[${index}].name is unsupported`);
    }
    return {
      name: artifact.name,
      sha256: sha256(artifact.sha256, `segmentation result.algorithm.model.configurationArtifacts[${index}].sha256`),
      byteLength: positiveInteger(artifact.byteLength, `segmentation result.algorithm.model.configurationArtifacts[${index}].byteLength`),
    };
  });
  if (
    configurationArtifacts.length !== 2
    || new Set(configurationArtifacts.map((artifact) => artifact.name)).size !== 2
  ) throw new Error("nnUNet provenance requires unique plans.json and dataset.json evidence");
  const nnunetv2Version = algorithm.nnunetv2Version === undefined || algorithm.nnunetv2Version === null
    ? null
    : safeId(algorithm.nnunetv2Version, "segmentation result.algorithm.nnunetv2Version");

  const source = record(rawValue.source, "segmentation result.source");
  return {
    ...rawValue,
    source: {
      kind: source.kind,
      sha256: source.sha256,
      byteLength: source.byteLength,
      immutable: source.immutable,
    },
    algorithm: {
      name: "nnUNetv2",
      modelId: model.id,
      modelVersion: null,
      modelSha256: model.modelArtifactSha256,
      pipelineName: algorithm.name,
      modelDataset: safeId(model.dataset, "segmentation result.algorithm.model.dataset"),
      modelTrainer: safeId(model.trainer, "segmentation result.algorithm.model.trainer"),
      modelPlans: safeId(model.plans, "segmentation result.algorithm.model.plans"),
      modelConfiguration: safeId(model.configuration, "segmentation result.algorithm.model.configuration"),
      modelFolds,
      checkpointName: safeId(model.checkpointName, "segmentation result.algorithm.model.checkpointName"),
      checkpoints: parsedCheckpoints,
      configurationArtifacts,
      nnunetv2Version,
      matPlannerRevision: safeId(algorithm.matPlannerRevision, "segmentation result.algorithm.matPlannerRevision"),
      registrySha256: sha256(algorithm.registrySha256, "segmentation result.algorithm.registrySha256"),
      algorithmSourceSha256: sha256(algorithm.algorithmSourceSha256, "segmentation result.algorithm.algorithmSourceSha256"),
    },
    coordinateFrames,
    labels: normalizedLabels,
    notEvaluatedCodes,
    warningCodes,
    review: {
      laterality: "unverified",
      scaleVerified: false,
      orientationVerified: false,
      boneIdentitiesVerified: false,
      meshQualityVerified: false,
      sourceLabelMapsImmutable: true,
    },
    geometry: { spacingMm: spacing, sizeVoxels: dimensions, orientation, axesCode },
  };
}

export function parseMatNnunetSegmentationManifest(value: unknown): MatNnunetSegmentationManifest {
  const raw = record(value, "segmentation result");
  const item = raw.bones === undefined ? raw : normalizeBridgeResult(raw);
  if (item.schemaVersion !== MAT_NNUNET_RESULT_SCHEMA) throw new Error("Unsupported segmentation result schema version");
  if (item.adapterId !== MAT_NNUNET_ADAPTER_ID) throw new Error("Unexpected segmentation adapter");
  if (item.validationState !== "research_only" || item.researchUseOnly !== true) {
    throw new Error("MAT nnUNet segmentation must remain research_only");
  }
  const generatedAt = stringValue(item.generatedAt, "segmentation result.generatedAt");
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("segmentation result.generatedAt must be an ISO date-time");

  const source = record(item.source, "segmentation result.source");
  if (source.immutable !== true) throw new Error("segmentation result.source.immutable must remain true");
  const algorithm = record(item.algorithm, "segmentation result.algorithm");
  if (algorithm.name !== "nnUNetv2") throw new Error("segmentation result.algorithm.name must be nnUNetv2");
  const review = record(item.review, "segmentation result.review");
  if (
    review.laterality !== "unverified"
    || review.scaleVerified !== false
    || review.orientationVerified !== false
    || review.boneIdentitiesVerified !== false
    || review.meshQualityVerified !== false
    || review.sourceLabelMapsImmutable !== true
  ) {
    throw new Error("Segmentation review flags must remain unverified until clinician review");
  }
  const geometry = record(item.geometry, "segmentation result.geometry");
  const geometryOrientation = enumValue(
    geometry.orientation,
    IMAGE_ORIENTATIONS,
    "segmentation result.geometry.orientation",
  );
  const geometryAxesCode = stringValue(geometry.axesCode, "segmentation result.geometry.axesCode").toUpperCase();
  if (
    geometryAxesCode.length !== 3
    || !["L", "R"].some((axis) => geometryAxesCode.includes(axis))
    || !["A", "P"].some((axis) => geometryAxesCode.includes(axis))
    || !["S", "I"].some((axis) => geometryAxesCode.includes(axis))
  ) throw new Error("segmentation result.geometry.axesCode must contain one LR, AP, and SI axis");

  const coordinateFrames = arrayValue(item.coordinateFrames, "segmentation result.coordinateFrames").map(parseFrame);
  const frameIds = new Set(coordinateFrames.map((frame) => frame.id));
  if (frameIds.size !== coordinateFrames.length) throw new Error("Coordinate frame identifiers must be unique");
  if (!coordinateFrames.some((frame) => frame.kind === "voxel" || frame.kind === "label_map")) {
    throw new Error("A voxel or label-map coordinate frame is required");
  }

  const labels = arrayValue(item.labels, "segmentation result.labels").map(parseLabel);
  const notEvaluatedCodes = uniqueEnums(
    item.notEvaluatedCodes,
    NOT_EVALUATED_CODES,
    "segmentation result.notEvaluatedCodes",
  );
  const labelNames = labels.map((label) => label.label);
  if (new Set(labelNames).size !== labelNames.length) throw new Error("Segmentation labels must be unique");
  assertExactRequiredLabels(labelNames, "segmentation result.labels");
  const segmentedLabels = labels.filter((label): label is MatNnunetSegmentedLabelManifest => label.status === "segmented");
  const labelValues = segmentedLabels.map((label) => label.labelValue);
  if (new Set(labelValues).size !== labelValues.length) throw new Error("Segmented label values must be unique");
  const artifactIds = segmentedLabels.flatMap((label) => [label.labelMap.id, label.mesh.id]);
  if (new Set(artifactIds).size !== artifactIds.length) throw new Error("Segmentation artifact identifiers must be unique");
  for (const label of labels) {
    if (label.status !== "segmented") continue;
    for (const artifact of [label.labelMap, label.mesh]) {
      if (!frameIds.has(artifact.coordinateFrameId)) throw new Error(`Artifact ${artifact.id} references an unknown coordinate frame`);
      const frame = coordinateFrames.find((candidate) => candidate.id === artifact.coordinateFrameId);
      const expectedKind = artifact.kind === "immutable_labelmap" ? "label_map" : "mesh";
      if (frame?.kind !== expectedKind) throw new Error(`Artifact ${artifact.id} references the wrong coordinate frame kind`);
    }
  }

  const normalizedCheckpoints = arrayValue(
    algorithm.checkpoints,
    "segmentation result.algorithm.checkpoints",
  ).map((entry, index) => {
    const checkpoint = record(entry, `segmentation result.algorithm.checkpoints[${index}]`);
    if (typeof checkpoint.fold !== "number" || !Number.isSafeInteger(checkpoint.fold) || checkpoint.fold < 0) {
      throw new Error(`segmentation result.algorithm.checkpoints[${index}].fold must be a non-negative integer`);
    }
    return {
      fold: checkpoint.fold,
      checkpointName: safeId(checkpoint.checkpointName, `segmentation result.algorithm.checkpoints[${index}].checkpointName`),
      sha256: sha256(checkpoint.sha256, `segmentation result.algorithm.checkpoints[${index}].sha256`),
      byteLength: positiveInteger(checkpoint.byteLength, `segmentation result.algorithm.checkpoints[${index}].byteLength`),
    };
  });
  const normalizedFolds = arrayValue(algorithm.modelFolds, "segmentation result.algorithm.modelFolds").map((fold, index) => {
    if (typeof fold !== "number" || !Number.isSafeInteger(fold) || fold < 0) {
      throw new Error(`segmentation result.algorithm.modelFolds[${index}] must be a non-negative integer`);
    }
    return fold;
  });
  if (
    normalizedFolds.length === 0
    || normalizedCheckpoints.length !== normalizedFolds.length
    || new Set(normalizedFolds).size !== normalizedFolds.length
    || new Set(normalizedCheckpoints.map((checkpoint) => checkpoint.fold)).size !== normalizedCheckpoints.length
    || normalizedFolds.some((fold) => !normalizedCheckpoints.some((checkpoint) => checkpoint.fold === fold))
  ) throw new Error("segmentation result.algorithm model folds must exactly match checkpoint evidence");
  const normalizedConfigurationArtifacts = arrayValue(
    algorithm.configurationArtifacts,
    "segmentation result.algorithm.configurationArtifacts",
  ).map((entry, index): MatNnunetSegmentationManifest["algorithm"]["configurationArtifacts"][number] => {
    const artifact = record(entry, `segmentation result.algorithm.configurationArtifacts[${index}]`);
    if (artifact.name !== "plans.json" && artifact.name !== "dataset.json") {
      throw new Error(`segmentation result.algorithm.configurationArtifacts[${index}].name is unsupported`);
    }
    return {
      name: artifact.name,
      sha256: sha256(artifact.sha256, `segmentation result.algorithm.configurationArtifacts[${index}].sha256`),
      byteLength: positiveInteger(artifact.byteLength, `segmentation result.algorithm.configurationArtifacts[${index}].byteLength`),
    };
  });
  if (
    normalizedConfigurationArtifacts.length !== 2
    || new Set(normalizedConfigurationArtifacts.map((artifact) => artifact.name)).size !== 2
  ) throw new Error("segmentation result.algorithm requires unique plans.json and dataset.json evidence");

  const parsedAlgorithm: MatNnunetSegmentationManifest["algorithm"] = {
    name: "nnUNetv2",
    modelId: safeId(algorithm.modelId, "segmentation result.algorithm.modelId"),
    modelVersion: algorithm.modelVersion === null
      ? null
      : safeId(algorithm.modelVersion, "segmentation result.algorithm.modelVersion"),
    modelSha256: sha256(algorithm.modelSha256, "segmentation result.algorithm.modelSha256"),
    pipelineName: stringValue(algorithm.pipelineName, "segmentation result.algorithm.pipelineName"),
    modelDataset: safeId(algorithm.modelDataset, "segmentation result.algorithm.modelDataset"),
    modelTrainer: safeId(algorithm.modelTrainer, "segmentation result.algorithm.modelTrainer"),
    modelPlans: safeId(algorithm.modelPlans, "segmentation result.algorithm.modelPlans"),
    modelConfiguration: safeId(algorithm.modelConfiguration, "segmentation result.algorithm.modelConfiguration"),
    modelFolds: normalizedFolds,
    checkpointName: safeId(algorithm.checkpointName, "segmentation result.algorithm.checkpointName"),
    checkpoints: normalizedCheckpoints,
    configurationArtifacts: normalizedConfigurationArtifacts,
    nnunetv2Version: algorithm.nnunetv2Version === null
      ? null
      : safeId(algorithm.nnunetv2Version, "segmentation result.algorithm.nnunetv2Version"),
    matPlannerRevision: safeId(algorithm.matPlannerRevision, "segmentation result.algorithm.matPlannerRevision"),
    registrySha256: sha256(algorithm.registrySha256, "segmentation result.algorithm.registrySha256"),
    algorithmSourceSha256: sha256(algorithm.algorithmSourceSha256, "segmentation result.algorithm.algorithmSourceSha256"),
  };
  const sourceKind = enumValue(source.kind, SOURCE_KINDS, "segmentation result.source.kind");

  return {
    schemaVersion: MAT_NNUNET_RESULT_SCHEMA,
    adapterId: MAT_NNUNET_ADAPTER_ID,
    runId: safeId(item.runId, "segmentation result.runId"),
    adapterVersion: safeId(item.adapterVersion, "segmentation result.adapterVersion"),
    validationState: "research_only",
    researchUseOnly: true,
    generatedAt,
    source: {
      kind: sourceKind,
      sha256: sha256(source.sha256, "segmentation result.source.sha256"),
      byteLength: positiveInteger(source.byteLength, "segmentation result.source.byteLength"),
      immutable: true,
    },
    lateralityHint: parseLateralityHint(item.lateralityHint, sourceKind),
    algorithm: parsedAlgorithm,
    coordinateFrames,
    geometry: {
      spacingMm: vector3(geometry.spacingMm, "segmentation result.geometry.spacingMm", false),
      sizeVoxels: vector3(geometry.sizeVoxels, "segmentation result.geometry.sizeVoxels", true),
      orientation: geometryOrientation,
      axesCode: geometryAxesCode,
    },
    labels,
    notEvaluatedCodes,
    warningCodes: parseWarningCodes(item.warningCodes, "segmentation result.warningCodes"),
    review: {
      laterality: "unverified",
      scaleVerified: false,
      orientationVerified: false,
      boneIdentitiesVerified: false,
      meshQualityVerified: false,
      sourceLabelMapsImmutable: true,
    },
  };
}

export function parseMatNnunetJob(value: unknown): MatNnunetJob {
  const item = record(value, "segmentation job");
  if (item.schemaVersion !== MAT_NNUNET_JOB_SCHEMA) throw new Error("Unsupported segmentation job schema version");
  const status = enumValue(item.status, JOB_STATUSES, "segmentation job.status");
  const updatedAt = stringValue(item.updatedAt, "segmentation job.updatedAt");
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("segmentation job.updatedAt must be an ISO date-time");
  const job: MatNnunetJob = {
    schemaVersion: MAT_NNUNET_JOB_SCHEMA,
    jobId: safeId(item.jobId, "segmentation job.jobId"),
    status,
    updatedAt,
  };
  if (item.progress !== undefined) {
    const progress = finiteNumber(item.progress, "segmentation job.progress");
    if (progress < 0 || progress > 1) throw new Error("segmentation job.progress must be between zero and one");
    job.progress = progress;
  }
  if (status === "completed") {
    if (item.result === undefined) throw new Error("Completed segmentation job requires a result manifest");
    job.result = parseMatNnunetSegmentationManifest(item.result);
    if (job.result.runId !== job.jobId) throw new Error("Segmentation result runId must match its jobId");
  }
  if (status === "failed") {
    const error = typeof item.error === "string"
      ? { code: item.error }
      : record(item.error, "segmentation job.error");
    const code = stringValue(error.code, "segmentation job.error.code");
    if (!SAFE_ERROR_CODE.test(code)) throw new Error("segmentation job.error.code is invalid");
    job.error = { code };
    if (error.message !== undefined) {
      const message = stringValue(error.message, "segmentation job.error.message");
      if (message.length > 512) throw new Error("segmentation job.error.message is too long");
      job.error.message = message;
    }
  }
  return job;
}
