import type {
  MatNnunetCapabilities,
  MatNnunetCoordinateFrameManifest,
  MatNnunetSegmentationManifest,
} from "./matNnunetTypes";

export const TEST_SOURCE_SHA256 = "a".repeat(64);
export const TEST_MODEL_SHA256 = "b".repeat(64);
export const TEST_JOB_ID = "job-aaaaaaaaaaaaaaaa-bbbbbbbbbbbb";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function frame(
  id: string,
  kind: MatNnunetCoordinateFrameManifest["kind"],
  sourceConvention: MatNnunetCoordinateFrameManifest["sourceConvention"],
): MatNnunetCoordinateFrameManifest {
  return {
    id,
    kind,
    units: "mm",
    sourceConvention,
    transformToPatientRas: identity,
    ...(kind === "voxel" || kind === "label_map" ? {
      spacingMm: [0.5, 0.5, 0.8] as const,
      dimensions: [320, 320, 160] as const,
    } : {}),
  };
}

export function validCapabilities(): MatNnunetCapabilities {
  return {
    schemaVersion: "mat-nnunet-capabilities.v1",
    adapterId: "mat-planner-knee-bone-masker-nnunetv2",
    apiVersion: "1.0.0",
    validationState: "research_only",
    researchUseOnly: true,
    accepts: ["dicom_tar_gz", "nifti"],
    produces: ["immutable_labelmap", "surface_mesh"],
    requiredLabels: ["femur", "tibia", "fibula"],
    models: [{
      id: "Dataset501_KneeBones",
      algorithm: "nnUNetv2",
      version: "2026.08",
      sha256: TEST_MODEL_SHA256,
      status: "available",
      labels: ["femur", "tibia"],
    }],
    maxUploadBytes: 2_147_483_648,
  };
}

export function validManifest(): MatNnunetSegmentationManifest {
  return {
    schemaVersion: "mat-nnunet-result.v1",
    adapterId: "mat-planner-knee-bone-masker-nnunetv2",
    runId: TEST_JOB_ID,
    adapterVersion: "1.0.0",
    validationState: "research_only",
    researchUseOnly: true,
    generatedAt: "2026-08-02T12:00:00.000Z",
    source: {
      kind: "dicom_tar_gz",
      sha256: TEST_SOURCE_SHA256,
      byteLength: 26_384_811,
      immutable: true,
    },
    lateralityHint: {
      laterality: "right",
      status: "resolved",
      confidence: "low",
      evidence: [{ source: "dicom_series_description", laterality: "right" }],
      requiresClinicianVerification: true,
    },
    algorithm: {
      name: "nnUNetv2",
      modelId: "Dataset501_KneeBones",
      modelVersion: "2026.08",
      modelSha256: TEST_MODEL_SHA256,
      pipelineName: "MAT Planner knee_bone_masker.BoneMaskPipeline",
      modelDataset: "Dataset501_KneeBones",
      modelTrainer: "nnUNetTrainer",
      modelPlans: "nnUNetPlans",
      modelConfiguration: "3d_fullres",
      modelFolds: [1],
      checkpointName: "checkpoint_best.pth",
      checkpoints: [{
        fold: 1,
        checkpointName: "checkpoint_best.pth",
        sha256: "6".repeat(64),
        byteLength: 12_345,
      }],
      configurationArtifacts: [
        { name: "plans.json", sha256: "7".repeat(64), byteLength: 2_345 },
        { name: "dataset.json", sha256: "8".repeat(64), byteLength: 1_234 },
      ],
      nnunetv2Version: "2.7.0",
      matPlannerRevision: "1321e0297a124c2af0ea5bc4949038cbc21cad4d",
      registrySha256: "9".repeat(64),
      algorithmSourceSha256: "0".repeat(64),
    },
    coordinateFrames: [
      frame("patient-ras", "dicom_patient", "RAS"),
      frame("source-voxel", "voxel", "IJK"),
      frame("femur-label-frame", "label_map", "IJK"),
      frame("femur-mesh-frame", "mesh", "RAS"),
      frame("tibia-label-frame", "label_map", "IJK"),
      frame("tibia-mesh-frame", "mesh", "RAS"),
    ],
    geometry: {
      spacingMm: [0.5, 0.5, 0.8],
      sizeVoxels: [320, 320, 160],
      orientation: "SAGITTAL",
      axesCode: "LPS",
    },
    labels: [
      {
        label: "femur",
        status: "segmented",
        labelValue: 1,
        labelMap: {
          id: "femur-labelmap",
          kind: "immutable_labelmap",
          mediaType: "application/x-nifti",
          sha256: "c".repeat(64),
          byteLength: 10_001,
          immutable: true,
          coordinateFrameId: "femur-label-frame",
        },
        mesh: {
          id: "femur-mesh",
          kind: "surface_mesh",
          mediaType: "model/stl",
          sha256: "d".repeat(64),
          byteLength: 20_001,
          immutable: true,
          coordinateFrameId: "femur-mesh-frame",
        },
        meshQuality: {
          manifold: true,
          watertight: true,
          vertexCount: 100,
          triangleCount: 196,
          boundaryEdgeCount: 0,
          nonmanifoldEdgeCount: 0,
          selfIntersections: null,
          deterministicDisplayDecimation: true,
          marchingCubesStepSize: 2,
          reviewStatus: "unreviewed",
        },
        warningCodes: ["MESH_QUALITY_UNVERIFIED"],
      },
      {
        label: "tibia",
        status: "segmented",
        labelValue: 2,
        labelMap: {
          id: "tibia-labelmap",
          kind: "immutable_labelmap",
          mediaType: "application/x-nifti",
          sha256: "e".repeat(64),
          byteLength: 11_001,
          immutable: true,
          coordinateFrameId: "tibia-label-frame",
        },
        mesh: {
          id: "tibia-mesh",
          kind: "surface_mesh",
          mediaType: "model/stl",
          sha256: "f".repeat(64),
          byteLength: 21_001,
          immutable: true,
          coordinateFrameId: "tibia-mesh-frame",
        },
        meshQuality: {
          manifold: true,
          watertight: false,
          vertexCount: 110,
          triangleCount: 210,
          boundaryEdgeCount: 12,
          nonmanifoldEdgeCount: 0,
          selfIntersections: null,
          deterministicDisplayDecimation: true,
          marchingCubesStepSize: 2,
          reviewStatus: "unreviewed",
        },
        warningCodes: ["MESH_QUALITY_UNVERIFIED"],
      },
      {
        label: "fibula",
        status: "missing",
        issueCode: "MODEL_DOES_NOT_PREDICT_LABEL",
        warningCodes: ["FIBULA_NOT_PREDICTED", "LABEL_MISSING"],
      },
    ],
    notEvaluatedCodes: ["fibula_segmentation", "posterior_danger_anatomy", "cortex_articular_clearance"],
    warningCodes: ["RESEARCH_ONLY", "CLINICIAN_REVIEW_REQUIRED", "FIBULA_NOT_PREDICTED"],
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

function assetId(character: string): string {
  return `asset-sha256-${character.repeat(64)}`;
}

function bridgeFrame(
  id: string,
  kind: string,
  coordinateUnits: "mm" | "index",
  sourceConvention: string,
  transformToPatientRas: readonly number[] = identity,
  transformFromPatientRas: readonly number[] = identity,
): Record<string, unknown> {
  return {
    id,
    kind,
    name: id,
    coordinateUnits,
    physicalUnits: "mm",
    sourceConvention,
    ...(kind === "voxel" || kind === "label_map" ? { spacingMm: [0.5, 0.5, 0.8] } : {}),
    transformToPatientRas,
    transformFromPatientRas,
    scaleVerified: false,
  };
}

/** Exact public shape emitted by scripts/mat_nnunet_bridge.py. */
export function bridgeCapabilitiesFixture(): Record<string, unknown> {
  return {
    schemaVersion: "mat-nnunet-capabilities.v1",
    adapterId: "mat-planner-knee-bone-masker-nnunetv2",
    adapterVersion: "1.0.0",
    apiVersion: "1.0.0",
    validationState: "research_only",
    researchUseOnly: true,
    accepts: ["dicom_tar_gz", "nifti", "dicom_folder_cli_only"],
    requiredLabels: ["femur", "tibia", "fibula"],
    producedLabels: ["femur", "tibia", "femur_cartilage", "tibia_cartilage"],
    models: [{
      id: "model-one",
      backend: "nnunetv2",
      dataset: "Dataset500_KneeMRI",
      trainer: "Trainer",
      plans: "Plans",
      configuration: "3d_fullres",
      folds: [0],
      checkpointName: "checkpoint_final.pth",
      available: true,
      checkpointSha256: null,
    }],
    maxUploadBytes: 8_589_934_592,
    maxExpandedArchiveBytes: 34_359_738_368,
    registrySha256: "1".repeat(64),
    matPlannerRevision: "2".repeat(40),
    runtime: { python: "3.12.0", nnunetv2: "2.6.2", SimpleITK: "2.5.2" },
    available: true,
    unavailableReasonCode: null,
    notices: ["Research-only MAT Planner segmentation adapter; not clinically validated."],
  };
}

/** Exact completed-result shape emitted by scripts/mat_nnunet_bridge.py. */
export function bridgeManifestFixture(): any {
  const femurLabel = assetId("c");
  const femurMesh = assetId("d");
  const tibiaLabel = assetId("e");
  const tibiaMesh = assetId("f");
  const artifacts = [
    [femurLabel, "immutable_femur_label_map", "application/vnd.nifti", "c"],
    [femurMesh, "femur_viewer_mesh", "application/json", "d"],
    [tibiaLabel, "immutable_tibia_label_map", "application/vnd.nifti", "e"],
    [tibiaMesh, "tibia_viewer_mesh", "application/json", "f"],
  ].map(([id, kind, mediaType, hash], index) => ({
    assetId: id,
    kind,
    sha256: String(hash).repeat(64),
    byteLength: 10_000 + index,
    mediaType,
    immutable: true,
    apiReadable: String(kind).endsWith("_viewer_mesh"),
    ...(String(kind).endsWith("_viewer_mesh") ? { url: `/api/segmentation/assets/${id}` } : {}),
  }));
  return {
    schemaVersion: "mat-nnunet-result.v1",
    runId: TEST_JOB_ID,
    adapterId: "mat-planner-knee-bone-masker-nnunetv2",
    adapterVersion: "1.0.0",
    validationState: "research_only",
    researchUseOnly: true,
    generatedAt: "2026-08-02T12:00:00.000Z",
    source: {
      id: `source-sha256-${TEST_SOURCE_SHA256}`,
      kind: "dicom_tar_gz",
      sha256: TEST_SOURCE_SHA256,
      byteLength: 26_384_811,
      fileCount: 1,
      immutable: true,
      assetId: assetId("a"),
    },
    lateralityHint: {
      laterality: "right",
      status: "resolved",
      confidence: "low",
      evidence: [{ source: "dicom_series_description", laterality: "right" }],
      requiresClinicianVerification: true,
    },
    algorithm: {
      name: "MAT Planner knee_bone_masker.BoneMaskPipeline",
      algorithmSourceSha256: "3".repeat(64),
      matPlannerRevision: "4".repeat(40),
      registrySha256: "5".repeat(64),
      nnunetv2Version: "2.6.2",
      model: {
        id: "model-one",
        backend: "nnunetv2",
        dataset: "Dataset500_KneeMRI",
        trainer: "Trainer",
        plans: "Plans",
        configuration: "3d_fullres",
        folds: [0],
        checkpointName: "checkpoint_final.pth",
        checkpoints: [{
          fold: 0,
          checkpointName: "checkpoint_final.pth",
          sha256: "6".repeat(64),
          byteLength: 12_345,
        }],
        configurationArtifacts: [
          { name: "plans.json", sha256: "7".repeat(64), byteLength: 2_345 },
          { name: "dataset.json", sha256: "8".repeat(64), byteLength: 1_234 },
        ],
        modelArtifactSha256: TEST_MODEL_SHA256,
      },
    },
    coordinateFrames: [
      bridgeFrame("patient-ras", "dicom_patient", "mm", "RAS"),
      bridgeFrame("dicom-patient-lps", "dicom_patient", "mm", "LPS", [
        -1, 0, 0, 0,
        0, -1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ], [
        -1, 0, 0, 0,
        0, -1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      bridgeFrame("source-voxel-ijk", "voxel", "index", "IJK"),
      bridgeFrame("label-voxel-ijk", "label_map", "index", "IJK"),
      bridgeFrame("mesh-patient-ras", "mesh", "mm", "RAS"),
      bridgeFrame("viewer-world", "viewer_world", "mm", "VIEWER_WORLD"),
    ],
    geometry: {
      sizeVoxels: [320, 320, 160],
      spacingMm: [0.5, 0.5, 0.8],
      orientation: "SAGITTAL",
      axesCode: "LPS",
      roundTripMaximumError: 0,
      sourceImage: {
        sizeVoxels: [320, 320, 160],
        spacingMm: [0.5, 0.5, 0.8],
        originLpsMm: [0, 0, 0],
        directionLps: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        frameId: "source-voxel-ijk",
      },
      finalLabelMap: {
        sizeVoxels: [320, 320, 160],
        spacingMm: [0.5, 0.5, 0.8],
        originLpsMm: [0, 0, 0],
        directionLps: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        frameId: "label-voxel-ijk",
      },
      sourceToLabelRegistration: {
        verified: true,
        sourceFrameId: "source-voxel-ijk",
        labelFrameId: "label-voxel-ijk",
        sourceVoxelToLabelVoxel: identity,
        labelVoxelToSourceVoxel: identity,
        maximumPhysicalMatrixDelta: 0,
        maximumIdentityDelta: 0,
        maximumInverseMatrixDelta: 0,
        verificationTolerance: 1e-7,
      },
    },
    labelInventory: [
      { namespace: "mat_standardized", labelValue: 1, name: "femur", voxelCount: 100, volumeMm3: 20 },
      { namespace: "mat_standardized", labelValue: 2, name: "tibia", voxelCount: 110, volumeMm3: 22 },
    ],
    bones: [
      {
        bone: "femur",
        status: "present",
        reviewStatus: "unreviewed",
        voxelCount: 100,
        labelMapAssetId: femurLabel,
        viewerMeshAssetId: femurMesh,
        coordinateFrameId: "mesh-patient-ras",
        meshQuality: {
          manifold: true,
          watertight: true,
          vertexCount: 100,
          triangleCount: 196,
          boundaryEdgeCount: 0,
          nonmanifoldEdgeCount: 0,
          selfIntersections: null,
          deterministicDisplayDecimation: false,
          marchingCubesStepSize: 1,
          reviewStatus: "unreviewed",
        },
      },
      {
        bone: "tibia",
        status: "present",
        reviewStatus: "unreviewed",
        voxelCount: 110,
        labelMapAssetId: tibiaLabel,
        viewerMeshAssetId: tibiaMesh,
        coordinateFrameId: "mesh-patient-ras",
        meshQuality: {
          manifold: true,
          watertight: false,
          vertexCount: 110,
          triangleCount: 210,
          boundaryEdgeCount: 12,
          nonmanifoldEdgeCount: 0,
          selfIntersections: null,
          deterministicDisplayDecimation: true,
          marchingCubesStepSize: 2,
          reviewStatus: "unreviewed",
        },
      },
      {
        bone: "fibula",
        status: "missing",
        reviewStatus: "not_available",
        voxelCount: 0,
        labelMapAssetId: null,
        viewerMeshAssetId: null,
        reasonCode: "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
      },
    ],
    requiredLabelStatus: { femur: "present", tibia: "present", fibula: "missing" },
    artifacts,
    qc: {
      matBasicQc: { passed: true },
      sourceSeries: { orientation: "SAGITTAL", numFiles: 160 },
      segmentationReviewStatus: "unreviewed",
      meshQualityReviewed: false,
    },
    warningCodes: [
      "RESEARCH_ONLY",
      "CLINICIAN_REVIEW_REQUIRED",
      "LATERALITY_NOT_VERIFIED",
      "SCALE_NOT_VERIFIED",
      "ORIENTATION_NOT_VERIFIED",
      "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
      "DANGER_ANATOMY_NOT_EVALUATED",
    ],
    reviewGates: {
      lateralityVerified: false,
      scaleVerified: false,
      orientationVerified: false,
      boneIdentitiesVerified: false,
      sourceLabelMapsImmutable: true,
    },
    notEvaluated: [
      "fibula segmentation",
      "posterior neurovascular and other danger anatomy",
      "cortex/articular clearance against imported meshes",
    ],
    notice: "Research-only segmentation output requiring clinician review; not an operative recommendation.",
  };
}

export function bridgeJobFixture(status: "queued" | "running" | "completed" | "failed", result?: unknown): Record<string, unknown> {
  return {
    schemaVersion: "mat-nnunet-job.v1",
    jobId: TEST_JOB_ID,
    status,
    progress: status === "queued" ? 0 : status === "running" ? 0.5 : 1,
    updatedAt: "2026-08-02T12:00:00.000Z",
    result: status === "completed" ? result ?? bridgeManifestFixture() : null,
    error: status === "failed" ? "INFERENCE_FAILED" : null,
  };
}
