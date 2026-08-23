import { describe, expect, it } from "vitest";
import {
  SEGMENTATION_BOUNDARY,
  canUseForClinicalAnalysis,
  classifyImagingFile,
  createEmptyImagingReview,
  inferBoneIdentity,
  type ImmutableImagingSource,
} from "./imagingAdapter";

describe("safe imaging adapter boundary", () => {
  it("classifies supported formats while keeping MAT inference research-only", () => {
    expect(classifyImagingFile("case.nii.gz")).toBe("nifti");
    expect(classifyImagingFile("dicom-series.tar.gz")).toBe("dicom_archive");
    expect(classifyImagingFile("dicom-series.tgz")).toBe("dicom_archive");
    expect(classifyImagingFile("tibia.stl")).toBe("stl");
    expect(classifyImagingFile("scan.dcm")).toBe("dicom");
    expect(SEGMENTATION_BOUNDARY.validationState).toBe("research_only");
    expect(SEGMENTATION_BOUNDARY.requiredLabels).toContain("fibula");
  });

  it("infers only explicit bone names", () => {
    expect(inferBoneIdentity("RIGHT_FIBULA_mesh.ply")).toBe("fibula");
    expect(inferBoneIdentity("bone-1.stl")).toBe("unknown");
  });

  it("requires separate bones and all verification gates", () => {
    const source = (boneIdentity: ImmutableImagingSource["boneIdentity"]): ImmutableImagingSource => ({
      id: boneIdentity,
      fileName: `${boneIdentity}.stl`,
      format: "stl",
      byteLength: 1,
      sha256: boneIdentity,
      importedAt: "2026-08-02T00:00:00Z",
      immutable: true,
      spacingMm: null,
      orientation: null,
      transformIds: [],
      boneIdentity,
    });
    const review = createEmptyImagingReview();
    expect(canUseForClinicalAnalysis([source("femur"), source("tibia")], review).ready).toBe(false);
    Object.assign(review, {
      laterality: "left",
      scaleVerified: true,
      orientationVerified: true,
      boneIdentitiesVerified: true,
    });
    expect(
      canUseForClinicalAnalysis(
        [source("femur"), source("tibia"), source("fibula")],
        review,
      ).ready,
    ).toBe(true);
  });
});
