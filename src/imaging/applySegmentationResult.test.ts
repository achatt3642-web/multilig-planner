import { describe, expect, it } from "vitest";
import { segmentationPlanPatch } from "./applySegmentationResult";
import { TEST_JOB_ID, TEST_MODEL_SHA256, TEST_SOURCE_SHA256, bridgeManifestFixture } from "./matNnunetTestFixtures";

describe("segmentation plan patch", () => {
  it("creates deterministic de-identified plan records without elevating review state", () => {
    const raw = structuredClone(bridgeManifestFixture()) as any;
    raw.source.sourcePath = "/private/clinical/patient-name/scan";
    raw.patientName = "SHOULD_NOT_PERSIST";

    const patch = segmentationPlanPatch(raw);
    expect(patch).toEqual(segmentationPlanPatch(raw));
    expect(patch.sourceToAdd).toMatchObject({
      fileName: "deidentified-source.tar.gz",
      format: "dicom_archive",
      sha256: TEST_SOURCE_SHA256,
      immutable: true,
      spacingMm: [0.5, 0.5, 0.8],
      orientation: "SAGITTAL (LPS)",
      boneIdentity: "unknown",
    });
    expect(patch.coordinateFramesToAdd.every((frame) => frame.units === "mm" && !frame.scaleVerified)).toBe(true);
    expect(patch.review).toMatchObject({
      laterality: "unverified",
      scaleVerified: false,
      orientationVerified: false,
      boneIdentitiesVerified: false,
      sourceLabelMapsImmutable: true,
    });
    expect(patch.suggestedLaterality).toBe("right");
    expect(patch.segmentationRun.lateralityHint).toMatchObject({
      laterality: "right",
      status: "resolved",
      confidence: "low",
      requiresClinicianVerification: true,
    });
    expect(patch.analysisEligible).toBe(false);
    expect(JSON.stringify(patch)).not.toContain("patient-name");
    expect(JSON.stringify(patch)).not.toContain("SHOULD_NOT_PERSIST");
  });

  it("does not seed a side when DICOM metadata conflicts", () => {
    const raw = structuredClone(bridgeManifestFixture()) as any;
    raw.lateralityHint = {
      laterality: null,
      status: "conflict",
      confidence: "none",
      evidence: [
        { source: "dicom_image_laterality", laterality: "left" },
        { source: "dicom_series_description", laterality: "right" },
      ],
      requiresClinicianVerification: true,
    };
    const patch = segmentationPlanPatch(raw);
    expect(patch.suggestedLaterality).toBeNull();
    expect(patch.review.laterality).toBe("unverified");
  });

  it("creates anatomy only for successful labels and keeps missing fibula explicit", () => {
    const patch = segmentationPlanPatch(bridgeManifestFixture());
    expect(patch.anatomyToAdd.map((anatomy) => anatomy.kind)).toEqual(["femur", "tibia"]);
    expect(patch.anatomyToAdd.every((anatomy) => anatomy.reviewStatus === "unreviewed")).toBe(true);
    expect(patch.anatomyToAdd.find((anatomy) => anatomy.kind === "tibia")?.quality).toMatchObject({
      manifold: true,
      watertight: false,
      triangleCount: 210,
    });
    expect(patch.review.meshQuality[`anatomy-${TEST_SOURCE_SHA256.slice(0, 16)}-tibia`]).toMatchObject({
      manifold: true,
      normalsVerified: false,
      reviewer: null,
    });
    expect(patch.unavailableRequiredBones).toEqual([{
      bone: "fibula",
      status: "missing",
      issueCode: "FIBULA_NOT_PRODUCED_BY_MAT_MODEL",
    }]);
    expect(patch.warningCodes).toContain("FIBULA_NOT_PREDICTED");
    expect(patch.notEvaluatedReasons).toContain("fibula_missing");
    expect(patch.notEvaluatedReasons).toEqual(expect.arrayContaining([
      "posterior_danger_anatomy",
      "cortex_articular_clearance",
    ]));
  });

  it("persists reproducible model/source hashes and opaque artifact references", () => {
    const patch = segmentationPlanPatch(bridgeManifestFixture());
    expect(patch.segmentationRun).toMatchObject({
      runId: TEST_JOB_ID,
      validationState: "research_only",
      researchUseOnly: true,
      clinicianReviewRequired: true,
      source: { sha256: TEST_SOURCE_SHA256 },
      algorithm: {
        modelSha256: TEST_MODEL_SHA256,
        modelDataset: "Dataset500_KneeMRI",
        modelFolds: [0],
        checkpointName: "checkpoint_final.pth",
        checkpoints: [expect.objectContaining({ fold: 0, sha256: "6".repeat(64) })],
        configurationArtifacts: expect.arrayContaining([
          expect.objectContaining({ name: "plans.json", sha256: "7".repeat(64) }),
          expect.objectContaining({ name: "dataset.json", sha256: "8".repeat(64) }),
        ]),
      },
      labelStatus: { femur: "segmented", tibia: "segmented", fibula: "missing" },
    });
    expect(patch.artifacts).toHaveLength(4);
    expect(patch.artifacts.every((artifact) => artifact.serviceRunId === TEST_JOB_ID)).toBe(true);
    expect(patch.artifacts.map((artifact) => artifact.serviceArtifactId)).toContain(`asset-sha256-${"d".repeat(64)}`);
    expect(JSON.stringify(patch.artifacts)).not.toMatch(/(?:file|source)?path|https?:\/\//i);
  });
});
