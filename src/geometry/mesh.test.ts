import { describe, expect, it } from "vitest";
import {
  closestPointsBetweenSegments,
  createExtrusionMesh,
  resolveProfile,
  vec2,
  vec3,
  type ProfileDefinition,
} from "./mesh";

describe("patient-space mesh kernel", () => {
  it("computes closest points on finite segments, not infinite centerlines", () => {
    const result = closestPointsBetweenSegments(
      { start: vec3(0, 0, 0), end: vec3(2, 0, 0) },
      { start: vec3(5, 2, 0), end: vec3(5, 5, 0) },
    );
    expect(result.pointA).toEqual(vec3(2, 0, 0));
    expect(result.pointB).toEqual(vec3(5, 2, 0));
    expect(result.distanceMm).toBeCloseTo(Math.sqrt(13), 8);
  });

  it.each<ProfileDefinition>([
    { kind: "ellipse", widthMm: 8, heightMm: 6 },
    { kind: "stadium", widthMm: 9, heightMm: 4 },
    { kind: "rectangle", widthMm: 8, heightMm: 4 },
    { kind: "roundedRectangle", widthMm: 8, heightMm: 4, cornerRadiusMm: 1 },
    { kind: "cProfile", outerRadiusMm: 5, innerRadiusMm: 2.5, gapAngleDeg: 70 },
    { kind: "slot", lengthMm: 10, widthMm: 3 },
    { kind: "ribbon", widthMm: 10, thicknessMm: 2 },
    { kind: "polygon", points: [vec2(-4, -2), vec2(4, -2), vec2(3, 2), vec2(-3, 3)] },
    {
      kind: "importedProfile",
      sourceId: "profile-sha256",
      points: [vec2(-4, -3), vec2(4, -3), vec2(4, 3), vec2(0, 1), vec2(-4, 3)],
    },
  ])("resolves and triangulates $kind as a finite full volume", (profile) => {
    const resolved = resolveProfile(profile);
    const mesh = createExtrusionMesh(
      resolved,
      { start: vec3(2, 3, 4), end: vec3(2, 3, 24) },
      27,
      12,
    );
    expect(resolved.areaMm2).toBeGreaterThan(0);
    expect(resolved.supportRadiusMm).toBeGreaterThan(0);
    expect(mesh.positions.length).toBeGreaterThan(18);
    expect(mesh.indices.length).toBeGreaterThan(12);
    expect(mesh.bounds.max.z).toBeGreaterThan(mesh.bounds.min.z);
  });
});
