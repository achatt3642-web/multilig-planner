import { describe, expect, it } from "vitest";
import type { CrossSection, ProcedureIdentity } from "../domain/types";
import { channelToGeometry } from "../app/channelGeometry";
import {
  PROCEDURE_QUICK_ADD,
  TECHNIQUE_PRESETS,
  getTechniquePreset,
  getTechniquePresetsForProcedure,
  instantiateTechniquePreset,
} from "./techniquePresets";

const idFactory = (): (() => string) => {
  let id = 0;
  return () => `id-${++id}`;
};

describe("data-driven technique presets", () => {
  it("exposes every required quick-add procedure in one registry", () => {
    expect(PROCEDURE_QUICK_ADD.map(({ id }) => id)).toEqual([
      "ACL", "PCL", "PLC_FCL", "MCL_POL_PMC", "ALL", "LET", "MEDIAL_ROOT", "LATERAL_ROOT", "CUSTOM",
    ] satisfies ProcedureIdentity[]);
    for (const procedure of PROCEDURE_QUICK_ADD) {
      expect(getTechniquePresetsForProcedure(procedure.id).length).toBeGreaterThan(0);
    }
    expect(new Set(TECHNIQUE_PRESETS.map(({ id }) => id)).size).toBe(TECHNIQUE_PRESETS.length);
  });

  it("covers every named ACL and PCL preset family", () => {
    const aclNames = getTechniquePresetsForProcedure("ACL").map(({ name }) => name).join(" | ");
    ["transtibial", "anteromedial", "Outside-in", "Flexible", "All-inside", "Full-tunnel", "BTB", "Double-bundle", "Ribbon", "Oval", "Rectangular", "C-shaped", "Repair", "Physeal", "Custom"]
      .forEach((name) => expect(aclNames).toContain(name));

    const pclNames = getTechniquePresetsForProcedure("PCL").map(({ name }) => name).join(" | ");
    ["transtibial", "all-inside", "Outside-in", "Flexible", "Rigid", "Double-bundle", "inlay", "Repair", "Physeal", "Custom"]
      .forEach((name) => expect(pclNames).toContain(name));
  });

  it("creates distinct all-inside retro sockets without silently choosing dimensions or devices", () => {
    const { channels } = instantiateTechniquePreset("acl-all-inside-bilateral-sockets", {
      createId: idFactory(),
      createdAt: "2026-08-02T00:00:00Z",
    });
    expect(channels).toHaveLength(2);
    expect(channels.map(({ bone }) => bone)).toEqual(["femur", "tibia"]);
    expect(channels.every(({ geometryType }) => geometryType === "retrograde_socket")).toBe(true);
    expect(channels.every(({ depthMm }) => depthMm === null)).toBe(true);
    expect(channels.every(({ crossSection }) => (crossSection as Extract<CrossSection, { kind: "circle" }>).diameterMm === null)).toBe(true);
    expect(channels.every(({ instrumentChain }) =>
      instrumentChain.completionState === "incomplete" &&
      instrumentChain.manufacturerId === null &&
      instrumentChain.productVariantId === null &&
      instrumentChain.userVerified === false
    )).toBe(true);
    expect(channels.every(({ layers }) => layers.length === 8)).toBe(true);
  });

  it("creates the anatomic PLC channel set and no extra forced channels", () => {
    const { channels } = instantiateTechniquePreset("plc-anatomic-laprade", { createId: idFactory() });
    expect(channels.map(({ label }) => label)).toEqual([
      "FCL femoral", "Popliteus femoral", "Fibular-head tunnel", "PLC tibial tunnel",
    ]);
    expect(channels.filter(({ bone }) => bone === "femur")).toHaveLength(2);
    expect(channels.some(({ bone }) => bone === "fibula")).toBe(true);
    expect(channels.some(({ bone }) => bone === "tibia")).toBe(true);
  });

  it("renders direct root anchors and LET onlay as editable small pilots, never graft-sized tunnels", () => {
    for (const presetId of ["medial-root-direct-anchor", "lateral-root-direct-anchor"]) {
      const { channels } = instantiateTechniquePreset(presetId, { createId: idFactory() });
      expect(channels).toHaveLength(1);
      expect(channels[0].geometryType).toBe("anchor_pilot");
      expect(channels[0].diameterMm).toBe(2.6);
      expect(channels[0].depthMm).toBe(20);
      expect(channels[0].noLargeTunnel).toBe(true);
    }
    const letOnlay = instantiateTechniquePreset("let-no-large-tunnel-onlay", { createId: idFactory() }).channels[0];
    expect(letOnlay.geometryType).toBe("anchor_pilot");
    expect(letOnlay.noLargeTunnel).toBe(true);
    expect(letOnlay.diameterMm).toBe(4.75);
    expect(letOnlay.depthMm).toBe(22);
  });

  it("gives every collateral and root anchor template an immediately visible generic socket/pilot", () => {
    const expectedChannelCounts: Record<string, number> = {
      "medial-root-direct-anchor": 1,
      "lateral-root-direct-anchor": 1,
      "plc-repair-onlay": 2,
      "mcl-repair": 1,
      "mcl-internal-brace": 2,
      "mcl-onlay": 1,
      "all-anchor-onlay": 2,
      "all-repair-augmentation": 1,
      "let-anchor": 1,
      "let-no-large-tunnel-onlay": 1,
    };

    for (const [presetId, expectedCount] of Object.entries(expectedChannelCounts)) {
      const { channels } = instantiateTechniquePreset(presetId, { createId: idFactory() });
      expect(channels, presetId).toHaveLength(expectedCount);
      for (const channel of channels) {
        const usesInterferenceScale = (channel.genericSeed.diameterMm?.[1] ?? 0) >= 4.75;
        const expectedDiameterMm = usesInterferenceScale ? 4.75 : 2.6;
        const expectedDepthMm = usesInterferenceScale ? 22 : 20;
        expect(channel.geometryType, presetId).toBe("anchor_pilot");
        expect(channel.fullThickness, presetId).toBe(false);
        expect(channel.noLargeTunnel, presetId).toBe(true);
        expect(channel.depthMm, presetId).toBe(expectedDepthMm);
        expect(channel.diameterMm, presetId).toBe(expectedDiameterMm);
        expect(channel.crossSection, presetId).toEqual({ kind: "circle", diameterMm: expectedDiameterMm });
        expect(channel.genericSeed.depthMm, presetId).toEqual([4, 30]);
        expect(channel.genericSeed.diameterMm?.[0], presetId).toBeLessThanOrEqual(expectedDiameterMm);
        expect(channel.genericSeed.diameterMm?.[1], presetId).toBeGreaterThanOrEqual(expectedDiameterMm);
        expect(channel.genericSeed.pilotDiameterMm, presetId).toEqual(channel.genericSeed.diameterMm);
        expect(channel.verificationState, presetId).toBe("needs_dimensions");
        expect(channel.instrumentChain.completionState, presetId).toBe("incomplete");
        expect(channel.instrumentChain.productVariantId, presetId).toBeNull();
        expect(channel.instrumentChain.fixationPreparationInstrumentIds, presetId).toEqual([]);
        expect(channel.warnings.join(" "), presetId).toMatch(/generic visual planning seed.*not.*device-verified/i);

        const geometry = channelToGeometry(channel);
        expect(geometry.recipeType, presetId).toBe("anchor");
        expect(geometry.layers.some((layer) => layer.type === "boneRemovalOrCompaction"), presetId).toBe(true);
        expect(geometry.complete, presetId).toBe(false);
        expect(geometry.missingDimensions, presetId).toContain("anchor.diameterMm");
      }
    }
  });

  it("creates two independent root channels for each double-tunnel identity", () => {
    for (const presetId of ["medial-root-double-transtibial", "lateral-root-double-transtibial"]) {
      const found = getTechniquePreset(presetId);
      expect(found).toBeDefined();
      const { channels } = instantiateTechniquePreset(presetId, { createId: idFactory() });
      expect(channels).toHaveLength(2);
      expect(new Set(channels.map(({ id }) => id)).size).toBe(2);
      expect(channels.every(({ geometryType }) => geometryType === "round_full_tunnel")).toBe(true);
    }
  });

  it("requires an explicit relationship and rationale for shared-channel presets", () => {
    for (const presetId of ["all-shared-acl-femoral", "medial-root-shared-coalesced", "lateral-root-shared-coalesced"]) {
      const { channels } = instantiateTechniquePreset(presetId, { createId: idFactory() });
      expect(channels[0].intentionalRelationshipIds).toEqual([]);
      expect(channels[0].warnings.join(" ")).toMatch(/rationale.*overlap alone is a conflict/i);
    }
  });

  it("never adds a silent instrument, graft, fixation, or device-authoritative dimension in any preset", () => {
    for (const technique of TECHNIQUE_PRESETS) {
      const { channels } = instantiateTechniquePreset(technique, { createId: idFactory() });
      expect(channels.length, technique.id).toBeGreaterThan(0);
      for (const channel of channels) {
        const hasGenericAnchorVisualSeed = channel.warnings.some((warning) => warning.includes("generic visual planning seed"));
        if (hasGenericAnchorVisualSeed) {
          const usesInterferenceScale = (channel.genericSeed.diameterMm?.[1] ?? 0) >= 4.75;
          expect(channel.depthMm, technique.id).toBe(usesInterferenceScale ? 22 : 20);
          expect(channel.diameterMm, technique.id).toBe(usesInterferenceScale ? 4.75 : 2.6);
          expect(channel.verificationState, technique.id).toBe("needs_dimensions");
        } else {
          expect(channel.depthMm, technique.id).toBeNull();
          expect(channel.diameterMm, technique.id).toBeUndefined();
        }
        expect(channel.tipOvershootMm, technique.id).toBeNull();
        expect(channel.graft, technique.id).toBeNull();
        expect(channel.fixation, technique.id).toEqual([]);
        expect(channel.instrumentChain.completionState, technique.id).toBe("incomplete");
        expect(channel.instrumentChain.productVariantId, technique.id).toBeNull();
        expect(channel.instrumentChain.cutterInstrumentId, technique.id).toBeNull();
      }
    }
  });
});
