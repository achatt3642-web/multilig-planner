import { describe, expect, it } from "vitest";
import { createBundledDemoPlan } from "../demo/bundledDemo";
import type { PlanCase, ProcedureInstance } from "../domain/types";
import {
  LEGACY_ROOT_SUTURE_ANCHOR_PIN_DEPTH_MM,
  LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM,
  LEGACY_ROOT_SUTURE_ANCHOR_PIN_WARNING,
  migrateLegacyRootSutureAnchorPins,
} from "./legacyRootSutureAnchorPinMigration";

function lateralRootProcedure(plan: PlanCase): ProcedureInstance {
  const procedure = plan.procedures.find((candidate) => candidate.structure === "LATERAL_ROOT");
  if (!procedure) throw new Error("Bundled fixture is missing its lateral-root procedure");
  return procedure;
}

function lateralRootChannels(plan: PlanCase) {
  const procedureId = lateralRootProcedure(plan).id;
  return plan.variants.flatMap((variant) =>
    variant.channels.filter((channel) => channel.procedureId === procedureId));
}

describe("legacy root suture-anchor guide-pin migration", () => {
  it("replaces only legacy root point placeholders with finite pin-only geometry", () => {
    const plan = createBundledDemoPlan();
    const legacyChannels = lateralRootChannels(plan);
    expect(legacyChannels.length).toBeGreaterThan(0);
    expect(legacyChannels.every((channel) =>
      channel.geometryType === "onlay_no_large_tunnel" && channel.preparationMode === "none"))
      .toBe(true);

    const preserved = new Map(plan.variants.flatMap((variant) =>
      variant.channels
        .filter((channel) => !legacyChannels.some((legacy) => legacy.id === channel.id))
        .map((channel) => [channel.id, {
          channel,
          serialized: JSON.stringify(channel),
        }] as const)));
    const legacyGeometry = new Map(legacyChannels.map((channel) => [channel.id, {
      aperture: structuredClone(channel.aperture),
      vector: structuredClone(channel.vector),
      centerline: structuredClone(channel.centerline),
      apertureSurfaceAttachment: structuredClone(channel.apertureSurfaceAttachment),
      endpointSurfaceAttachment: structuredClone(channel.endpointSurfaceAttachment),
    }]));

    const migrated = migrateLegacyRootSutureAnchorPins(plan);

    expect(migrated).not.toBe(plan);
    for (const channel of lateralRootChannels(migrated)) {
      expect(channel).toMatchObject({
        geometryType: "rigid_pin",
        crossSection: {
          kind: "circle",
          diameterMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM,
        },
        diameterMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM,
        depthMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DEPTH_MM,
        guidePin: null,
        trajectoryControlMode: "exterior_rod",
        preparationMode: "cut",
        fullThickness: false,
        noLargeTunnel: false,
        tipOvershootMm: null,
      });
      expect(channel.warnings).toContain(LEGACY_ROOT_SUTURE_ANCHOR_PIN_WARNING);
      expect(channel.layers.every((layer) => layer.missingParameters.includes("instrument chain")))
        .toBe(true);
      expect(channel.warnings.some((warning) => warning.startsWith("Point-only fixation location")))
        .toBe(false);
      expect(channel).toMatchObject(legacyGeometry.get(channel.id)!);
    }

    for (const variant of migrated.variants) {
      for (const channel of variant.channels) {
        const prior = preserved.get(channel.id);
        if (!prior) continue;
        expect(channel).toBe(prior.channel);
        expect(JSON.stringify(channel)).toBe(prior.serialized);
      }
    }
    expect(migrated.procedures).toBe(plan.procedures);
    expect(migrated.imaging).toBe(plan.imaging);
  });

  it("accepts the v2 simplified-technique note prefix and is idempotent", () => {
    const plan = createBundledDemoPlan();
    const procedure = lateralRootProcedure(plan);
    procedure.notes = procedure.notes!.replace(
      "multilig:simplified-technique:v1:",
      "multilig:simplified-technique:v2:",
    );

    const migrated = migrateLegacyRootSutureAnchorPins(plan);
    expect(lateralRootChannels(migrated).every((channel) => channel.geometryType === "rigid_pin"))
      .toBe(true);
    expect(migrateLegacyRootSutureAnchorPins(migrated)).toBe(migrated);
  });

  it("returns the original plan when the root technique does not select a suture anchor", () => {
    const plan = createBundledDemoPlan();
    const procedure = lateralRootProcedure(plan);
    procedure.notes = procedure.notes!.replace(
      '"preparation":"suture_anchor_location"',
      '"preparation":"socket_with_guide_pin"',
    );

    expect(migrateLegacyRootSutureAnchorPins(plan)).toBe(plan);
  });

  it("does not alter a non-root point-only channel even if its note contains the same words", () => {
    const plan = createBundledDemoPlan();
    const rootProcedure = lateralRootProcedure(plan);
    const rootChannel = lateralRootChannels(plan)[0];
    const nonRootProcedure = plan.procedures.find((procedure) => procedure.structure === "PCL")!;
    nonRootProcedure.notes = rootProcedure.notes;
    const nonRootPoint = plan.variants[0].channels.find((channel) =>
      channel.procedureId === nonRootProcedure.id)!
    nonRootPoint.geometryType = "onlay_no_large_tunnel";
    nonRootPoint.preparationMode = "none";
    nonRootPoint.noLargeTunnel = true;
    const serialized = JSON.stringify(nonRootPoint);

    const migrated = migrateLegacyRootSutureAnchorPins(plan);
    const after = migrated.variants[0].channels.find((channel) => channel.id === nonRootPoint.id)!;

    expect(after).toBe(nonRootPoint);
    expect(JSON.stringify(after)).toBe(serialized);
    expect(lateralRootChannels(migrated).find((channel) => channel.id === rootChannel.id)?.geometryType)
      .toBe("rigid_pin");
  });
});
