import type {
  ImagingBoneIdentity as BoneIdentity,
  ImagingFormat,
  ImagingReviewRecord as ImagingReviewState,
  ImmutableImagingSourceRecord as ImmutableImagingSource,
} from "../domain/types";

export type { ImagingFormat, BoneIdentity, ImagingReviewState, ImmutableImagingSource };

export interface SegmentationServiceBoundary {
  id: "mat-planner-knee-bone-masker-nnunetv2";
  validationState: "not_connected" | "research_only" | "institution_validated";
  accepts: Array<"dicom_mri" | "dicom_archive" | "nifti_mri">;
  produces: Array<"immutable_labelmap" | "surface_mesh">;
  requiredLabels: Array<"femur" | "tibia" | "fibula">;
  notice: string;
}

export const SEGMENTATION_BOUNDARY: Readonly<SegmentationServiceBoundary> = Object.freeze<SegmentationServiceBoundary>({
  id: "mat-planner-knee-bone-masker-nnunetv2",
  validationState: "research_only",
  accepts: ["dicom_mri", "dicom_archive", "nifti_mri"],
  produces: ["immutable_labelmap", "surface_mesh"],
  requiredLabels: ["femur", "tibia", "fibula"],
  notice:
    "MAT Planner's local nnUNetv2 pipeline is available through a loopback adapter. It is research-only, requires clinician review, and its current model does not segment fibula.",
});

const EXTENSIONS: Record<string, ImagingFormat> = {
  dcm: "dicom",
  dicom: "dicom",
  nii: "nifti",
  "nii.gz": "nifti",
  nrrd: "labelmap",
  mha: "labelmap",
  mhd: "labelmap",
  seg: "labelmap",
  stl: "stl",
  obj: "obj",
  ply: "ply",
};

export function classifyImagingFile(fileName: string): ImagingFormat {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "dicom_archive";
  const suffix = lower.endsWith(".nii.gz") ? "nii.gz" : lower.split(".").pop() ?? "";
  return EXTENSIONS[suffix] ?? "unknown";
}

export function inferBoneIdentity(fileName: string): BoneIdentity {
  const lower = fileName.toLowerCase();
  for (const bone of ["femur", "tibia", "fibula", "patella"] as const) {
    if (lower.includes(bone)) return bone;
  }
  return "unknown";
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createImmutableSource(file: File): Promise<ImmutableImagingSource> {
  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);
  return Object.freeze({
    id: `source-${hash.slice(0, 16)}`,
    fileName: file.name,
    format: classifyImagingFile(file.name),
    byteLength: file.size,
    sha256: hash,
    importedAt: new Date().toISOString(),
    immutable: true as const,
    spacingMm: null,
    orientation: null,
    transformIds: [],
    boneIdentity: inferBoneIdentity(file.name),
  });
}

export function createEmptyImagingReview(): ImagingReviewState {
  return {
    laterality: "unverified",
    scaleVerified: false,
    orientationVerified: false,
    boneIdentitiesVerified: false,
    sourceLabelMapsImmutable: true,
    corrections: [],
    meshQuality: {},
  };
}

export function canUseForClinicalAnalysis(
  sources: readonly ImmutableImagingSource[],
  review: ImagingReviewState,
): { ready: boolean; reasons: string[] } {
  const identities = new Set(sources.map((source) => source.boneIdentity));
  const reasons: string[] = [];
  if (!identities.has("femur") || !identities.has("tibia") || !identities.has("fibula")) {
    reasons.push("Separate femur, tibia, and fibula objects are required.");
  }
  if (review.laterality === "unverified") reasons.push("Laterality is not verified.");
  if (!review.scaleVerified) reasons.push("Image or mesh scale is not verified.");
  if (!review.orientationVerified) reasons.push("Patient orientation is not verified.");
  if (!review.boneIdentitiesVerified) reasons.push("Bone identities are not verified.");
  return { ready: reasons.length === 0, reasons };
}
