import type {
  AnatomyObject,
  CoordinateFrame,
  ImagingLateralityHint,
  ImagingReviewRecord,
  ImmutableImagingSourceRecord,
} from "../domain/types";
import {
  MAT_NNUNET_ADAPTER_ID,
  parseMatNnunetSegmentationManifest,
  type MatNnunetArtifactManifest,
  type MatNnunetBoneLabel,
  type MatNnunetLabelStatus,
  type MatNnunetNotEvaluatedCode,
  type MatNnunetSegmentationManifest,
  type MatNnunetWarningCode,
} from "./matNnunetTypes";

export interface AppliedSegmentationArtifact {
  /** Stable plan-facing identifier; contains no server path. */
  assetId: string;
  serviceRunId: string;
  serviceArtifactId: string;
  bone: MatNnunetBoneLabel;
  kind: MatNnunetArtifactManifest["kind"];
  mediaType: MatNnunetArtifactManifest["mediaType"];
  sha256: string;
  byteLength: number;
  coordinateFrameId: string;
  immutable: true;
}

export interface SegmentationRunSummary {
  runId: string;
  adapterId: typeof MAT_NNUNET_ADAPTER_ID;
  adapterVersion: string;
  validationState: "research_only";
  researchUseOnly: true;
  generatedAt: string;
  source: {
    sourceId: string;
    kind: MatNnunetSegmentationManifest["source"]["kind"];
    sha256: string;
    byteLength: number;
    immutable: true;
  };
  algorithm: MatNnunetSegmentationManifest["algorithm"];
  labelStatus: Record<MatNnunetBoneLabel, MatNnunetLabelStatus>;
  warningCodes: MatNnunetWarningCode[];
  notEvaluatedCodes: MatNnunetNotEvaluatedCode[];
  lateralityHint: ImagingLateralityHint;
  clinicianReviewRequired: true;
}

export interface SegmentationPlanPatch {
  sourceToAdd: ImmutableImagingSourceRecord;
  coordinateFramesToAdd: CoordinateFrame[];
  anatomyToAdd: AnatomyObject[];
  review: ImagingReviewRecord;
  segmentationAdapterId: typeof MAT_NNUNET_ADAPTER_ID;
  segmentationValidationState: "research_only";
  segmentationRun: SegmentationRunSummary;
  artifacts: AppliedSegmentationArtifact[];
  unavailableRequiredBones: Array<{
    bone: MatNnunetBoneLabel;
    status: "missing" | "failed";
    issueCode: string;
  }>;
  warningCodes: MatNnunetWarningCode[];
  analysisEligible: false;
  notEvaluatedReasons: string[];
  /** Seeds orientation-dependent placement but never closes the review gate. */
  suggestedLaterality: "left" | "right" | null;
}

const REQUIRED_WARNINGS: readonly MatNnunetWarningCode[] = [
  "RESEARCH_ONLY",
  "CLINICIAN_REVIEW_REQUIRED",
  "LATERALITY_UNVERIFIED",
  "SCALE_UNVERIFIED",
  "ORIENTATION_UNVERIFIED",
  "BONE_IDENTITIES_UNVERIFIED",
  "MESH_QUALITY_UNVERIFIED",
];

function stablePrefix(manifest: MatNnunetSegmentationManifest): string {
  return manifest.source.sha256.slice(0, 16);
}

function frameName(kind: CoordinateFrame["kind"]): string {
  switch (kind) {
    case "dicom_patient": return "DICOM patient frame";
    case "voxel": return "Source voxel frame";
    case "label_map": return "Immutable label-map frame";
    case "mesh": return "Derived mesh frame";
    default: return "Segmentation frame";
  }
}

function artifactAssetId(prefix: string, artifact: MatNnunetArtifactManifest): string {
  return `segasset-${prefix}-${artifact.id}`;
}

function createReview(anatomyIds: readonly string[]): ImagingReviewRecord {
  return {
    laterality: "unverified",
    scaleVerified: false,
    orientationVerified: false,
    boneIdentitiesVerified: false,
    sourceLabelMapsImmutable: true,
    corrections: [],
    meshQuality: Object.fromEntries(anatomyIds.map((id) => [id, {
      manifold: null,
      components: null,
      normalsVerified: false,
      selfIntersections: null,
      reviewer: null,
      reviewedAt: null,
    }])),
  };
}

/**
 * Convert a validated local-service result into deterministic plan records.
 * This function is pure: it performs no fetches, writes, time reads, or ID
 * generation. Original filenames, filesystem paths, DICOM tags, and free-form
 * service messages are intentionally absent from the returned value.
 */
export function segmentationPlanPatch(value: unknown): SegmentationPlanPatch {
  const manifest = parseMatNnunetSegmentationManifest(value);
  const prefix = stablePrefix(manifest);
  const sourceId = `source-${prefix}`;
  const frameIdByServiceId = new Map<string, string>();
  const coordinateFramesToAdd: CoordinateFrame[] = manifest.coordinateFrames.map((frame) => {
    const id = `segframe-${prefix}-${frame.id}`;
    frameIdByServiceId.set(frame.id, id);
    return {
      id,
      kind: frame.kind,
      name: frameName(frame.kind),
      units: "mm",
      sourceConvention: frame.sourceConvention,
      transformToPatientRas: frame.transformToPatientRas,
      source: `${MAT_NNUNET_ADAPTER_ID}:${manifest.algorithm.modelId}:sha256-${manifest.algorithm.modelSha256.slice(0, 16)}`,
      scaleVerified: false,
    };
  });

  const voxelFrame = manifest.coordinateFrames.find((frame) => frame.kind === "voxel")
    ?? manifest.coordinateFrames.find((frame) => frame.kind === "label_map");
  const sourceToAdd: ImmutableImagingSourceRecord = {
    id: sourceId,
    fileName: manifest.source.kind === "dicom_tar_gz"
      ? "deidentified-source.tar.gz"
      : "deidentified-source.nii.gz",
    format: manifest.source.kind === "dicom_tar_gz" ? "dicom_archive" : "nifti",
    byteLength: manifest.source.byteLength,
    sha256: manifest.source.sha256,
    importedAt: manifest.generatedAt,
    immutable: true,
    spacingMm: voxelFrame?.spacingMm ?? manifest.geometry.spacingMm,
    orientation: `${manifest.geometry.orientation} (${manifest.geometry.axesCode})`,
    transformIds: coordinateFramesToAdd.map((frame) => frame.id),
    boneIdentity: "unknown",
  };

  const artifacts: AppliedSegmentationArtifact[] = [];
  const anatomyToAdd: AnatomyObject[] = [];
  for (const label of manifest.labels) {
    if (label.status !== "segmented") continue;
    const anatomyId = `anatomy-${prefix}-${label.label}`;
    const labelMapAssetId = artifactAssetId(prefix, label.labelMap);
    const meshAssetId = artifactAssetId(prefix, label.mesh);
    for (const artifact of [label.labelMap, label.mesh]) {
      artifacts.push({
        assetId: artifactAssetId(prefix, artifact),
        serviceRunId: manifest.runId,
        serviceArtifactId: artifact.id,
        bone: label.label,
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        coordinateFrameId: frameIdByServiceId.get(artifact.coordinateFrameId)!,
        immutable: true,
      });
    }
    anatomyToAdd.push({
      id: anatomyId,
      label: label.label === "femur" ? "Femur" : label.label === "tibia" ? "Tibia" : "Fibula",
      kind: label.label,
      sourceVolumeId: sourceId,
      labelMapId: labelMapAssetId,
      meshAssetId,
      coordinateFrameId: frameIdByServiceId.get(label.mesh.coordinateFrameId)!,
      segmentationProvenance: {
        sourceKind: manifest.source.kind === "dicom_tar_gz" ? "dicom_mri" : "nifti",
        sourceAssetIds: [sourceId],
        sourceLabelMapAssetId: labelMapAssetId,
        immutableSource: true,
        correctionAssetIds: [],
        method: "service_adapter",
        algorithmName: manifest.algorithm.name,
        ...(manifest.algorithm.modelVersion ? { algorithmVersion: manifest.algorithm.modelVersion } : {}),
        notes: "Research-only segmentation output; clinician review and correction remain required.",
      },
      quality: {
        manifold: label.meshQuality.manifold,
        watertight: label.meshQuality.watertight,
        triangleCount: label.meshQuality.triangleCount,
        minimumEdgeLengthMm: null,
        warnings: [
          "Computed mesh quality has not been clinician verified.",
          ...(label.meshQuality.watertight ? [] : [`Display mesh has ${label.meshQuality.boundaryEdgeCount} boundary edges and is not watertight.`]),
          ...(label.meshQuality.nonmanifoldEdgeCount ? [`Display mesh has ${label.meshQuality.nonmanifoldEdgeCount} nonmanifold edges.`] : []),
        ],
      },
      reviewStatus: "unreviewed",
      visible: true,
    });
  }

  const unavailableRequiredBones = manifest.labels.flatMap((label) => label.status === "segmented" ? [] : [{
    bone: label.label,
    status: label.status,
    issueCode: label.issueCode,
  }]);
  const warningCodes = [...new Set<MatNnunetWarningCode>([
    ...REQUIRED_WARNINGS,
    ...manifest.warningCodes,
    ...manifest.labels.flatMap((label) => label.warningCodes),
    ...unavailableRequiredBones.map((label): MatNnunetWarningCode => label.status === "missing" ? "LABEL_MISSING" : "LABEL_FAILED"),
    ...(unavailableRequiredBones.some((label) => label.bone === "fibula") ? ["FIBULA_NOT_PREDICTED" as const] : []),
  ])];
  const labelStatus = Object.fromEntries(manifest.labels.map((label) => [label.label, label.status])) as Record<
    MatNnunetBoneLabel,
    MatNnunetLabelStatus
  >;
  const review = createReview(anatomyToAdd.map((anatomy) => anatomy.id));
  for (const label of manifest.labels) {
    if (label.status !== "segmented") continue;
    const anatomyId = `anatomy-${prefix}-${label.label}`;
    review.meshQuality[anatomyId] = {
      manifold: label.meshQuality.manifold,
      components: null,
      normalsVerified: false,
      selfIntersections: label.meshQuality.selfIntersections,
      reviewer: null,
      reviewedAt: null,
    };
  }

  return {
    sourceToAdd,
    coordinateFramesToAdd,
    anatomyToAdd,
    review,
    segmentationAdapterId: MAT_NNUNET_ADAPTER_ID,
    segmentationValidationState: "research_only",
    segmentationRun: {
      runId: manifest.runId,
      adapterId: MAT_NNUNET_ADAPTER_ID,
      adapterVersion: manifest.adapterVersion,
      validationState: "research_only",
      researchUseOnly: true,
      generatedAt: manifest.generatedAt,
      source: {
        sourceId,
        kind: manifest.source.kind,
        sha256: manifest.source.sha256,
        byteLength: manifest.source.byteLength,
        immutable: true,
      },
      algorithm: manifest.algorithm,
      labelStatus,
      warningCodes,
      notEvaluatedCodes: manifest.notEvaluatedCodes,
      lateralityHint: structuredClone(manifest.lateralityHint),
      clinicianReviewRequired: true,
    },
    artifacts,
    unavailableRequiredBones,
    warningCodes,
    analysisEligible: false,
    notEvaluatedReasons: [
      "research_only_segmentation",
      "laterality_unverified",
      "scale_unverified",
      "orientation_unverified",
      "bone_identities_unverified",
      "mesh_quality_unverified",
      "patient_channel_registration",
      ...manifest.notEvaluatedCodes,
      ...unavailableRequiredBones.map((item) => `${item.bone}_${item.status}`),
    ],
    suggestedLaterality: manifest.lateralityHint.status === "resolved"
      ? manifest.lateralityHint.laterality
      : null,
  };
}
