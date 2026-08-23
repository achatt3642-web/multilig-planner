import { describe, expect, it } from "vitest";
import { analyzeAllPairs } from "./collision";
import { createMultiProcedureFixture } from "./fixture";

describe("realistic synthetic multi-procedure fixture", () => {
  it("contains all high-priority procedure groups in one patient-space workload", () => {
    const fixture = createMultiProcedureFixture();
    const procedures = new Set(fixture.channels.map((channel) => channel.procedure));
    expect(procedures).toEqual(new Set([
      "ACL",
      "PCL",
      "PLC/FCL",
      "MCL/POL/PMC",
      "ALL",
      "LET",
      "Medial Root",
      "Lateral Root",
    ]));
    expect(fixture.channels.every((channel) => channel.geometry.complete)).toBe(true);
    expect(fixture.absentSafetyAnatomy).toContain("posteriorNeurovascular");
  });

  it("detects the synthetic ACL/FCL lateral-femoral conflict", () => {
    const fixture = createMultiProcedureFixture();
    const acl = fixture.channels.find((channel) => channel.id === "acl-femoral-retro")!.geometry;
    const fcl = fixture.channels.find((channel) => channel.id === "fcl-femoral")!.geometry;
    const result = analyzeAllPairs([acl, fcl], { thresholdMm: 2 })[0];
    expect(result.status).toBe("conflict");
    expect(result.signedClearanceMm).toBeLessThan(0);
  });

  it("runs the complete deterministic pairwise workload", () => {
    const fixture = createMultiProcedureFixture();
    const results = analyzeAllPairs(fixture.channels.map((channel) => channel.geometry), { thresholdMm: 2 });
    const expectedPairCount = fixture.channels.length * (fixture.channels.length - 1) / 2;
    expect(results).toHaveLength(expectedPairCount);
    expect(results.every((result) => result.evaluationState === "evaluated")).toBe(true);
    expect(results.some((result) => result.status === "conflict")).toBe(true);
    expect(results.some((result) => result.status === "clear")).toBe(true);
  });

  it("keeps direct root anchor and LET onlay free of invented large tunnels", () => {
    const fixture = createMultiProcedureFixture();
    const root = fixture.channels.find((channel) => channel.id === "lateral-root-anchor")!.geometry;
    const letOnlay = fixture.channels.find((channel) => channel.id === "let-onlay")!.geometry;
    expect(root.recipeType).toBe("anchor");
    expect(root.layers.some((layer) => layer.label.includes("socket"))).toBe(false);
    expect(letOnlay.metadata).toEqual({ noLargeTunnel: true });
    expect(letOnlay.layers.every((layer) => layer.metadata?.noLargeTunnel === true)).toBe(true);
  });
});
