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

/** Patient RAS coordinate in millimetres. */
export type PatientRasPoint = readonly [number, number, number];

export interface SurfaceTriangleIdentity {
  meshId: string;
  /** Stable zero-based index into ViewerMeshPayload.faces. */
  faceIndex: number;
  vertexIndices: readonly [number, number, number];
  stableId: string;
}

export interface SurfaceProjection {
  status: "projected";
  coordinateSpace: "patient_ras";
  units: "mm";
  meshId: string;
  sourcePointPatientRasMm: PatientRasPoint;
  closestPointPatientRasMm: PatientRasPoint;
  distanceMm: number;
  squaredDistanceMm2: number;
  triangle: SurfaceTriangleIdentity;
  /** Weights correspond to triangle.vertexIndices and sum to one. */
  barycentric: readonly [number, number, number];
  surfaceNormalPatientRas: PatientRasPoint;
  constraint:
    | { kind: "whole_mesh" }
    | {
        kind: "tibial_superior_envelope";
        definition: "maximum_patient_ras_z_at_requested_xy";
        method: "user_defined_superior_envelope";
        ruleVersion: "1";
        sourceMeshId: string;
        reviewStatus: "not_clinician_approved";
        resolution: "vertical_intersection" | "nearest_xy_fallback";
        /** Zero for a vertical intersection; positive for an outside-footprint fallback. */
        xyDistanceMm: number;
      }
    | {
        kind: "tibial_plateau_region";
        regionId: string;
        sourceAssetId: string;
        verifiedBy: string;
        verifiedAt: string;
      };
}

export type SurfaceProjectionUnavailableReason =
  | "invalid_point"
  | "invalid_mesh"
  | "mesh_has_no_triangles"
  | "no_valid_triangles"
  | "tibial_plateau_region_missing"
  | "tibial_plateau_region_unapproved"
  | "tibial_plateau_region_unverified"
  | "tibial_plateau_region_mesh_mismatch"
  | "tibial_plateau_region_invalid";

export interface SurfaceProjectionNotEvaluated {
  status: "not_evaluated";
  coordinateSpace: "patient_ras";
  units: "mm";
  meshId: string;
  reason: SurfaceProjectionUnavailableReason;
  missingRequirements: string[];
  message: string;
}

export type SurfaceProjectionResult = SurfaceProjection | SurfaceProjectionNotEvaluated;

export interface SurfaceProjectionOptions {
  /**
   * Optional explicit face mask. Indices are normalized into ascending order so
   * ties resolve deterministically regardless of caller ordering.
   */
  faceIndices?: readonly number[];
}

/**
 * Explicit, reviewed surface annotation for an intra-articular tibial entry.
 * No plateau is inferred from patient axes, bounding boxes, or mesh height.
 */
export interface TibialPlateauSurfaceRegion {
  id: string;
  bone: "tibia";
  anatomyRegion: "tibial_plateau";
  meshId: string;
  faceIndices: readonly number[];
  sourceAssetId: string;
  method: "imported_label" | "clinician_annotation" | "institution_defined";
  reviewStatus: "unreviewed" | "needs_correction" | "approved";
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface TriangleProjection {
  point: Vec3;
  barycentric: [number, number, number];
}

interface ProjectionCandidate extends TriangleProjection {
  squaredDistanceMm2: number;
  faceIndex: number;
  vertexIndices: [number, number, number];
  normal: Vec3;
}

interface ProjectedXyCandidate extends TriangleProjection {
  squaredXyDistanceMm2: number;
}

interface SuperiorEnvelopeCandidate extends ProjectionCandidate {
  squaredXyDistanceMm2: number;
}

const XY_DISTANCE_EPSILON_MM2 = GEOMETRY_EPSILON * GEOMETRY_EPSILON;

const tupleToVec3 = (point: PatientRasPoint): Vec3 => ({ x: point[0], y: point[1], z: point[2] });
const vec3ToTuple = (point: Vec3): PatientRasPoint => [point.x, point.y, point.z];

function unavailable(
  meshId: string,
  reason: SurfaceProjectionUnavailableReason,
  missingRequirements: string[],
  message: string,
): SurfaceProjectionNotEvaluated {
  return {
    status: "not_evaluated",
    coordinateSpace: "patient_ras",
    units: "mm",
    meshId,
    reason,
    missingRequirements,
    message,
  };
}

function isFinitePoint(point: PatientRasPoint): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function vertexAt(mesh: ViewerMeshPayload, index: number): Vec3 | null {
  const vertex = mesh.vertices[index];
  if (!vertex || vertex.length !== 3 || !vertex.every(Number.isFinite)) return null;
  return { x: vertex[0], y: vertex[1], z: vertex[2] };
}

function normalizedFaceIndices(mesh: ViewerMeshPayload, requested?: readonly number[]): number[] | null {
  if (requested === undefined) return mesh.faces.map((_, index) => index);
  if (requested.length === 0) return [];
  if (!requested.every((index) => Number.isInteger(index) && index >= 0 && index < mesh.faces.length)) {
    return null;
  }
  return [...new Set(requested)].sort((left, right) => left - right);
}

function triangleProjection(point: Vec3, a: Vec3, b: Vec3, c: Vec3): TriangleProjection {
  // Ericson, Real-Time Collision Detection, closest point on triangle.
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const ap = sub3(point, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, barycentric: [1, 0, 0] };

  const bp = sub3(point, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, barycentric: [0, 1, 0] };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: add3(a, scale3(ab, v)), barycentric: [1 - v, v, 0] };
  }

  const cp = sub3(point, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, barycentric: [0, 0, 1] };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { point: add3(a, scale3(ac, w)), barycentric: [1 - w, 0, w] };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = sub3(c, b);
    const w = (d4 - d3) / (d4 - d3 + d5 - d6);
    return { point: add3(b, scale3(edge, w)), barycentric: [0, 1 - w, w] };
  }

  const inverse = 1 / (va + vb + vc);
  const v = vb * inverse;
  const w = vc * inverse;
  return {
    point: add3(a, add3(scale3(ab, v), scale3(ac, w))),
    barycentric: [1 - v - w, v, w],
  };
}

function interpolateTrianglePoint(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  barycentric: readonly [number, number, number],
): Vec3 {
  return add3(
    scale3(a, barycentric[0]),
    add3(scale3(b, barycentric[1]), scale3(c, barycentric[2])),
  );
}

function squaredXyDistance(point: Vec3, target: Vec3): number {
  const dx = point.x - target.x;
  const dy = point.y - target.y;
  return dx * dx + dy * dy;
}

function preferProjectedXyCandidate(
  candidate: ProjectedXyCandidate,
  best: ProjectedXyCandidate | null,
): boolean {
  if (best === null) return true;
  if (candidate.squaredXyDistanceMm2 < best.squaredXyDistanceMm2 - XY_DISTANCE_EPSILON_MM2) return true;
  if (Math.abs(candidate.squaredXyDistanceMm2 - best.squaredXyDistanceMm2) > XY_DISTANCE_EPSILON_MM2) return false;
  return candidate.point.z > best.point.z + GEOMETRY_EPSILON;
}

function projectToTriangleEdgeInXy(
  point: Vec3,
  vertices: readonly [Vec3, Vec3, Vec3],
  startIndex: 0 | 1 | 2,
  endIndex: 0 | 1 | 2,
): ProjectedXyCandidate {
  const start = vertices[startIndex];
  const end = vertices[endIndex];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  let parameter: number;
  if (lengthSquared <= XY_DISTANCE_EPSILON_MM2) {
    // Every point on an XY-collapsed edge has identical horizontal support.
    // Its maximum-Z endpoint is the superior-envelope representative.
    parameter = end.z > start.z + GEOMETRY_EPSILON ? 1 : 0;
  } else {
    parameter = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  }

  const barycentric: [number, number, number] = [0, 0, 0];
  barycentric[startIndex] = 1 - parameter;
  barycentric[endIndex] = parameter;
  const projectedPoint = interpolateTrianglePoint(vertices[0], vertices[1], vertices[2], barycentric);
  return {
    point: projectedPoint,
    barycentric,
    squaredXyDistanceMm2: squaredXyDistance(point, projectedPoint),
  };
}

/**
 * Finds the closest point in the triangle's XY support. For an XY-degenerate
 * (vertical or edge-on) triangle, multiple 3D points can share that support;
 * the highest-Z candidate is retained.
 */
function projectToTriangleInXy(point: Vec3, a: Vec3, b: Vec3, c: Vec3): ProjectedXyCandidate {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) > GEOMETRY_EPSILON) {
    const first = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
    const second = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
    const third = 1 - first - second;
    if (first >= -GEOMETRY_EPSILON && second >= -GEOMETRY_EPSILON && third >= -GEOMETRY_EPSILON) {
      const clamped: [number, number, number] = [
        Math.max(0, first),
        Math.max(0, second),
        Math.max(0, third),
      ];
      const sum = clamped[0] + clamped[1] + clamped[2];
      const barycentric: [number, number, number] = [clamped[0] / sum, clamped[1] / sum, clamped[2] / sum];
      const projectedPoint = interpolateTrianglePoint(a, b, c, barycentric);
      return {
        point: projectedPoint,
        barycentric,
        squaredXyDistanceMm2: squaredXyDistance(point, projectedPoint),
      };
    }
  }

  const vertices: [Vec3, Vec3, Vec3] = [a, b, c];
  let best: ProjectedXyCandidate | null = null;
  for (const [startIndex, endIndex] of [[0, 1], [1, 2], [2, 0]] as const) {
    const candidate = projectToTriangleEdgeInXy(point, vertices, startIndex, endIndex);
    if (preferProjectedXyCandidate(candidate, best)) best = candidate;
  }
  // A valid 3D triangle always has three evaluable projected edges.
  return best as ProjectedXyCandidate;
}

function preferSuperiorEnvelopeCandidate(
  candidate: SuperiorEnvelopeCandidate,
  best: SuperiorEnvelopeCandidate | null,
): boolean {
  if (best === null) return true;
  if (candidate.squaredXyDistanceMm2 < best.squaredXyDistanceMm2 - XY_DISTANCE_EPSILON_MM2) return true;
  if (Math.abs(candidate.squaredXyDistanceMm2 - best.squaredXyDistanceMm2) > XY_DISTANCE_EPSILON_MM2) return false;
  if (candidate.point.z > best.point.z + GEOMETRY_EPSILON) return true;
  if (Math.abs(candidate.point.z - best.point.z) > GEOMETRY_EPSILON) return false;
  return candidate.faceIndex < best.faceIndex;
}

/**
 * Projects a patient-RAS point to the exact nearest triangle on a Viewer mesh.
 * Degenerate triangles are ignored; malformed selected faces fail closed.
 */
export function projectPatientRasPointToMesh(
  point: PatientRasPoint,
  mesh: ViewerMeshPayload,
  options: SurfaceProjectionOptions = {},
): SurfaceProjectionResult {
  if (!isFinitePoint(point)) {
    return unavailable(mesh.id, "invalid_point", ["finite patient-RAS point"], "Not evaluated: the dragged patient-RAS point is invalid.");
  }
  if (!mesh.id.trim() || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.faces)) {
    return unavailable(mesh.id, "invalid_mesh", ["valid identified surface mesh"], "Not evaluated: the selected surface mesh is malformed.");
  }
  if (mesh.faces.length === 0) {
    return unavailable(mesh.id, "mesh_has_no_triangles", ["surface triangles"], "Not evaluated: the selected surface mesh has no triangles.");
  }

  const faceIndices = normalizedFaceIndices(mesh, options.faceIndices);
  if (faceIndices === null) {
    return unavailable(mesh.id, "invalid_mesh", ["valid selected face indices"], "Not evaluated: the surface-region mask references an invalid face.");
  }
  if (faceIndices.length === 0) {
    return unavailable(mesh.id, "no_valid_triangles", ["at least one selected surface triangle"], "Not evaluated: the selected surface region is empty.");
  }

  const sourcePoint = tupleToVec3(point);
  let best: ProjectionCandidate | null = null;
  for (const faceIndex of faceIndices) {
    const face = mesh.faces[faceIndex];
    if (!face || face.length !== 3 || !face.every((index) => Number.isInteger(index) && index >= 0)) {
      return unavailable(mesh.id, "invalid_mesh", [`valid triangle at face ${faceIndex}`], "Not evaluated: a selected mesh face is malformed.");
    }
    const vertexIndices: [number, number, number] = [face[0], face[1], face[2]];
    const a = vertexAt(mesh, vertexIndices[0]);
    const b = vertexAt(mesh, vertexIndices[1]);
    const c = vertexAt(mesh, vertexIndices[2]);
    if (!a || !b || !c) {
      return unavailable(mesh.id, "invalid_mesh", [`finite vertices for face ${faceIndex}`], "Not evaluated: a selected mesh face references an invalid vertex.");
    }
    const normalVector = cross3(sub3(b, a), sub3(c, a));
    if (lengthSquared3(normalVector) <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) continue;

    const projection = triangleProjection(sourcePoint, a, b, c);
    const delta = sub3(sourcePoint, projection.point);
    const squaredDistanceMm2 = lengthSquared3(delta);
    const candidate: ProjectionCandidate = {
      ...projection,
      squaredDistanceMm2,
      faceIndex,
      vertexIndices,
      normal: normalize3(normalVector, "surface triangle normal"),
    };
    // Face indices are ascending, so retaining the first equal-distance result
    // gives a deterministic triangle identity on shared edges and vertices.
    if (best === null || squaredDistanceMm2 < best.squaredDistanceMm2) best = candidate;
  }

  if (best === null) {
    return unavailable(mesh.id, "no_valid_triangles", ["non-degenerate surface triangle"], "Not evaluated: the selected surface region has no non-degenerate triangles.");
  }

  return {
    status: "projected",
    coordinateSpace: "patient_ras",
    units: "mm",
    meshId: mesh.id,
    sourcePointPatientRasMm: [...point],
    closestPointPatientRasMm: vec3ToTuple(best.point),
    distanceMm: distance3(sourcePoint, best.point),
    squaredDistanceMm2: best.squaredDistanceMm2,
    triangle: {
      meshId: mesh.id,
      faceIndex: best.faceIndex,
      vertexIndices: best.vertexIndices,
      stableId: `${mesh.id}:face:${best.faceIndex}`,
    },
    barycentric: best.barycentric,
    surfaceNormalPatientRas: vec3ToTuple(best.normal),
    constraint: { kind: "whole_mesh" },
  };
}

/**
 * Applies the user's geometric tibial-plateau rule: at the requested patient-
 * RAS X/Y coordinate, select the tibia-mask surface point with maximum patient-
 * RAS Z. If the requested X/Y lies outside the mesh footprint, select the
 * closest X/Y-supported point and then the maximum Z among equal-distance
 * candidates. This is a deterministic surface constraint, not a reviewed
 * anatomical plateau annotation.
 */
export function projectPatientRasPointToTibialSuperiorEnvelope(
  point: PatientRasPoint,
  tibiaMesh: ViewerMeshPayload,
): SurfaceProjectionResult {
  if (!isFinitePoint(point)) {
    return unavailable(
      tibiaMesh.id,
      "invalid_point",
      ["finite patient-RAS point"],
      "Not evaluated: the requested patient-RAS point is invalid.",
    );
  }
  if (!tibiaMesh.id.trim() || !Array.isArray(tibiaMesh.vertices) || !Array.isArray(tibiaMesh.faces)) {
    return unavailable(
      tibiaMesh.id,
      "invalid_mesh",
      ["valid identified tibia surface mesh"],
      "Not evaluated: the selected tibia surface mesh is malformed.",
    );
  }
  if (tibiaMesh.anatomyBone !== undefined && tibiaMesh.anatomyBone !== "tibia") {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_mesh_mismatch",
      ["mesh identified as tibia"],
      "Not evaluated: the superior-envelope rule requires a mesh identified as tibia.",
    );
  }
  if (tibiaMesh.faces.length === 0) {
    return unavailable(
      tibiaMesh.id,
      "mesh_has_no_triangles",
      ["tibia surface triangles"],
      "Not evaluated: the selected tibia surface mesh has no triangles.",
    );
  }

  const sourcePoint = tupleToVec3(point);
  let best: SuperiorEnvelopeCandidate | null = null;
  for (let faceIndex = 0; faceIndex < tibiaMesh.faces.length; faceIndex += 1) {
    const face = tibiaMesh.faces[faceIndex];
    if (!face || face.length !== 3 || !face.every((index) => Number.isInteger(index) && index >= 0)) {
      return unavailable(
        tibiaMesh.id,
        "invalid_mesh",
        [`valid triangle at face ${faceIndex}`],
        "Not evaluated: a tibia mesh face is malformed.",
      );
    }
    const vertexIndices: [number, number, number] = [face[0], face[1], face[2]];
    const a = vertexAt(tibiaMesh, vertexIndices[0]);
    const b = vertexAt(tibiaMesh, vertexIndices[1]);
    const c = vertexAt(tibiaMesh, vertexIndices[2]);
    if (!a || !b || !c) {
      return unavailable(
        tibiaMesh.id,
        "invalid_mesh",
        [`finite vertices for face ${faceIndex}`],
        "Not evaluated: a tibia mesh face references an invalid vertex.",
      );
    }
    const normalVector = cross3(sub3(b, a), sub3(c, a));
    if (lengthSquared3(normalVector) <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) continue;

    const projection = projectToTriangleInXy(sourcePoint, a, b, c);
    const delta = sub3(sourcePoint, projection.point);
    const candidate: SuperiorEnvelopeCandidate = {
      ...projection,
      squaredDistanceMm2: lengthSquared3(delta),
      faceIndex,
      vertexIndices,
      normal: normalize3(normalVector, "superior-envelope triangle normal"),
    };
    if (preferSuperiorEnvelopeCandidate(candidate, best)) best = candidate;
  }

  if (best === null) {
    return unavailable(
      tibiaMesh.id,
      "no_valid_triangles",
      ["non-degenerate tibia surface triangle"],
      "Not evaluated: the tibia surface mesh has no non-degenerate triangles.",
    );
  }

  const isVerticalIntersection = best.squaredXyDistanceMm2 <= XY_DISTANCE_EPSILON_MM2;
  const xyDistanceMm = isVerticalIntersection ? 0 : Math.sqrt(best.squaredXyDistanceMm2);
  return {
    status: "projected",
    coordinateSpace: "patient_ras",
    units: "mm",
    meshId: tibiaMesh.id,
    sourcePointPatientRasMm: [...point],
    closestPointPatientRasMm: vec3ToTuple(best.point),
    distanceMm: distance3(sourcePoint, best.point),
    squaredDistanceMm2: best.squaredDistanceMm2,
    triangle: {
      meshId: tibiaMesh.id,
      faceIndex: best.faceIndex,
      vertexIndices: best.vertexIndices,
      stableId: `${tibiaMesh.id}:face:${best.faceIndex}`,
    },
    barycentric: best.barycentric,
    surfaceNormalPatientRas: vec3ToTuple(best.normal),
    constraint: {
      kind: "tibial_superior_envelope",
      definition: "maximum_patient_ras_z_at_requested_xy",
      method: "user_defined_superior_envelope",
      ruleVersion: "1",
      sourceMeshId: tibiaMesh.id,
      reviewStatus: "not_clinician_approved",
      resolution: isVerticalIntersection ? "vertical_intersection" : "nearest_xy_fallback",
      xyDistanceMm,
    },
  };
}

/**
 * Tethers an intra-articular entry only to an explicit, approved tibial plateau
 * face annotation. Absence, review failure, or a mesh mismatch is never replaced
 * with a superior-Z or bounding-box approximation.
 */
export function projectIntraArticularEntryToTibialPlateau(
  point: PatientRasPoint,
  tibiaMesh: ViewerMeshPayload,
  plateauRegion: TibialPlateauSurfaceRegion | null | undefined,
): SurfaceProjectionResult {
  if (!plateauRegion) {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_missing",
      ["explicit tibial plateau face region"],
      "Not evaluated: no tibial plateau surface region was supplied.",
    );
  }
  if (
    plateauRegion.bone !== "tibia" ||
    plateauRegion.anatomyRegion !== "tibial_plateau"
  ) {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_invalid",
      ["region identity bone=tibia", "region identity anatomyRegion=tibial_plateau"],
      "Not evaluated: the supplied surface region is not identified as a tibial plateau region.",
    );
  }
  if (tibiaMesh.anatomyBone !== undefined && tibiaMesh.anatomyBone !== "tibia") {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_mesh_mismatch",
      ["mesh identified as tibia"],
      "Not evaluated: the supplied surface mesh is not identified as tibia.",
    );
  }
  if (plateauRegion.reviewStatus !== "approved") {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_unapproved",
      ["approved tibial plateau surface region"],
      `Not evaluated: tibial plateau region ${plateauRegion.id} is ${plateauRegion.reviewStatus.replaceAll("_", " ")}.`,
    );
  }
  if (!plateauRegion.sourceAssetId.trim() || !plateauRegion.verifiedBy?.trim() || !plateauRegion.verifiedAt?.trim()) {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_unverified",
      ["plateau source asset", "plateau reviewer", "plateau review timestamp"],
      "Not evaluated: the approved tibial plateau region lacks complete verification provenance.",
    );
  }
  if (plateauRegion.meshId !== tibiaMesh.id) {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_mesh_mismatch",
      [`plateau region registered to mesh ${tibiaMesh.id}`],
      "Not evaluated: the tibial plateau region belongs to a different mesh.",
    );
  }
  if (plateauRegion.faceIndices.length === 0) {
    return unavailable(
      tibiaMesh.id,
      "tibial_plateau_region_invalid",
      ["non-empty tibial plateau face mask"],
      "Not evaluated: the tibial plateau face region is empty.",
    );
  }

  const projection = projectPatientRasPointToMesh(point, tibiaMesh, { faceIndices: plateauRegion.faceIndices });
  if (projection.status === "not_evaluated") {
    return {
      ...projection,
      reason: "tibial_plateau_region_invalid",
      missingRequirements: projection.missingRequirements.map((requirement) => `tibial plateau: ${requirement}`),
      message: `Not evaluated: tibial plateau region ${plateauRegion.id} is invalid. ${projection.message}`,
    };
  }
  return {
    ...projection,
    constraint: {
      kind: "tibial_plateau_region",
      regionId: plateauRegion.id,
      sourceAssetId: plateauRegion.sourceAssetId,
      verifiedBy: plateauRegion.verifiedBy,
      verifiedAt: plateauRegion.verifiedAt,
    },
  };
}
