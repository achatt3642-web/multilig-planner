import type { ViewerMeshPayload } from "../viewer/types";
import {
  GEOMETRY_EPSILON,
  add3,
  cross3,
  distance3,
  dot3,
  lengthSquared3,
  normalize3,
  scale3,
  sub3,
  type Vec3,
} from "./mesh";

const GRID_CELL_MM = 8;
const MAX_TRIANGLE_GRID_CELLS = 216;

interface IndexedTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  normal: Vec3;
}

interface SurfaceIndex {
  centroid: Vec3;
  triangles: IndexedTriangle[];
  cells: Map<string, number[]>;
  oversizedTriangleIndices: number[];
  minCell: readonly [number, number, number];
  maxCell: readonly [number, number, number];
}

export interface MeshSurfaceContact {
  point: Vec3;
  outwardNormal: Vec3;
  distanceMm: number;
  signedDistanceMm: number;
}

export type MeshPointContainment = "inside" | "outside" | "ambiguous";

const indexByFacesAndVertices = new WeakMap<object, WeakMap<object, SurfaceIndex>>();

function finiteVertex(value: readonly number[] | undefined): value is readonly [number, number, number] {
  return Boolean(value && value.length === 3 && value.every(Number.isFinite));
}

function cellCoordinate(value: number): number {
  return Math.floor(value / GRID_CELL_MM);
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function triangleClosestPoint(point: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  // Ericson, Real-Time Collision Detection, closest point on a triangle.
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const ap = sub3(point, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;

  const bp = sub3(point, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return add3(a, scale3(ab, v));
  }

  const cp = sub3(point, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return add3(a, scale3(ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = sub3(c, b);
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return add3(b, scale3(edge, w));
  }

  const inverse = 1 / (va + vb + vc);
  const v = vb * inverse;
  const w = vc * inverse;
  return add3(a, add3(scale3(ab, v), scale3(ac, w)));
}

function surfaceIndex(mesh: ViewerMeshPayload): SurfaceIndex | null {
  const facesKey = mesh.faces as object;
  const verticesKey = mesh.vertices as object;
  const byVertices = indexByFacesAndVertices.get(facesKey);
  const cached = byVertices?.get(verticesKey);
  if (cached) return cached;

  let vertexCount = 0;
  const centroid = { x: 0, y: 0, z: 0 };
  for (const vertex of mesh.vertices) {
    if (!finiteVertex(vertex)) continue;
    centroid.x += vertex[0];
    centroid.y += vertex[1];
    centroid.z += vertex[2];
    vertexCount += 1;
  }
  if (!vertexCount) return null;
  centroid.x /= vertexCount;
  centroid.y /= vertexCount;
  centroid.z /= vertexCount;

  const triangles: IndexedTriangle[] = [];
  const cells = new Map<string, number[]>();
  const oversizedTriangleIndices: number[] = [];
  const minCell = [Infinity, Infinity, Infinity] as [number, number, number];
  const maxCell = [-Infinity, -Infinity, -Infinity] as [number, number, number];

  for (const face of mesh.faces) {
    if (!face || face.length !== 3) continue;
    const av = mesh.vertices[face[0]];
    const bv = mesh.vertices[face[1]];
    const cv = mesh.vertices[face[2]];
    if (!finiteVertex(av) || !finiteVertex(bv) || !finiteVertex(cv)) continue;
    const a = { x: av[0], y: av[1], z: av[2] };
    const b = { x: bv[0], y: bv[1], z: bv[2] };
    const c = { x: cv[0], y: cv[1], z: cv[2] };
    const normalVector = cross3(sub3(b, a), sub3(c, a));
    if (lengthSquared3(normalVector) <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) continue;
    const triangleIndex = triangles.length;
    triangles.push({ a, b, c, normal: normalize3(normalVector, "surface triangle normal") });

    const lower = [
      cellCoordinate(Math.min(a.x, b.x, c.x)),
      cellCoordinate(Math.min(a.y, b.y, c.y)),
      cellCoordinate(Math.min(a.z, b.z, c.z)),
    ] as const;
    const upper = [
      cellCoordinate(Math.max(a.x, b.x, c.x)),
      cellCoordinate(Math.max(a.y, b.y, c.y)),
      cellCoordinate(Math.max(a.z, b.z, c.z)),
    ] as const;
    for (let axis = 0; axis < 3; axis += 1) {
      minCell[axis] = Math.min(minCell[axis], lower[axis]);
      maxCell[axis] = Math.max(maxCell[axis], upper[axis]);
    }
    const coveredCellCount = (upper[0] - lower[0] + 1) *
      (upper[1] - lower[1] + 1) *
      (upper[2] - lower[2] + 1);
    if (coveredCellCount > MAX_TRIANGLE_GRID_CELLS) {
      oversizedTriangleIndices.push(triangleIndex);
      continue;
    }
    for (let x = lower[0]; x <= upper[0]; x += 1) {
      for (let y = lower[1]; y <= upper[1]; y += 1) {
        for (let z = lower[2]; z <= upper[2]; z += 1) {
          const key = cellKey(x, y, z);
          const members = cells.get(key) ?? [];
          members.push(triangleIndex);
          cells.set(key, members);
        }
      }
    }
  }
  if (!triangles.length) return null;
  const index = { centroid, triangles, cells, oversizedTriangleIndices, minCell, maxCell };
  const nextByVertices = byVertices ?? new WeakMap<object, SurfaceIndex>();
  nextByVertices.set(verticesKey, index);
  if (!byVertices) indexByFacesAndVertices.set(facesKey, nextByVertices);
  return index;
}

function outwardNormal(index: SurfaceIndex, triangle: IndexedTriangle, surfacePoint: Vec3): Vec3 {
  const radial = sub3(surfacePoint, index.centroid);
  return dot3(triangle.normal, radial) >= 0 ? triangle.normal : scale3(triangle.normal, -1);
}

/**
 * Returns the exact closest point on a triangle mesh using a cached uniform-grid
 * broad phase. Triangle winding is not trusted; the local normal is oriented
 * away from the mesh centroid for deterministic display-surface clearance.
 */
export function closestMeshSurfaceContact(
  point: Vec3,
  mesh: ViewerMeshPayload,
): MeshSurfaceContact | null {
  const index = surfaceIndex(mesh);
  if (!index) return null;
  const origin = [cellCoordinate(point.x), cellCoordinate(point.y), cellCoordinate(point.z)] as const;
  const maximumRadius = Math.max(
    Math.abs(origin[0] - index.minCell[0]),
    Math.abs(origin[0] - index.maxCell[0]),
    Math.abs(origin[1] - index.minCell[1]),
    Math.abs(origin[1] - index.maxCell[1]),
    Math.abs(origin[2] - index.minCell[2]),
    Math.abs(origin[2] - index.maxCell[2]),
  );
  const evaluated = new Set<number>();
  let closestPoint: Vec3 | null = null;
  let closestTriangle: IndexedTriangle | null = null;
  let closestDistanceSquared = Infinity;

  const evaluateTriangle = (triangleIndex: number): void => {
    if (evaluated.has(triangleIndex)) return;
    evaluated.add(triangleIndex);
    const triangle = index.triangles[triangleIndex];
    const candidate = triangleClosestPoint(point, triangle.a, triangle.b, triangle.c);
    const delta = sub3(point, candidate);
    const distanceSquared = lengthSquared3(delta);
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestPoint = candidate;
      closestTriangle = triangle;
    }
  };
  index.oversizedTriangleIndices.forEach(evaluateTriangle);

  for (let radius = 0; radius <= maximumRadius; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== radius) continue;
          const members = index.cells.get(cellKey(origin[0] + dx, origin[1] + dy, origin[2] + dz));
          members?.forEach(evaluateTriangle);
        }
      }
    }
    // Every unvisited cell starts at least radius cell-widths from a point in
    // the origin cell. Once the current exact distance is smaller, no
    // unvisited triangle AABB can improve the result.
    if (radius > 0 && closestDistanceSquared <= (radius * GRID_CELL_MM) ** 2) break;
  }
  if (!closestPoint || !closestTriangle) return null;
  const normal = outwardNormal(index, closestTriangle, closestPoint);
  return {
    point: closestPoint,
    outwardNormal: normal,
    distanceMm: distance3(point, closestPoint),
    signedDistanceMm: dot3(sub3(point, closestPoint), normal),
  };
}

function rayTriangleDistance(
  origin: Vec3,
  direction: Vec3,
  triangle: IndexedTriangle,
): number | null {
  const edgeA = sub3(triangle.b, triangle.a);
  const edgeB = sub3(triangle.c, triangle.a);
  const perpendicular = cross3(direction, edgeB);
  const determinant = dot3(edgeA, perpendicular);
  if (Math.abs(determinant) <= 1e-10) return null;
  const inverse = 1 / determinant;
  const fromA = sub3(origin, triangle.a);
  const u = dot3(fromA, perpendicular) * inverse;
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  const cross = cross3(fromA, edgeA);
  const v = dot3(direction, cross) * inverse;
  if (v < -1e-8 || u + v > 1 + 1e-8) return null;
  const distance = dot3(edgeB, cross) * inverse;
  return distance > 1e-8 ? distance : null;
}

function rayParityAlongAxis(
  point: Vec3,
  index: SurfaceIndex,
  axis: 0 | 1 | 2,
): boolean {
  const direction = axis === 0
    ? { x: 1, y: 0, z: 0 }
    : axis === 1
      ? { x: 0, y: 1, z: 0 }
      : { x: 0, y: 0, z: 1 };
  // A deterministic sub-micron transverse offset avoids rays that pass
  // exactly through voxel-mesh edges without changing clinical coordinates.
  const origin = {
    x: point.x + (axis === 0 ? 0 : axis === 1 ? 1.7e-7 : -1.1e-7),
    y: point.y + (axis === 1 ? 0 : axis === 2 ? 1.3e-7 : -1.9e-7),
    z: point.z + (axis === 2 ? 0 : axis === 0 ? 2.3e-7 : -1.5e-7),
  };
  const originCell = [
    cellCoordinate(origin.x),
    cellCoordinate(origin.y),
    cellCoordinate(origin.z),
  ] as [number, number, number];
  const candidates = new Set<number>(index.oversizedTriangleIndices);
  const firstCell = Math.max(originCell[axis], index.minCell[axis]);
  for (let coordinate = firstCell; coordinate <= index.maxCell[axis]; coordinate += 1) {
    const cell = [...originCell] as [number, number, number];
    cell[axis] = coordinate;
    index.cells.get(cellKey(cell[0], cell[1], cell[2]))?.forEach((triangleIndex) => {
      candidates.add(triangleIndex);
    });
  }
  const distances = [...candidates]
    .flatMap((triangleIndex) => {
      const distance = rayTriangleDistance(origin, direction, index.triangles[triangleIndex]);
      return distance === null ? [] : [distance];
    })
    .sort((left, right) => left - right);
  let crossings = 0;
  let prior = -Infinity;
  distances.forEach((distance) => {
    // Adjacent coplanar triangles produce the same geometric crossing.
    if (distance - prior <= 1e-5) return;
    crossings += 1;
    prior = distance;
  });
  return crossings % 2 === 1;
}

/**
 * Classifies a point using majority ray parity over three orthogonal rays.
 * This is deterministic for closed segmentation meshes and remains useful for
 * meshes with small boundary defects. A split vote is reported as ambiguous
 * so callers can fail closed rather than inventing exterior clearance.
 */
export function meshPointContainment(
  point: Vec3,
  mesh: ViewerMeshPayload,
): MeshPointContainment {
  const index = surfaceIndex(mesh);
  if (!index) return "ambiguous";
  const votes = ([0, 1, 2] as const).map((axis) => rayParityAlongAxis(point, index, axis));
  const insideVotes = votes.filter(Boolean).length;
  if (insideVotes >= 2) return "inside";
  if (insideVotes <= 1) return "outside";
  return "ambiguous";
}

/**
 * Moves a tube center outside every supplied display mesh until a complete
 * circular cross-section of `radiusMm` has the requested edge clearance.
 */
export function clearTubeCenterFromMeshes(
  center: Vec3,
  radiusMm: number,
  edgeClearanceMm: number,
  meshes: readonly ViewerMeshPayload[],
): Vec3 {
  const requiredCenterDistanceMm = radiusMm + edgeClearanceMm;
  let cleared = center;
  for (let pass = 0; pass < Math.max(2, meshes.length * 2); pass += 1) {
    let changed = false;
    for (const mesh of meshes) {
      const contact = closestMeshSurfaceContact(cleared, mesh);
      if (!contact) continue;
      // The imported MAT display meshes may contain boundary edges, so a
      // centroid-oriented face normal is suitable for choosing the local
      // exterior direction but not for a global inside/outside parity claim.
      // Restrict correction to an actual radius violation; this avoids a
      // distant open surface pulling several path samples onto one point.
      const insideOrTooClose = contact.distanceMm < requiredCenterDistanceMm;
      if (!insideOrTooClose) continue;
      cleared = add3(contact.point, scale3(contact.outwardNormal, requiredCenterDistanceMm));
      changed = true;
    }
    if (!changed) break;
  }
  return cleared;
}

/**
 * Solves the smallest local translation along a caller-supplied exterior ray
 * that clears a complete circular tube cross-section from every mesh. The ray
 * keeps an attachment center tied to its persisted surface normal instead of
 * allowing a nearest-face projection to slide it sideways across the cortex.
 */
export function minimumTubeCenterOffsetAlongDirection(
  center: Vec3,
  exteriorDirection: Vec3,
  radiusMm: number,
  edgeClearanceMm: number,
  meshes: readonly ViewerMeshPayload[],
): number | null {
  const direction = normalize3(exteriorDirection, "tube exterior direction");
  const requiredCenterDistanceMm = radiusMm + edgeClearanceMm;
  let offsetMm = 0;
  for (let pass = 0; pass < 18; pass += 1) {
    const candidate = add3(center, scale3(direction, offsetMm));
    let additionalOffsetMm = 0;
    for (const mesh of meshes) {
      const contact = closestMeshSurfaceContact(candidate, mesh);
      if (!contact || contact.distanceMm >= requiredCenterDistanceMm) continue;
      const alignment = dot3(direction, contact.outwardNormal);
      const euclideanDeficit = requiredCenterDistanceMm - contact.distanceMm;
      const normalDeficit = requiredCenterDistanceMm - contact.signedDistanceMm;
      const step = alignment > 0.12
        ? Math.max(euclideanDeficit, normalDeficit) / alignment
        : euclideanDeficit + 0.25;
      additionalOffsetMm = Math.max(additionalOffsetMm, Math.min(requiredCenterDistanceMm * 2, step));
    }
    if (additionalOffsetMm <= 1e-5) return offsetMm;
    offsetMm += Math.max(0.05, additionalOffsetMm);
    if (!Number.isFinite(offsetMm) || offsetMm > 80) return null;
  }

  const candidate = add3(center, scale3(direction, offsetMm));
  const cleared = meshes.every((mesh) => {
    const contact = closestMeshSurfaceContact(candidate, mesh);
    return contact === null || contact.distanceMm >= requiredCenterDistanceMm;
  });
  return cleared ? offsetMm : null;
}
