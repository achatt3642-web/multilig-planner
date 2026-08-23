import { describe, expect, it } from "vitest";
import type { PlanCase } from "../domain/types";
import { createSyntheticDemoCase } from "../app/caseFactory";
import { analyzeClearance } from "../geometry/collision";
import { generateGeometry } from "../geometry/recipes";
import { vec3 } from "../geometry/mesh";
import { deserializePlan, serializePlan } from "../store/planHistory";
import { segmentationPlanPatch } from "../imaging/applySegmentationResult";
import { bridgeManifestFixture } from "../imaging/matNnunetTestFixtures";
import { channelsToCsv, createHumanReadableReport, createPlanExport, meshesToObj, withComputedAnalysis } from "./exporters";

const plan: PlanCase = (() => {
  const value = createSyntheticDemoCase();
  const firstChannel = value.variants[0].channels[0];
  firstChannel.instrumentChain = {
    ...firstChannel.instrumentChain,
    manufacturerId: "mfr-arthrex",
    productFamilyId: "fam-arthrex-flipcutter-iii",
    productVariantId: "var-arthrex-flipcutter-iii",
    cutterInstrumentId: "inst-arthrex-flipcutter",
    exactSizeOrProfileId: "var-arthrex-flipcutter-iii:size:9",
  };
  value.variants[0].analysis = [{
    id: "a-1",
    planVariantId: "variant-a",
    objectAId: firstChannel.id,
    objectBId: "danger-posterior",
    state: "not_evaluated",
    signedClearanceMm: null,
    explanation: "Danger anatomy not imported",
    geometryHashes: ["known", "missing"],
    evaluatedAt: "2026-08-02T00:00:00Z",
  }];
  return value;
})();

describe("de-identified reproducible exports", () => {
  it("includes exact selections, frozen versions and not-evaluated disclosures", () => {
    const exported = createPlanExport(plan);
    expect(JSON.stringify(exported)).toContain("AR-1204FF");
    expect(exported.disclosures.notEvaluatedAnalysisIds).toEqual(["a-1"]);
    expect(exported.disclosures.missingSafetyAnatomy).toContain(
      "posterior neurovascular and user danger regions",
    );
    expect(exported.catalogReferences.version).toBe(plan.catalogVersion);
    expect(exported.catalogReferences.resolvedAgainstInstalledCatalog).toBe(true);
    expect(exported.catalogReferences.geometryRecipes.length).toBeGreaterThan(0);
    const exportedPlan = exported.plan as PlanCase;
    expect(exportedPlan.variants.flatMap((variant) => variant.channels).every((channel) => channel.tipOvershootMm === null)).toBe(true);
  });

  it("creates per-channel CSV and a planning-only report", () => {
    const csv = channelsToCsv(plan);
    expect(csv).toContain("acl-femoral,ACL femoral retro socket");
    expect(csv).toContain("guide_pin_diameter_mm,guide_pin_provenance,trajectory_control_mode");
    expect(csv).toContain("3.5,generic_parametric_visual_seed,outer_cortex_surface");
    const report = createHumanReadableReport(plan);
    expect(report).toContain("not for autonomous navigation");
    expect(report).toContain("not evaluated");
    expect(report).toContain("Guide pin: 3.5 mm; provenance generic_parametric_visual_seed");
  });

  it("exports complete mesh faces with cumulative OBJ indices", () => {
    const obj = meshesToObj([
      { id: "a", name: "first", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], color: "#fff", opacity: 1, layer: "boneRemoval" },
      { id: "b", name: "second", vertices: [[0, 0, 1], [1, 0, 1], [0, 1, 1]], faces: [[0, 1, 2]], color: "#fff", opacity: 1, layer: "boneRemoval" },
    ]);
    expect(obj).toContain("f 1 2 3");
    expect(obj).toContain("f 4 5 6");
  });

  it("persists computed signed-clearance results through save/reload", () => {
    const geometryA = generateGeometry({ id: "a", type: "fullTunnel", tunnel: { start: vec3(0, 0, 0), end: vec3(20, 0, 0) }, diameterMm: 4 });
    const geometryB = generateGeometry({ id: "b", type: "fullTunnel", tunnel: { start: vec3(0, 3, 0), end: vec3(20, 3, 0) }, diameterMm: 4 });
    const result = analyzeClearance(geometryA, geometryB, { thresholdMm: 2 });
    const withAnalysis = withComputedAnalysis(plan, [result], "2026-08-02T00:00:00Z");
    const reloaded = deserializePlan<PlanCase>(serializePlan(withAnalysis));
    expect(reloaded.variants[0].analysis).toEqual(withAnalysis.variants[0].analysis);
    expect(reloaded.variants[0].analysis[0].signedClearanceMm).toBeCloseTo(-1, 8);
    const recomputed = withComputedAnalysis(reloaded, [result], "2026-08-03T00:00:00Z");
    expect(recomputed.variants[0].analysis[0].evaluatedAt).toBe("2026-08-02T00:00:00Z");
  });

  it("preserves and reports the exact MAT/nnUNet model provenance chain", () => {
    const withSegmentation = structuredClone(plan);
    const patch = segmentationPlanPatch(bridgeManifestFixture());
    withSegmentation.imaging.segmentationRuns = [{
      id: patch.segmentationRun.runId,
      adapterId: patch.segmentationRun.adapterId,
      adapterVersion: patch.segmentationRun.adapterVersion,
      validationState: patch.segmentationRun.validationState,
      researchUseOnly: patch.segmentationRun.researchUseOnly,
      sourceId: patch.segmentationRun.source.sourceId,
      algorithm: patch.segmentationRun.algorithm,
      labelStatus: patch.segmentationRun.labelStatus,
      artifactIds: patch.artifacts.map((artifact) => artifact.assetId),
      warningCodes: patch.segmentationRun.warningCodes,
      notEvaluatedCodes: patch.segmentationRun.notEvaluatedCodes,
      generatedAt: patch.segmentationRun.generatedAt,
    }];

    const reloaded = deserializePlan<PlanCase>(serializePlan(withSegmentation));
    expect(reloaded.imaging.segmentationRuns[0].algorithm).toEqual(patch.segmentationRun.algorithm);
    const exported = JSON.stringify(createPlanExport(reloaded));
    expect(exported).toContain("checkpoint_final.pth");
    expect(exported).toContain(`"sha256":"${"6".repeat(64)}"`);
    const report = createHumanReadableReport(reloaded);
    expect(report).toContain("MAT Planner knee_bone_masker.BoneMaskPipeline");
    expect(report).toContain(`plans.json ${"7".repeat(64)}`);
  });

  it("does not silently resolve a historical plan against the current catalog", () => {
    const historical = structuredClone(plan);
    historical.catalogVersion = "0.9.0";
    const exported = createPlanExport(historical);
    expect(exported.catalogReferences.version).toBe("0.9.0");
    expect(exported.catalogReferences.resolvedAgainstInstalledCatalog).toBe(false);
    expect(exported.catalogReferences.variants).toEqual([]);
  });

  it("removes source filenames and user-entered case labels from de-identified JSON", () => {
    const withSource = structuredClone(plan);
    withSource.deidentifiedLabel = "Jane Example 01/02/1960";
    withSource.imaging.sources.push({
      id: "source-1",
      fileName: "Jane_Example_MRI.nii.gz",
      format: "nifti",
      byteLength: 12,
      sha256: "abc",
      importedAt: "2026-08-02T00:00:00Z",
      immutable: true,
      spacingMm: null,
      orientation: null,
      transformIds: [],
      boneIdentity: "unknown",
    });
    const json = JSON.stringify(createPlanExport(withSource));
    expect(json).not.toContain("Jane");
    expect(json).not.toContain("MRI.nii.gz");
  });
});
