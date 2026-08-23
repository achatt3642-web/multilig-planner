import { describe, expect, it } from "vitest";
import {
  GeometryAnalysisCache,
  analyzeClearance,
  notEvaluatedForMissingAnatomy,
  signedSegmentSupportClearance,
} from "./collision";
import { generateGeometry } from "./recipes";
import { vec3 } from "./mesh";

const tunnel = (id: string, y: number, diameterMm = 2) => generateGeometry({
  id,
  type: "fullTunnel",
  tunnel: { start: vec3(0, y, 0), end: vec3(20, y, 0) },
  diameterMm,
});

describe("full-volume signed clearance", () => {
  it("detects overlapping parallel bores whose centerlines never intersect", () => {
    const result = analyzeClearance(tunnel("a", 0), tunnel("b", 1.5), { thresholdMm: 1 });
    expect(result.status).toBe("conflict");
    expect(result.intersects).toBe(true);
    expect(result.signedClearanceMm).toBeCloseTo(-0.5, 8);
    expect(result.overlapDepthMm).toBeCloseTo(0.5, 8);
    expect(result.closestPoints).not.toBeNull();
  });

  it("uses finite segment endpoints instead of infinite-line distance", () => {
    const result = signedSegmentSupportClearance(
      { start: vec3(0, 0, 0), end: vec3(2, 0, 0) },
      1,
      { start: vec3(5, 2, 0), end: vec3(5, 5, 0) },
      1,
    );
    expect(result.signedDistanceMm).toBeCloseTo(Math.sqrt(13) - 2, 8);
  });

  it("distinguishes below-threshold and clear separation", () => {
    expect(analyzeClearance(tunnel("a", 0), tunnel("b", 2.5), { thresholdMm: 1 }).status).toBe("below_threshold");
    expect(analyzeClearance(tunnel("a", 0), tunnel("c", 4), { thresholdMm: 1 }).status).toBe("clear");
  });

  it("requires an explicit matching relationship with rationale for shared overlap", () => {
    const a = tunnel("acl", 0, 4);
    const b = tunnel("all", 0, 4);
    expect(analyzeClearance(a, b).status).toBe("conflict");
    expect(analyzeClearance(a, b, {
      intentionalRelationship: {
        id: "share-1",
        objectAId: "acl",
        objectBId: "all",
        kind: "shared",
        rationale: "Clinician explicitly selected a shared femoral channel",
      },
    }).status).toBe("intentional_shared");
    expect(analyzeClearance(a, b, {
      intentionalRelationship: {
        objectAId: "acl",
        objectBId: "all",
        kind: "shared",
        rationale: "   ",
      },
    }).status).toBe("conflict");
    expect(analyzeClearance(a, b, {
      intentionalRelationships: [{
        id: "unrelated",
        objectAId: "other-a",
        objectBId: "other-b",
        kind: "shared",
        rationale: "A different explicitly shared pair",
      }, {
        id: "share-2",
        objectAId: "acl",
        objectBId: "all",
        kind: "coalesced",
        rationale: "Clinician recorded this exact coalesced channel pair",
      }],
    }).status).toBe("intentional_shared");
  });

  it("returns not evaluated when any geometry-critical dimension is missing", () => {
    const incomplete = generateGeometry({
      id: "unknown",
      type: "fullTunnel",
      tunnel: { start: vec3(0, 0, 0), end: vec3(20, 0, 0) },
      diameterMm: null,
    });
    const result = analyzeClearance(incomplete, tunnel("known", 3));
    expect(result.status).toBe("not_evaluated");
    expect(result.evaluationState).toBe("missing_dimensions");
    expect(result.signedClearanceMm).toBeNull();
    expect(result.intersects).toBeNull();
    expect(result.missingRequirements).toEqual(["unknown:diameterMm"]);
  });

  it("never reports clearance when required danger anatomy is absent", () => {
    const result = notEvaluatedForMissingAnatomy(
      tunnel("pcl-posterior-pin", 0, 2.4),
      "posterior-danger-anatomy",
      "posterior neurovascular anatomy",
    );
    expect(result.status).toBe("not_evaluated");
    expect(result.evaluationState).toBe("missing_anatomy");
    expect(result.signedClearanceMm).toBeNull();
    expect(result.intersects).toBeNull();
  });

  it("includes access and deployment volumes, with layer filtering available for inspection", () => {
    const flexible = generateGeometry({
      id: "flex",
      type: "flexibleReamedSocket",
      socket: { start: vec3(0, 0, 0), end: vec3(20, 0, 0) },
      socketDiameterMm: 6,
      accessPath: [vec3(-15, 10, 0), vec3(-5, 3, 0), vec3(0, 0, 0)],
      accessDiameterMm: 6,
      minimumBendRadiusMm: 30,
    });
    const obstacle = tunnel("obstacle", 9, 4);
    const allLayers = analyzeClearance(flexible, obstacle, { thresholdMm: 1 });
    const boneOnly = analyzeClearance(flexible, obstacle, {
      thresholdMm: 1,
      includedLayerTypes: ["boneRemovalOrCompaction"],
    });
    expect(allLayers.signedClearanceMm).toBeLessThan(boneOnly.signedClearanceMm ?? 0);
    expect(allLayers.nearestLayerAId).toContain("curved-access");
    const accessObstacle = generateGeometry({
      id: "access-obstacle",
      type: "fullTunnel",
      tunnel: { start: vec3(-20, 7, 0), end: vec3(-10, 7, 0) },
      diameterMm: 4,
    });
    const relationshipDoesNotMaskAccess = analyzeClearance(flexible, accessObstacle, {
      intentionalRelationship: {
        id: "bone-share-only",
        objectAId: "flex",
        objectBId: "access-obstacle",
        kind: "shared",
        rationale: "Only the prepared bone channel is intentionally shared",
      },
    });
    expect(relationshipDoesNotMaskAccess.status).toBe("conflict");
    expect(relationshipDoesNotMaskAccess.intentionalRelationshipId).toBeUndefined();
  });

  it("marks noncircular support-radius analysis as conservative", () => {
    const profile = generateGeometry({
      id: "profile",
      type: "profileTunnel",
      tunnel: { start: vec3(0, 0, 0), end: vec3(20, 0, 0) },
      profile: { kind: "rectangle", widthMm: 8, heightMm: 3 },
      orientationDeg: 0,
    });
    const result = analyzeClearance(profile, tunnel("round", 8, 4), { thresholdMm: 2 });
    expect(result.evaluationState).toBe("evaluated");
    expect(result.conservative).toBe(true);
  });

  it("keys cached results by stable geometry hash and supports explicit invalidation", () => {
    const cache = new GeometryAnalysisCache();
    const a = tunnel("a", 0);
    const b = tunnel("b", 4);
    const first = cache.analyze(a, b);
    expect(cache.analyze(a, b)).toBe(first);
    const editedA = generateGeometry({
      id: "a",
      type: "fullTunnel",
      tunnel: { start: vec3(0, 0, 0), end: vec3(20, 0, 0) },
      diameterMm: 4,
    });
    const edited = cache.analyze(editedA, b);
    expect(edited).not.toBe(first);
    expect(edited.cacheKey).not.toBe(first.cacheKey);
    expect(cache.size).toBe(2);
    expect(cache.invalidateGeometry("a")).toBe(2);
    expect(cache.size).toBe(0);
  });
});
