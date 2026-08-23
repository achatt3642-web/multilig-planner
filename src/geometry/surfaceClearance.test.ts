import { describe, expect, it } from "vitest";
import type { ViewerMeshPayload } from "../viewer/types";
import {
  closestMeshSurfaceContact,
  meshPointContainment,
  minimumTubeCenterOffsetAlongDirection,
} from "./surfaceClearance";

const CUBE_VERTICES = [
  [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
  [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10],
] as number[][];
const CUBE_FACES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
  [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
] as number[][];

function cube(
  id: string,
  vertices: number[][] = CUBE_VERTICES,
  faces: number[][] = CUBE_FACES,
): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices,
    faces,
    color: "#ccd6d8",
    opacity: 0.3,
    layer: "bones",
    anatomyBone: "femur",
  };
}

describe("cached mesh-surface clearance", () => {
  it("orients the closest surface outward independently of triangle winding", () => {
    const forward = closestMeshSurfaceContact({ x: 13, y: 5, z: 5 }, cube("forward"));
    const reversedFaces = CUBE_FACES.map(([a, b, c]) => [a, c, b]);
    const reversed = closestMeshSurfaceContact({ x: 13, y: 5, z: 5 }, cube("reversed", CUBE_VERTICES, reversedFaces));

    expect(forward).not.toBeNull();
    expect(reversed).not.toBeNull();
    expect(forward!.point).toEqual({ x: 10, y: 5, z: 5 });
    expect(reversed!.point).toEqual(forward!.point);
    expect(forward!.outwardNormal).toEqual({ x: 1, y: 0, z: 0 });
    expect(reversed!.outwardNormal.x).toBeCloseTo(forward!.outwardNormal.x, 12);
    expect(reversed!.outwardNormal.y).toBeCloseTo(forward!.outwardNormal.y, 12);
    expect(reversed!.outwardNormal.z).toBeCloseTo(forward!.outwardNormal.z, 12);
    expect(forward!.distanceMm).toBe(3);
    expect(reversed!.signedDistanceMm).toBe(3);
  });

  it("does not reuse a surface index when topology is shared but vertices change", () => {
    const sharedFaces = CUBE_FACES.map((face) => [...face]);
    const first = cube("first", CUBE_VERTICES.map((vertex) => [...vertex]), sharedFaces);
    const shiftedVertices = CUBE_VERTICES.map(([x, y, z]) => [x + 100, y, z]);
    const shifted = cube("shifted", shiftedVertices, sharedFaces);

    expect(closestMeshSurfaceContact({ x: 13, y: 5, z: 5 }, first)?.point.x).toBe(10);
    expect(closestMeshSurfaceContact({ x: 113, y: 5, z: 5 }, shifted)?.point.x).toBe(110);
  });

  it("distinguishes a deeply buried point from an exterior point by mesh volume", () => {
    const mesh = cube("containment");
    expect(meshPointContainment({ x: 5, y: 5, z: 5 }, mesh)).toBe("inside");
    expect(meshPointContainment({ x: 15, y: 5, z: 5 }, mesh)).toBe("outside");
    expect(meshPointContainment({ x: 5, y: -5, z: 5 }, mesh)).toBe("outside");
  });

  it("solves a complete tube radius plus edge gap along an attachment normal ray", () => {
    const mesh = cube("attachment");
    const offset = minimumTubeCenterOffsetAlongDirection(
      { x: 10, y: 5, z: 5 },
      { x: 1, y: 0, z: 0 },
      2.15,
      0.6,
      [mesh],
    );
    expect(offset).toBeCloseTo(2.75, 8);
    const contact = closestMeshSurfaceContact({ x: 10 + offset!, y: 5, z: 5 }, mesh);
    expect(contact?.distanceMm).toBeCloseTo(2.75, 8);
    expect(contact?.signedDistanceMm).toBeCloseTo(2.75, 8);
  });
});
