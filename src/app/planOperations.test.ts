import { describe, expect, it } from "vitest";
import type { InstrumentChain } from "../domain/types";
import { createIncompleteInstrumentChain } from "../presets/techniquePresets";
import { createSyntheticDemoCase } from "./caseFactory";
import {
  addTechniquePreset,
  finalizeChainState,
  missingChainSelections,
  removePinTipOvershootFromPlan,
  restoreLegacyAnchorVisualTemplates,
} from "./planOperations";

function presenceCompleteChain(): InstrumentChain {
  const chain = createIncompleteInstrumentChain("chain-complete");
  return {
    ...chain,
    regionInstitutionSetId: "generic-set",
    manufacturerId: "mfr-generic",
    productFamilyId: "fam-generic-parametric",
    productVariantId: "var-generic",
    guideInstrumentId: "inst-generic-guide",
    guideSide: "universal" as const,
    hookArmOffsetAngle: { hookOrArmId: "inst-generic-hook-arm", offsetMm: 5, angleDeg: 55 },
    sleeveBulletDepthStop: { sleeveOrBulletId: "inst-generic-sleeve", depthStopMm: 25 },
    pinInstrumentId: "inst-generic-pin",
    cutterInstrumentId: "inst-generic-reamer",
    exactSizeOrProfileId: "measured-profile-1",
    depthOrFullTunnelSetting: { mode: "full_tunnel" as const, depthMm: null },
    graftSelectionId: "graft-measured",
    fixationImplantIds: ["explicit-no-fixation"],
    fixationPreparationInstrumentIds: ["explicit-no-preparation"],
  };
}

describe("instrument chain completion", () => {
  it("requires offset as part of the hook/arm/offset/angle stage", () => {
    const chain = presenceCompleteChain();
    chain.hookArmOffsetAngle.offsetMm = null;
    expect(missingChainSelections(chain)).toContain("hook/arm/offset/angle");
  });

  it("requires a positive exact value when depth mode is selected", () => {
    const chain = presenceCompleteChain();
    chain.depthOrFullTunnelSetting = { mode: "depth", depthMm: null };
    expect(missingChainSelections(chain)).toContain("depth/full-tunnel setting");
    chain.depthOrFullTunnelSetting.depthMm = 30;
    expect(missingChainSelections(chain)).not.toContain("depth/full-tunnel setting");
  });

  it("remains a warning until the explicit verification step", () => {
    const chain = presenceCompleteChain();
    expect(finalizeChainState(chain).completionState).toBe("warning");
    expect(finalizeChainState({ ...chain, userVerified: true }).completionState).toBe("complete");
  });

  it("keeps every virtual pin before the first reaming step when a procedure is added", () => {
    const updated = addTechniquePreset(createSyntheticDemoCase(), "let-no-large-tunnel-onlay");
    const sequence = updated.variants.find((variant) => variant.id === updated.activeVariantId)!.sequence;
    const firstReam = sequence.findIndex((step) => step.kind === "ream");
    const lastPin = sequence.reduce((last, step, index) => step.kind === "pin" ? index : last, -1);
    expect(lastPin).toBeLessThan(firstReam);
    expect(sequence.filter((step) => step.kind === "inspect")).toHaveLength(1);
    expect(sequence.some((step) => step.kind === "graft_pass" && step.channelId)).toBe(true);
    expect(sequence.some((step) => step.kind === "fixation" && step.channelId)).toBe(true);
    const addedProcedure = updated.procedures.at(-1)!;
    const addedChannels = updated.variants.find((variant) => variant.id === updated.activeVariantId)!.channels
      .filter((channel) => channel.procedureId === addedProcedure.id);
    expect(addedChannels.length).toBeGreaterThan(0);
    expect(addedChannels.every((channel) => channel.surfacePlacement?.state === "pending_default")).toBe(true);
    expect(addedChannels.every((channel) => channel.tipOvershootMm === null)).toBe(true);
  });

  it("removes persisted tip overshoot without mutating the source plan", () => {
    const source = createSyntheticDemoCase();
    source.variants[0].channels[0].tipOvershootMm = 11;
    source.variants[0].channels[0].warnings.push("Posterior pin exit and overshoot require review before reaming.");

    const normalized = removePinTipOvershootFromPlan(source);

    expect(normalized).not.toBe(source);
    expect(normalized.variants[0].channels[0].tipOvershootMm).toBeNull();
    expect(normalized.variants[0].channels[0].warnings).toContain("Posterior pin exit requires review before reaming.");
    expect(normalized.variants[0].channels[0].warnings.join(" ")).not.toContain("overshoot");
    expect(source.variants[0].channels[0].tipOvershootMm).toBe(11);
    expect(removePinTipOvershootFromPlan(normalized)).toBe(normalized);
  });

  it("restores one visible generic socket for legacy anchor presets without re-seeding a later clinician-cleared value", () => {
    const source = addTechniquePreset(createSyntheticDemoCase(), "all-anchor-onlay");
    const legacy = source.variants[0].channels.find((channel) =>
      channel.procedureId === source.procedures.at(-1)!.id && channel.bone === "femur",
    )!;
    legacy.depthMm = null;
    delete legacy.diameterMm;
    legacy.crossSection = { kind: "circle", diameterMm: null };
    legacy.warnings = legacy.warnings.filter((warning) => !warning.includes("generic visual planning seed"));

    const migrated = restoreLegacyAnchorVisualTemplates(source);
    const restored = migrated.variants[0].channels.find((channel) => channel.id === legacy.id)!;
    expect(migrated).not.toBe(source);
    expect(restored.depthMm).toBe(22);
    expect(restored.diameterMm).toBe(4.75);
    expect(restored.verificationState).toBe("needs_dimensions");
    expect(restored.warnings).toContain("MAT-style generic anchor visual template migration applied.");
    expect(migrated.audit.at(-1)?.action).toBe("restore_generic_anchor_visual_template");

    restored.depthMm = null;
    delete restored.diameterMm;
    restored.crossSection = { kind: "circle", diameterMm: null };
    expect(restoreLegacyAnchorVisualTemplates(migrated)).toBe(migrated);
  });
});
