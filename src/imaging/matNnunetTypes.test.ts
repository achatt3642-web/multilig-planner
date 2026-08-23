import { describe, expect, it } from "vitest";
import {
  parseMatNnunetCapabilities,
  parseMatNnunetJob,
  parseMatNnunetMatrix4,
  parseMatNnunetSegmentationManifest,
} from "./matNnunetTypes";
import { TEST_JOB_ID, bridgeCapabilitiesFixture, bridgeJobFixture, bridgeManifestFixture } from "./matNnunetTestFixtures";

describe("MAT nnUNet v2 runtime contracts", () => {
  it("accepts research-only capabilities with an explicit required-label contract", () => {
    const parsed = parseMatNnunetCapabilities(bridgeCapabilitiesFixture());
    expect(parsed.validationState).toBe("research_only");
    expect(parsed.requiredLabels).toEqual(["femur", "tibia", "fibula"]);
    expect(parsed.accepts).toEqual(["dicom_tar_gz", "nifti"]);
    expect(parsed.models[0]).toMatchObject({ algorithm: "nnUNetv2", status: "available", sha256: null });
  });

  it("requires finite, nonsingular homogeneous 4x4 transforms in millimetres", () => {
    expect(parseMatNnunetMatrix4([
      1, 0, 0, 4,
      0, 1, 0, 5,
      0, 0, 1, 6,
      0, 0, 0, 1,
    ])).toHaveLength(16);

    const singular = structuredClone(bridgeManifestFixture()) as any;
    singular.coordinateFrames[0].transformToPatientRas = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    expect(() => parseMatNnunetSegmentationManifest(singular)).toThrow(/non-singular/i);

    const nonFinite = structuredClone(bridgeManifestFixture()) as any;
    nonFinite.coordinateFrames[0].transformToPatientRas[0] = Number.NaN;
    expect(() => parseMatNnunetSegmentationManifest(nonFinite)).toThrow(/finite/i);

    const wrongUnits = structuredClone(bridgeManifestFixture()) as any;
    wrongUnits.coordinateFrames[0].physicalUnits = "cm";
    expect(() => parseMatNnunetSegmentationManifest(wrongUnits)).toThrow(/must be mm/i);
  });

  it("requires valid hashes, unique labels, and an explicit fibula result", () => {
    const invalidHash = structuredClone(bridgeManifestFixture()) as any;
    invalidHash.source.sha256 = "not-a-hash";
    expect(() => parseMatNnunetSegmentationManifest(invalidHash)).toThrow(/SHA-256/i);

    const omittedFibula = structuredClone(bridgeManifestFixture()) as any;
    omittedFibula.bones = omittedFibula.bones.filter((bone: { bone: string }) => bone.bone !== "fibula");
    expect(() => parseMatNnunetSegmentationManifest(omittedFibula)).toThrow(/explicitly include femur, tibia, and fibula/i);

    const duplicate = structuredClone(bridgeManifestFixture()) as any;
    duplicate.bones[2].bone = "tibia";
    expect(() => parseMatNnunetSegmentationManifest(duplicate)).toThrow(/unique/i);
  });

  it("binds public artifact identities to hashes and preserves the exact MAT model chain", () => {
    const manifest = bridgeManifestFixture();
    const parsed = parseMatNnunetSegmentationManifest(manifest);
    expect(parsed.algorithm).toMatchObject({
      pipelineName: "MAT Planner knee_bone_masker.BoneMaskPipeline",
      modelDataset: "Dataset500_KneeMRI",
      modelTrainer: "Trainer",
      modelPlans: "Plans",
      modelConfiguration: "3d_fullres",
      modelFolds: [0],
      checkpointName: "checkpoint_final.pth",
      nnunetv2Version: "2.6.2",
    });
    expect(parsed.algorithm.checkpoints).toEqual([
      expect.objectContaining({ fold: 0, sha256: "6".repeat(64), byteLength: 12_345 }),
    ]);
    expect(parsed.algorithm.configurationArtifacts.map((artifact) => artifact.name).sort()).toEqual(["dataset.json", "plans.json"]);
    expect(parsed.lateralityHint).toEqual({
      laterality: "right",
      status: "resolved",
      confidence: "low",
      evidence: [{ source: "dicom_series_description", laterality: "right" }],
      requiresClinicianVerification: true,
    });

    const mismatchedAssetId = structuredClone(manifest) as any;
    mismatchedAssetId.artifacts[1].assetId = `asset-sha256-${"0".repeat(64)}`;
    expect(() => parseMatNnunetSegmentationManifest(mismatchedAssetId)).toThrow(/must match its SHA-256/i);

    const exposedLabelMap = structuredClone(manifest) as any;
    exposedLabelMap.artifacts[0].apiReadable = true;
    exposedLabelMap.artifacts[0].url = `/api/segmentation/assets/${exposedLabelMap.artifacts[0].assetId}`;
    expect(() => parseMatNnunetSegmentationManifest(exposedLabelMap)).toThrow(/unsupported public asset role/i);

    const missingModelEvidence = structuredClone(manifest) as any;
    missingModelEvidence.algorithm.model.configurationArtifacts.pop();
    expect(() => parseMatNnunetSegmentationManifest(missingModelEvidence)).toThrow(/plans.json and dataset.json/i);
  });

  it("does not allow a result to claim validation or clinician verification", () => {
    const clinicalClaim = structuredClone(bridgeManifestFixture()) as any;
    clinicalClaim.validationState = "institution_validated";
    expect(() => parseMatNnunetSegmentationManifest(clinicalClaim)).toThrow(/research_only/i);

    const preverified = structuredClone(bridgeManifestFixture()) as any;
    preverified.reviewGates.scaleVerified = true;
    expect(() => parseMatNnunetSegmentationManifest(preverified)).toThrow(/unverified/i);

    const trustedHint = structuredClone(bridgeManifestFixture()) as any;
    trustedHint.lateralityHint.requiresClinicianVerification = false;
    expect(() => parseMatNnunetSegmentationManifest(trustedHint)).toThrow(/clinician verification/i);
  });

  it("rejects contradictory or overconfident DICOM laterality hints", () => {
    const contradiction = structuredClone(bridgeManifestFixture()) as any;
    contradiction.lateralityHint.evidence.push({ source: "dicom_laterality", laterality: "left" });
    expect(() => parseMatNnunetSegmentationManifest(contradiction)).toThrow(/unanimous evidence/i);

    const overconfident = structuredClone(bridgeManifestFixture()) as any;
    overconfident.lateralityHint.confidence = "high";
    expect(() => parseMatNnunetSegmentationManifest(overconfident)).toThrow(/confidence/i);

    const explicitConflict = structuredClone(bridgeManifestFixture()) as any;
    explicitConflict.lateralityHint = {
      laterality: null,
      status: "conflict",
      confidence: "none",
      evidence: [
        { source: "dicom_image_laterality", laterality: "left" },
        { source: "dicom_series_description", laterality: "right" },
      ],
      requiresClinicianVerification: true,
    };
    expect(parseMatNnunetSegmentationManifest(explicitConflict).lateralityHint.status).toBe("conflict");
  });

  it("normalizes queued, running, completed, and failed job responses", () => {
    expect(parseMatNnunetJob({ ...bridgeJobFixture("queued"), serverDetail: "ignored" })).toMatchObject({
      schemaVersion: "mat-nnunet-job.v1",
      jobId: TEST_JOB_ID,
      status: "queued",
    });
    expect(parseMatNnunetJob(bridgeJobFixture("running")).progress).toBe(0.5);
    expect(parseMatNnunetJob(bridgeJobFixture("completed")).result?.labels).toHaveLength(3);
    expect(parseMatNnunetJob(bridgeJobFixture("failed")).error?.code).toBe("INFERENCE_FAILED");
    expect(() => parseMatNnunetJob({ ...bridgeJobFixture("queued"), status: "safe" })).toThrow(/unsupported/i);
  });
});
