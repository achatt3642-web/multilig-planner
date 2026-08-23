import type { Bone, ChannelPlan, Vector3 } from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import {
  resolveChannelStartPointPatientRas,
  resolvedTrajectoryControlMode,
  type ChannelStartPointSource,
} from "../app/channelTrajectorySemantics";
import { resolvedChannelAxis } from "../app/resolvedChannelGeometry";
import {
  add3,
  cross3,
  dot3,
  length3,
  normalize3,
  scale3,
  sub3,
  vec3,
  type Vec3,
} from "./mesh";

export const ANATOMIC_REFERENCE_FRAME_VERSION = "4";

export type ReferencePlaneId = "joint_line" | "posterior_condylar" | "midline";

export interface AnatomicReferencePlane {
  id: ReferencePlaneId;
  label: string;
  /** A point on the plane in canonical patient-RAS millimetres. */
  originPatientRasMm: Vector3;
  /** Unit normal. Positive sides are superior, anterior, and lateral respectively. */
  normalPatientRas: Vector3;
  /** Orthonormal display axes spanning the plane. */
  axisUPatientRas: Vector3;
  axisVPatientRas: Vector3;
  halfExtentUMm: number;
  halfExtentVMm: number;
}

export interface EvaluatedAnatomicReferenceFrame {
  evaluationState: "evaluated";
  algorithmVersion: typeof ANATOMIC_REFERENCE_FRAME_VERSION;
  coordinateSpace: "patient_ras";
  units: "mm";
  sourceMeshIds: string[];
  laterality: "left" | "right" | "unverified";
  lateralityVerified: boolean;
  scaleVerified: boolean;
  tibialShaftAxisPatientRas: Vector3;
  jointLine: AnatomicReferencePlane;
  jointLineDefinition: {
    method: "three_tibial_plateau_fourth_points";
    ruleVersion: "1";
    /**
     * Exact vertices of the patient-RAS tibial display surface. Selection is
     * restricted to the proximal plateau and its medial/lateral fourths before
     * a shallow superior cap admits any medial/posterior tie-break.
     */
    lateralSuperiorPointPatientRasMm: Vector3;
    medialSuperiorPointPatientRasMm: Vector3;
    medialPosteriorSuperiorPointPatientRasMm: Vector3;
    lateralTibialSpinePointPatientRasMm: Vector3;
    superiorEnvelopeCellSizeMm: 0.75;
    proximalPlateauSuperiorFraction: 0.3;
    proximalPlateauMinimumZPatientRasMm: number;
    medialFourthMaximumLateralProjectionMm: number;
    lateralFourthMinimumLateralProjectionMm: number;
    superiorCapQuantile: 0.8;
    superiorCapMaximumThicknessMm: 4;
    medialFourthSuperiorCapMinimumZPatientRasMm: number;
    superiorCapThicknessMm: number;
    plateauMedialLateralSpanMm: number;
    plateauAnteriorPosteriorSpanMm: number;
    minimumMedialLandmarkSeparationMm: number;
    minimumMedialPosteriorOffsetMm: number;
    medialLandmarkSeparationMm: number;
    medialPosteriorOffsetMm: number;
    minimumTriangleSine: 0.2;
    triangleSine: number;
    medialLateralAssignment:
      | "verified_laterality"
      | "dicom_metadata_provisional"
      | "provisional_patient_right_is_lateral";
    lateralityUsed: "left" | "right";
  };
  posteriorCondylar: AnatomicReferencePlane;
  midline: AnatomicReferencePlane;
  posteriorCondylarLine: {
    endpointAPatientRasMm: Vector3;
    endpointBPatientRasMm: Vector3;
  };
  provenance: "derived_from_display_surface_meshes_unreviewed";
}

export interface UnavailableAnatomicReferenceFrame {
  evaluationState: "not_evaluated";
  algorithmVersion: typeof ANATOMIC_REFERENCE_FRAME_VERSION;
  sourceMeshIds: string[];
  reason: string;
}

export type AnatomicReferenceFrame =
  | EvaluatedAnatomicReferenceFrame
  | UnavailableAnatomicReferenceFrame;

export interface ChannelStartPointMeasurement {
  evaluationState: "evaluated" | "not_evaluated";
  channelId: string;
  channelLabel: string;
  bone: Bone;
  pointPatientRasMm: Vector3 | null;
  pointSource: ChannelStartPointSource | null;
  jointLineSignedMm: number | null;
  midlineSignedMm: number | null;
  midlineUnsignedMm: number | null;
  posteriorCondylarSignedMm: number | null;
  lateralityVerified: boolean;
  scaleVerified: boolean;
  provisional: boolean;
  reason: string | null;
}

export interface ChannelTrajectoryAngleMeasurement {
  evaluationState: "evaluated" | "not_evaluated";
  channelId: string;
  channelLabel: string;
  bone: Bone;
  /**
   * Acute, unoriented angles of the analytic channel axis after projection
   * into each named anatomical plane. Reversing the stored axis therefore
   * cannot change the reported trajectory.
   */
  sagittalToTibialPlateauDeg: number | null;
  coronalToTibialPlateauDeg: number | null;
  axialToPosteriorCondylarDeg: number | null;
  referenceFrameVersion: typeof ANATOMIC_REFERENCE_FRAME_VERSION;
  provisional: boolean;
  reason: string | null;
}

const MIN_BONE_VERTICES = 30;
const MIN_TIBIAL_SHAFT_SPAN_MM = 18;
const MIN_CONDYLE_VERTICES = 12;
const EPSILON = 1e-8;
const TRAJECTORY_PROJECTION_EPSILON = 1e-6;
const FRAME_ORTHOGONALITY_TOLERANCE = 1e-4;
const DISPLAY_PLATEAU_AXIAL_QUANTILE = 0.72;
const PLATEAU_ML_SUPPORT_TRIM_QUANTILE = 0.02;
const SUPERIOR_ENVELOPE_CELL_SIZE_MM = 0.75 as const;
const PROXIMAL_PLATEAU_SUPERIOR_FRACTION = 0.3 as const;
const SUPERIOR_CAP_QUANTILE = 0.8 as const;
const SUPERIOR_CAP_MAXIMUM_THICKNESS_MM = 4 as const;
const MEDIAL_LANDMARK_MINIMUM_SEPARATION_MM = 5;
const MEDIAL_LANDMARK_MINIMUM_SEPARATION_ML_FRACTION = 0.2;
const MEDIAL_LANDMARK_MINIMUM_SEPARATION_AP_FRACTION = 0.25;
const MEDIAL_POSTERIOR_MINIMUM_OFFSET_AP_FRACTION = 0.2;
const MINIMUM_TRIANGLE_SINE = 0.2 as const;

function unavailable(sourceMeshIds: string[], reason: string): UnavailableAnatomicReferenceFrame {
  return {
    evaluationState: "not_evaluated",
    algorithmVersion: ANATOMIC_REFERENCE_FRAME_VERSION,
    sourceMeshIds,
    reason,
  };
}

function finiteTuple(value: readonly number[] | undefined | null): value is Vector3 {
  return Boolean(value && value.length >= 3 && value.slice(0, 3).every(Number.isFinite));
}

function toVec3(value: readonly number[]): Vec3 {
  return vec3(value[0], value[1], value[2]);
}

function toTuple(value: Vec3): Vector3 {
  return [value.x, value.y, value.z];
}

function average(points: readonly Vec3[]): Vec3 {
  const total = points.reduce((sum, point) => add3(sum, point), vec3(0, 0, 0));
  return scale3(total, 1 / points.length);
}

function sorted(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function quantileFromSorted(values: readonly number[], fraction: number): number {
  if (!values.length) throw new Error("quantile requires at least one value");
  const position = Math.max(0, Math.min(1, fraction)) * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return values[lower] * (1 - weight) + values[upper] * weight;
}

function median(values: readonly number[]): number {
  return quantileFromSorted(sorted(values), 0.5);
}

function collectBoneVertices(
  meshes: readonly ViewerMeshPayload[],
  bone: "femur" | "tibia",
): { vertices: Vec3[]; meshIds: string[] } {
  const matching = meshes.filter((mesh) => mesh.layer === "bones" && mesh.anatomyBone === bone);
  const vertices: Vec3[] = [];
  for (const mesh of matching) {
    for (const vertex of mesh.vertices) {
      if (finiteTuple(vertex)) vertices.push(toVec3(vertex));
    }
  }
  return { vertices, meshIds: matching.map((mesh) => mesh.id).sort() };
}

/**
 * Fit the shaft direction to centroids of serial inferior tibial slices.
 * Whole-bone PCA is deliberately avoided because the plateau often has the
 * largest variance in limited-field knee MRI.
 */
function fitTibialShaftAxis(vertices: readonly Vec3[]): Vec3 | null {
  const zValues = sorted(vertices.map((point) => point.z));
  const low = quantileFromSorted(zValues, 0.03);
  const high = quantileFromSorted(zValues, 0.62);
  if (high - low < MIN_TIBIAL_SHAFT_SPAN_MM) return null;

  const binCount = 14;
  const sums = Array.from({ length: binCount }, () => ({ x: 0, y: 0, z: 0, count: 0 }));
  for (const point of vertices) {
    if (point.z < low || point.z > high) continue;
    const normalized = (point.z - low) / (high - low);
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(normalized * binCount)));
    const bin = sums[index];
    bin.x += point.x;
    bin.y += point.y;
    bin.z += point.z;
    bin.count += 1;
  }
  const centroids = sums
    .filter((bin) => bin.count >= 3)
    .map((bin) => vec3(bin.x / bin.count, bin.y / bin.count, bin.z / bin.count));
  if (centroids.length < 5) return null;

  const center = average(centroids);
  let varianceZ = 0;
  let covarianceX = 0;
  let covarianceY = 0;
  for (const point of centroids) {
    const dz = point.z - center.z;
    varianceZ += dz * dz;
    covarianceX += dz * (point.x - center.x);
    covarianceY += dz * (point.y - center.y);
  }
  if (varianceZ <= EPSILON) return null;
  const direction = normalize3(vec3(covarianceX / varianceZ, covarianceY / varianceZ, 1), "tibial shaft axis");
  if (direction.z < 0.45) return null;
  return direction.z < 0 ? scale3(direction, -1) : direction;
}

function patientTransverseBasis(shaftAxis: Vec3): { right: Vec3; anterior: Vec3 } | null {
  const rasAnterior = vec3(0, 1, 0);
  const projectedAnterior = sub3(rasAnterior, scale3(shaftAxis, dot3(rasAnterior, shaftAxis)));
  if (length3(projectedAnterior) <= EPSILON) return null;
  let anterior = normalize3(projectedAnterior, "patient anterior axis");
  let right = normalize3(cross3(anterior, shaftAxis), "patient right axis");
  if (dot3(right, vec3(1, 0, 0)) < 0) right = scale3(right, -1);
  anterior = normalize3(cross3(shaftAxis, right), "orthogonal patient anterior axis");
  if (dot3(anterior, rasAnterior) < 0) anterior = scale3(anterior, -1);
  return { right, anterior };
}

function axialCoordinates(vertices: readonly Vec3[], axis: Vec3): number[] {
  return vertices.map((point) => dot3(point, axis));
}

/**
 * Locates a broad inter-bone region for posterior-condyle and plateau
 * extraction. This value is deliberately not used as the joint-line plane.
 */
function interboneRoiOffset(
  femur: readonly Vec3[],
  tibia: readonly Vec3[],
  shaftAxis: Vec3,
  rightAxis: Vec3,
  anteriorAxis: Vec3,
): number {
  const femurAxial = axialCoordinates(femur, shaftAxis);
  const tibiaAxial = axialCoordinates(tibia, shaftAxis);
  const femurSorted = sorted(femurAxial);
  const tibiaSorted = sorted(tibiaAxial);
  const femurLimit = quantileFromSorted(femurSorted, 0.32);
  const tibiaLimit = quantileFromSorted(tibiaSorted, 0.68);
  const tibiaRightSorted = sorted(tibia.map((point) => dot3(point, rightAxis)));
  const transverseSpan = quantileFromSorted(tibiaRightSorted, 0.98) - quantileFromSorted(tibiaRightSorted, 0.02);
  const cellSizeMm = Math.max(2.5, Math.min(5, transverseSpan / 24));
  const cellKey = (point: Vec3): string => `${Math.round(dot3(point, rightAxis) / cellSizeMm)}:${Math.round(dot3(point, anteriorAxis) / cellSizeMm)}`;

  const tibialSupport = new Map<string, number>();
  tibia.forEach((point, index) => {
    const axial = tibiaAxial[index];
    if (axial < tibiaLimit) return;
    const key = cellKey(point);
    tibialSupport.set(key, Math.max(tibialSupport.get(key) ?? -Infinity, axial));
  });
  const femoralSupport = new Map<string, number>();
  femur.forEach((point, index) => {
    const axial = femurAxial[index];
    if (axial > femurLimit) return;
    const key = cellKey(point);
    femoralSupport.set(key, Math.min(femoralSupport.get(key) ?? Infinity, axial));
  });

  const paired: Array<{ tibial: number; femoral: number; midpoint: number; gap: number }> = [];
  for (const [key, tibialAxial] of tibialSupport) {
    const femoralAxial = femoralSupport.get(key);
    if (femoralAxial === undefined) continue;
    const gap = femoralAxial - tibialAxial;
    if (!Number.isFinite(gap) || Math.abs(gap) > 30) continue;
    paired.push({
      tibial: tibialAxial,
      femoral: femoralAxial,
      midpoint: (femoralAxial + tibialAxial) / 2,
      gap,
    });
  }
  if (paired.length >= 4) {
    const gaps = sorted(paired.map((candidate) => candidate.gap));
    const gapQ1 = quantileFromSorted(gaps, 0.25);
    const gapQ3 = quantileFromSorted(gaps, 0.75);
    const gapIqr = Math.max(1, gapQ3 - gapQ1);
    const filtered = paired.filter((candidate) =>
      candidate.gap >= gapQ1 - 2.5 * gapIqr && candidate.gap <= gapQ3 + 2.5 * gapIqr);
    const candidates = filtered.length >= 4 ? filtered : paired;
    const admissibleLower = Math.max(...candidates.map((candidate) => candidate.tibial));
    const admissibleUpper = Math.min(...candidates.map((candidate) => candidate.femoral));
    const preferred = median(candidates.map((candidate) => candidate.midpoint));
    if (admissibleLower <= admissibleUpper) {
      return Math.max(admissibleLower, Math.min(admissibleUpper, preferred));
    }

    // Minimize sum(max(0, tibialSupport - d)^2 + max(0, d - femoralSupport)^2).
    // This is a convex 1-D objective: the first term penalizes cutting through
    // tibia and the second penalizes cutting through femur.
    let low = Math.min(...candidates.flatMap((candidate) => [candidate.tibial, candidate.femoral])) - 2;
    let high = Math.max(...candidates.flatMap((candidate) => [candidate.tibial, candidate.femoral])) + 2;
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const candidateOffset = (low + high) / 2;
      let gradient = 0;
      for (const candidate of candidates) {
        if (candidateOffset < candidate.tibial) gradient += candidateOffset - candidate.tibial;
        if (candidateOffset > candidate.femoral) gradient += candidateOffset - candidate.femoral;
      }
      if (gradient < 0) low = candidateOffset;
      else high = candidateOffset;
    }
    return (low + high) / 2;
  }

  // Fail-soft geometric fallback: robust facing extrema, never a named/manual landmark.
  const tibialFacing = quantileFromSorted(tibiaSorted, 0.985);
  const femoralFacing = quantileFromSorted(femurSorted, 0.015);
  return (tibialFacing + femoralFacing) / 2;
}

function robustPosteriorPoint(points: readonly Vec3[], anteriorAxis: Vec3): Vec3 | null {
  if (points.length < MIN_CONDYLE_VERTICES) return null;
  const ordered = [...points].sort((a, b) => dot3(a, anteriorAxis) - dot3(b, anteriorAxis));
  const count = Math.max(3, Math.ceil(ordered.length * 0.02));
  return average(ordered.slice(0, count));
}

function directionalSurfaceExtreme(points: readonly Vec3[], direction: Vec3): Vec3 | null {
  let best: Vec3 | null = null;
  let bestSupport = -Infinity;
  for (const point of points) {
    const support = dot3(point, direction);
    if (support > bestSupport + EPSILON) {
      best = point;
      bestSupport = support;
      continue;
    }
    if (Math.abs(support - bestSupport) > EPSILON || best === null) continue;
    if (point.z > best.z + EPSILON) {
      best = point;
      continue;
    }
    if (Math.abs(point.z - best.z) <= EPSILON) {
      // Fully deterministic even when a decimated mesh repeats a vertex.
      if (point.x < best.x - EPSILON ||
        (Math.abs(point.x - best.x) <= EPSILON && point.y < best.y - EPSILON)) {
        best = point;
      }
    }
  }
  return best;
}

interface SeparatedSuperiorCapLandmarks {
  medial: Vec3;
  posteromedial: Vec3;
  minimumZ: number;
  thicknessMm: number;
  separationMm: number;
  posteriorOffsetMm: number;
}

/**
 * Keep superior position primary, but never let the two medial landmarks
 * collapse onto one local high patch. The cap is relaxed one observed surface
 * level at a time and only until both scale-aware separation requirements pass.
 */
function separatedSuperiorCapLandmarks(
  points: readonly Vec3[],
  medialDirection: Vec3,
  posteriorDirection: Vec3,
  initialMinimumZ: number,
  lowestAllowedZ: number,
  minimumSeparationMm: number,
  minimumPosteriorOffsetMm: number,
): SeparatedSuperiorCapLandmarks | null {
  const lowerObservedLevels = [...new Set(points
    .map((point) => point.z)
    .filter((z) => z < initialMinimumZ - EPSILON && z >= lowestAllowedZ - EPSILON))]
    .sort((left, right) => right - left);
  const candidateMinimums = [initialMinimumZ, ...lowerObservedLevels];
  let maximumZ = -Infinity;
  for (const point of points) maximumZ = Math.max(maximumZ, point.z);

  for (const minimumZ of candidateMinimums) {
    const cap = points.filter((point) => point.z >= minimumZ - EPSILON);
    const posteromedial = directionalSurfaceExtreme(cap, posteriorDirection);
    if (!posteromedial) continue;
    const eligibleMedialPoints = cap.filter((point) => {
      const between = sub3(posteromedial, point);
      return length3(between) + EPSILON >= minimumSeparationMm &&
        dot3(between, posteriorDirection) + EPSILON >= minimumPosteriorOffsetMm;
    });
    const medial = directionalSurfaceExtreme(eligibleMedialPoints, medialDirection);
    if (!medial) continue;
    const between = sub3(posteromedial, medial);
    const separationMm = length3(between);
    const posteriorOffsetMm = dot3(between, posteriorDirection);
    if (separationMm + EPSILON < minimumSeparationMm ||
      posteriorOffsetMm + EPSILON < minimumPosteriorOffsetMm) continue;
    return {
      medial,
      posteromedial,
      minimumZ,
      thicknessMm: maximumZ - minimumZ,
      separationMm,
      posteriorOffsetMm,
    };
  }
  return null;
}

/**
 * Discrete implementation of the user's plateau rule: for each small patient-
 * RAS transverse cell retain only its highest-Z tibial surface vertex. The
 * laterality-local axes make mirrored knees equivalent; anchoring the grid to
 * the tibial bounds preserves translation invariance.
 */
function superiorEnvelopeVertices(
  points: readonly Vec3[],
  cellSizeMm: number,
  axisU: Vec3,
  axisV: Vec3,
): Vec3[] {
  if (!points.length) return [];
  let minimumU = Infinity;
  let minimumV = Infinity;
  for (const point of points) {
    minimumU = Math.min(minimumU, dot3(point, axisU));
    minimumV = Math.min(minimumV, dot3(point, axisV));
  }
  const cells = new Map<string, Vec3>();
  for (const point of points) {
    const u = dot3(point, axisU);
    const v = dot3(point, axisV);
    const uIndex = Math.floor((u - minimumU) / cellSizeMm + EPSILON);
    const vIndex = Math.floor((v - minimumV) / cellSizeMm + EPSILON);
    const key = `${uIndex}:${vIndex}`;
    const existing = cells.get(key);
    const existingU = existing ? dot3(existing, axisU) : 0;
    const existingV = existing ? dot3(existing, axisV) : 0;
    if (!existing || point.z > existing.z + EPSILON ||
      (Math.abs(point.z - existing.z) <= EPSILON &&
        (u < existingU - EPSILON ||
          (Math.abs(u - existingU) <= EPSILON && v < existingV - EPSILON)))) {
      cells.set(key, point);
    }
  }
  return [...cells.values()].sort((left, right) => {
    const uDifference = dot3(left, axisU) - dot3(right, axisU);
    const vDifference = dot3(left, axisV) - dot3(right, axisV);
    return uDifference || vDifference || left.z - right.z;
  });
}

/** Choose a stable representative of a voxelized maximum-Z patch. */
function mostSuperiorPatchMedoid(points: readonly Vec3[]): Vec3 | null {
  if (!points.length) return null;
  let highestZ = -Infinity;
  for (const point of points) highestZ = Math.max(highestZ, point.z);
  const patch = points.filter((point) => Math.abs(point.z - highestZ) <= EPSILON);
  const center = average(patch);
  let best: Vec3 | null = null;
  let bestSquaredDistance = Infinity;
  for (const point of patch) {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const dz = point.z - center.z;
    const squaredDistance = dx * dx + dy * dy + dz * dz;
    if (squaredDistance < bestSquaredDistance - EPSILON ||
      (Math.abs(squaredDistance - bestSquaredDistance) <= EPSILON && best !== null &&
        (point.x < best.x - EPSILON ||
          (Math.abs(point.x - best.x) <= EPSILON && point.y < best.y - EPSILON)))) {
      best = point;
      bestSquaredDistance = squaredDistance;
    }
  }
  return best;
}

export function deriveAnatomicReferenceFrame(
  meshes: readonly ViewerMeshPayload[],
  options: {
    laterality: "left" | "right" | "unverified";
    lateralityVerified: boolean;
    scaleVerified: boolean;
    /** Advisory DICOM metadata may orient a frame but never verifies it. */
    provisionalLateralitySource?: "dicom_metadata";
  },
): AnatomicReferenceFrame {
  const femur = collectBoneVertices(meshes, "femur");
  const tibia = collectBoneVertices(meshes, "tibia");
  const sourceMeshIds = [...femur.meshIds, ...tibia.meshIds].sort();
  if (!femur.meshIds.length || !tibia.meshIds.length) {
    return unavailable(sourceMeshIds, "Both femur and tibia surface meshes are required.");
  }
  if (femur.vertices.length < MIN_BONE_VERTICES || tibia.vertices.length < MIN_BONE_VERTICES) {
    return unavailable(sourceMeshIds, "Femur or tibia surface geometry is insufficient for reference-plane derivation.");
  }

  try {
    const shaftAxis = fitTibialShaftAxis(tibia.vertices);
    if (!shaftAxis) return unavailable(sourceMeshIds, "The tibial shaft axis could not be derived from the available inferior tibia.");
    const transverse = patientTransverseBasis(shaftAxis);
    if (!transverse) return unavailable(sourceMeshIds, "Patient anterior and tibial shaft axes are geometrically degenerate.");
    const { right: rightAxis, anterior: anteriorAxis } = transverse;
    // This broad ROI is used only to recover the already accepted posterior
    // femoral-condyle contact line and display extents. It does not define or
    // position any of the three reference planes.
    const roiJointOffset = interboneRoiOffset(femur.vertices, tibia.vertices, shaftAxis, rightAxis, anteriorAxis);

    const tibiaAxial = axialCoordinates(tibia.vertices, shaftAxis);
    const tibiaAxialSorted = sorted(tibiaAxial);
    const plateauThreshold = Math.max(
      quantileFromSorted(tibiaAxialSorted, DISPLAY_PLATEAU_AXIAL_QUANTILE),
      roiJointOffset - 15,
    );
    const plateau = tibia.vertices.filter((_, index) => tibiaAxial[index] >= plateauThreshold);
    if (plateau.length < MIN_BONE_VERTICES) {
      return unavailable(sourceMeshIds, "The proximal tibial plateau extent is insufficient for midline derivation.");
    }
    const femurAxial = axialCoordinates(femur.vertices, shaftAxis);
    const femurSorted = sorted(femurAxial);
    const femurRange = quantileFromSorted(femurSorted, 0.98) - quantileFromSorted(femurSorted, 0.02);
    const distalUpper = roiJointOffset + Math.min(45, Math.max(22, femurRange * 0.4));
    const distalFemur = femur.vertices.filter((_, index) => femurAxial[index] >= roiJointOffset - 12 && femurAxial[index] <= distalUpper);
    if (distalFemur.length < MIN_BONE_VERTICES * 2) {
      return unavailable(sourceMeshIds, "The distal femur is insufficient for posterior condylar derivation.");
    }
    const distalRight = sorted(distalFemur.map((point) => dot3(point, rightAxis)));
    const condylarSplit = (
      quantileFromSorted(distalRight, 0.04) + quantileFromSorted(distalRight, 0.96)
    ) / 2;
    const negativeCondyle = distalFemur.filter((point) => dot3(point, rightAxis) < condylarSplit);
    const positiveCondyle = distalFemur.filter((point) => dot3(point, rightAxis) >= condylarSplit);
    const endpointA = robustPosteriorPoint(negativeCondyle, anteriorAxis);
    const endpointB = robustPosteriorPoint(positiveCondyle, anteriorAxis);
    if (!endpointA || !endpointB) {
      return unavailable(sourceMeshIds, "Two distinct posterior femoral condyles could not be resolved.");
    }
    const posteriorCondylarLineVector = sub3(endpointB, endpointA);
    if (length3(posteriorCondylarLineVector) <= EPSILON) {
      return unavailable(sourceMeshIds, "The posterior condylar line is degenerate.");
    }
    const posteriorCondylarLineAxis = normalize3(posteriorCondylarLineVector, "posterior condylar line");

    // A resolved DICOM side may orient a provisional frame before the
    // clinician completes laterality verification. A generic PlanCase L/R
    // value is not enough: without explicit metadata provenance the preview
    // falls back to patient-right (+X), visibly and provisionally.
    const sideIsVerified = options.lateralityVerified && options.laterality !== "unverified";
    const hasProvisionalDicomSide = !sideIsVerified &&
      options.provisionalLateralitySource === "dicom_metadata" &&
      options.laterality !== "unverified";
    const lateralityUsed: "left" | "right" = sideIsVerified || hasProvisionalDicomSide
      ? options.laterality as "left" | "right"
      : "right";
    const lateralDirection = vec3(lateralityUsed === "right" ? 1 : -1, 0, 0);
    const medialDirection = scale3(lateralDirection, -1);
    const posteriorDirection = vec3(0, -1, 0);
    const tibialSuperiorEnvelope = superiorEnvelopeVertices(
      tibia.vertices,
      SUPERIOR_ENVELOPE_CELL_SIZE_MM,
      lateralDirection,
      scale3(posteriorDirection, -1),
    );
    const tibiaZ = sorted(tibia.vertices.map((point) => point.z));
    const tibiaMinimumZ = tibiaZ[0];
    const tibiaMaximumZ = tibiaZ[tibiaZ.length - 1];
    const proximalPlateauMinimumZ = tibiaMaximumZ -
      (tibiaMaximumZ - tibiaMinimumZ) * PROXIMAL_PLATEAU_SUPERIOR_FRACTION;
    const proximalPlateauEnvelope = tibialSuperiorEnvelope.filter((point) =>
      point.z >= proximalPlateauMinimumZ - EPSILON);
    if (proximalPlateauEnvelope.length < MIN_BONE_VERTICES) {
      return unavailable(sourceMeshIds, "The proximal tibial superior envelope is insufficient for plateau-fourth derivation.");
    }

    const plateauLateralProjections = sorted(
      proximalPlateauEnvelope.map((point) => dot3(point, lateralDirection)),
    );
    const plateauMedialSupport = quantileFromSorted(
      plateauLateralProjections,
      PLATEAU_ML_SUPPORT_TRIM_QUANTILE,
    );
    const plateauLateralSupport = quantileFromSorted(
      plateauLateralProjections,
      1 - PLATEAU_ML_SUPPORT_TRIM_QUANTILE,
    );
    const plateauMlSpan = plateauLateralSupport - plateauMedialSupport;
    if (plateauMlSpan <= EPSILON) {
      return unavailable(sourceMeshIds, "The tibial plateau medial-lateral span is degenerate.");
    }
    const medialFourthMaximumLateralProjection = plateauMedialSupport + plateauMlSpan / 4;
    const lateralFourthMinimumLateralProjection = plateauMedialSupport + plateauMlSpan * 3 / 4;
    const medialFourth = proximalPlateauEnvelope.filter((point) =>
      dot3(point, lateralDirection) <= medialFourthMaximumLateralProjection + EPSILON);
    const lateralFourth = proximalPlateauEnvelope.filter((point) =>
      dot3(point, lateralDirection) >= lateralFourthMinimumLateralProjection - EPSILON);
    const centralHalf = proximalPlateauEnvelope.filter((point) => {
      const projection = dot3(point, lateralDirection);
      return projection >= medialFourthMaximumLateralProjection - EPSILON &&
        projection <= lateralFourthMinimumLateralProjection + EPSILON;
    });
    if (medialFourth.length < MIN_BONE_VERTICES ||
      lateralFourth.length < MIN_BONE_VERTICES ||
      centralHalf.length < MIN_BONE_VERTICES) {
      return unavailable(sourceMeshIds, "The tibial plateau medial fourth, central half, or lateral fourth is insufficient.");
    }

    const lateralSuperiorPoint = mostSuperiorPatchMedoid(lateralFourth);
    const lateralTibialSpinePoint = mostSuperiorPatchMedoid(centralHalf);
    let medialFourthMaximumZ = -Infinity;
    for (const point of medialFourth) medialFourthMaximumZ = Math.max(medialFourthMaximumZ, point.z);
    const medialFourthZ = sorted(medialFourth.map((point) => point.z));
    const medialFourthSuperiorCapMinimumZ = Math.max(
      quantileFromSorted(medialFourthZ, SUPERIOR_CAP_QUANTILE),
      medialFourthMaximumZ - SUPERIOR_CAP_MAXIMUM_THICKNESS_MM,
    );
    const plateauPosteriorProjections = sorted(
      proximalPlateauEnvelope.map((point) => dot3(point, posteriorDirection)),
    );
    const plateauAnteriorPosteriorSpan = quantileFromSorted(
      plateauPosteriorProjections,
      1 - PLATEAU_ML_SUPPORT_TRIM_QUANTILE,
    ) - quantileFromSorted(
      plateauPosteriorProjections,
      PLATEAU_ML_SUPPORT_TRIM_QUANTILE,
    );
    if (plateauAnteriorPosteriorSpan <= EPSILON) {
      return unavailable(sourceMeshIds, "The tibial plateau anterior-posterior span is degenerate.");
    }
    const minimumMedialLandmarkSeparationMm =
      Math.max(
        MEDIAL_LANDMARK_MINIMUM_SEPARATION_MM,
        plateauMlSpan * MEDIAL_LANDMARK_MINIMUM_SEPARATION_ML_FRACTION,
        plateauAnteriorPosteriorSpan * MEDIAL_LANDMARK_MINIMUM_SEPARATION_AP_FRACTION,
      );
    const minimumMedialPosteriorOffsetMm =
      plateauAnteriorPosteriorSpan * MEDIAL_POSTERIOR_MINIMUM_OFFSET_AP_FRACTION;
    const medialLandmarks = separatedSuperiorCapLandmarks(
      medialFourth,
      medialDirection,
      posteriorDirection,
      medialFourthSuperiorCapMinimumZ,
      medialFourthMaximumZ - SUPERIOR_CAP_MAXIMUM_THICKNESS_MM,
      minimumMedialLandmarkSeparationMm,
      minimumMedialPosteriorOffsetMm,
    );
    if (!lateralSuperiorPoint || !lateralTibialSpinePoint || !medialLandmarks) {
      return unavailable(
        sourceMeshIds,
        "Distinct superior medial and posteromedial tibial plateau landmarks could not be resolved within the allowed superior cap.",
      );
    }
    const medialSuperiorPoint = medialLandmarks.medial;
    const medialPosteriorSuperiorPoint = medialLandmarks.posteromedial;
    if (dot3(lateralSuperiorPoint, lateralDirection) <=
      dot3(lateralTibialSpinePoint, lateralDirection) + EPSILON) {
      return unavailable(sourceMeshIds, "The lateral plateau point is not lateral to the derived lateral tibial spine.");
    }

    const jointSpanningA = sub3(lateralSuperiorPoint, medialSuperiorPoint);
    const jointSpanningB = sub3(medialPosteriorSuperiorPoint, medialSuperiorPoint);
    const jointCross = cross3(jointSpanningA, jointSpanningB);
    const jointSpanningALength = length3(jointSpanningA);
    const jointSpanningBLength = length3(jointSpanningB);
    const normalizedTriangleArea = length3(jointCross) /
      (jointSpanningALength * jointSpanningBLength);
    if (jointSpanningALength <= EPSILON || jointSpanningBLength <= EPSILON ||
      !Number.isFinite(normalizedTriangleArea) || normalizedTriangleArea < MINIMUM_TRIANGLE_SINE) {
      return unavailable(sourceMeshIds, "The three tibial joint-line landmarks do not form a stable, well-separated plane.");
    }
    let jointNormal = normalize3(jointCross, "three-point tibial joint plane normal");
    if (dot3(jointNormal, vec3(0, 0, 1)) < 0) jointNormal = scale3(jointNormal, -1);
    const jointLineOrigin = average([
      lateralSuperiorPoint,
      medialSuperiorPoint,
      medialPosteriorSuperiorPoint,
    ]);

    // The posterior plane contains the accepted posterior-condylar line and is
    // exactly perpendicular to the new three-point joint plane.
    const posteriorCross = cross3(jointNormal, posteriorCondylarLineAxis);
    if (length3(posteriorCross) <= EPSILON) {
      return unavailable(sourceMeshIds, "The posterior condylar line is perpendicular to the joint plane and cannot define a unique posterior plane.");
    }
    let posteriorNormal = normalize3(posteriorCross, "posterior condylar plane normal");
    if (dot3(posteriorNormal, vec3(0, 1, 0)) < 0) posteriorNormal = scale3(posteriorNormal, -1);
    const posteriorOrigin = average([endpointA, endpointB]);

    // The midline is the third member of the orthonormal frame. Its location
    // remains at the medial/lateral midpoint of the two tibial support points.
    let midlineNormal = normalize3(cross3(posteriorNormal, jointNormal), "midline plane normal");
    if (dot3(midlineNormal, lateralDirection) < 0) midlineNormal = scale3(midlineNormal, -1);
    const plateauMlMidpoint = (plateauMedialSupport + plateauLateralSupport) / 2;
    const plateauEnvelopeCenter = average(proximalPlateauEnvelope);
    const midlineOrigin = add3(
      plateauEnvelopeCenter,
      scale3(
        lateralDirection,
        plateauMlMidpoint - dot3(plateauEnvelopeCenter, lateralDirection),
      ),
    );

    const plateauCondylar = sorted(plateau.map((point) => dot3(point, midlineNormal)));
    const plateauPosterior = sorted(plateau.map((point) => dot3(point, posteriorNormal)));
    const plateauMlMin = quantileFromSorted(plateauCondylar, 0.02);
    const plateauMlMax = quantileFromSorted(plateauCondylar, 0.98);
    const plateauApMin = quantileFromSorted(plateauPosterior, 0.02);
    const plateauApMax = quantileFromSorted(plateauPosterior, 0.98);
    const mlHalfExtent = Math.max(25, (plateauMlMax - plateauMlMin) / 2 + 8);
    const apHalfExtent = Math.max(20, (plateauApMax - plateauApMin) / 2 + 8);
    const siHalfExtent = Math.max(32, Math.min(60, femurRange * 0.55));

    return {
      evaluationState: "evaluated",
      algorithmVersion: ANATOMIC_REFERENCE_FRAME_VERSION,
      coordinateSpace: "patient_ras",
      units: "mm",
      sourceMeshIds,
      laterality: options.laterality,
      lateralityVerified: options.lateralityVerified && options.laterality !== "unverified",
      scaleVerified: options.scaleVerified,
      tibialShaftAxisPatientRas: toTuple(shaftAxis),
      jointLine: {
        id: "joint_line",
        label: "Joint line",
        originPatientRasMm: toTuple(jointLineOrigin),
        normalPatientRas: toTuple(jointNormal),
        axisUPatientRas: toTuple(midlineNormal),
        axisVPatientRas: toTuple(posteriorNormal),
        halfExtentUMm: mlHalfExtent,
        halfExtentVMm: apHalfExtent,
      },
      jointLineDefinition: {
        method: "three_tibial_plateau_fourth_points",
        ruleVersion: "1",
        lateralSuperiorPointPatientRasMm: toTuple(lateralSuperiorPoint),
        medialSuperiorPointPatientRasMm: toTuple(medialSuperiorPoint),
        medialPosteriorSuperiorPointPatientRasMm: toTuple(medialPosteriorSuperiorPoint),
        lateralTibialSpinePointPatientRasMm: toTuple(lateralTibialSpinePoint),
        superiorEnvelopeCellSizeMm: SUPERIOR_ENVELOPE_CELL_SIZE_MM,
        proximalPlateauSuperiorFraction: PROXIMAL_PLATEAU_SUPERIOR_FRACTION,
        proximalPlateauMinimumZPatientRasMm: proximalPlateauMinimumZ,
        medialFourthMaximumLateralProjectionMm: medialFourthMaximumLateralProjection,
        lateralFourthMinimumLateralProjectionMm: lateralFourthMinimumLateralProjection,
        superiorCapQuantile: SUPERIOR_CAP_QUANTILE,
        superiorCapMaximumThicknessMm: SUPERIOR_CAP_MAXIMUM_THICKNESS_MM,
        medialFourthSuperiorCapMinimumZPatientRasMm: medialLandmarks.minimumZ,
        superiorCapThicknessMm: medialLandmarks.thicknessMm,
        plateauMedialLateralSpanMm: plateauMlSpan,
        plateauAnteriorPosteriorSpanMm: plateauAnteriorPosteriorSpan,
        minimumMedialLandmarkSeparationMm,
        minimumMedialPosteriorOffsetMm,
        medialLandmarkSeparationMm: medialLandmarks.separationMm,
        medialPosteriorOffsetMm: medialLandmarks.posteriorOffsetMm,
        minimumTriangleSine: MINIMUM_TRIANGLE_SINE,
        triangleSine: normalizedTriangleArea,
        medialLateralAssignment: sideIsVerified
          ? "verified_laterality"
          : hasProvisionalDicomSide
            ? "dicom_metadata_provisional"
            : "provisional_patient_right_is_lateral",
        lateralityUsed,
      },
      posteriorCondylar: {
        id: "posterior_condylar",
        label: "Posterior condylar axis",
        originPatientRasMm: toTuple(posteriorOrigin),
        normalPatientRas: toTuple(posteriorNormal),
        axisUPatientRas: toTuple(midlineNormal),
        axisVPatientRas: toTuple(jointNormal),
        halfExtentUMm: mlHalfExtent,
        halfExtentVMm: siHalfExtent,
      },
      midline: {
        id: "midline",
        label: "Midline",
        originPatientRasMm: toTuple(midlineOrigin),
        normalPatientRas: toTuple(midlineNormal),
        axisUPatientRas: toTuple(posteriorNormal),
        axisVPatientRas: toTuple(jointNormal),
        halfExtentUMm: apHalfExtent,
        halfExtentVMm: siHalfExtent,
      },
      posteriorCondylarLine: {
        endpointAPatientRasMm: toTuple(endpointA),
        endpointBPatientRasMm: toTuple(endpointB),
      },
      provenance: "derived_from_display_surface_meshes_unreviewed",
    };
  } catch (error) {
    return unavailable(
      sourceMeshIds,
      `Reference-plane derivation failed: ${error instanceof Error ? error.message : "unknown geometry error"}`,
    );
  }
}

export function channelStartPointPatientRas(
  channel: ChannelPlan,
  anatomyMeshes?: ViewerMeshPayload[],
): {
  point: Vector3;
  source: ChannelStartPointSource;
} | null {
  const eligibleSurfaceMeshIds = anatomyMeshes
    ? new Set(anatomyMeshes
        .filter((mesh) => mesh.layer === "bones" && mesh.anatomyBone === channel.bone)
        .map((mesh) => mesh.id))
    : undefined;
  const resolved = resolveChannelStartPointPatientRas(channel, { eligibleSurfaceMeshIds });
  return resolved
    ? { point: resolved.pointPatientRasMm, source: resolved.source }
    : null;
}

function signedDistanceToPlane(point: Vector3, plane: AnatomicReferencePlane): number {
  return dot3(
    sub3(toVec3(point), toVec3(plane.originPatientRasMm)),
    toVec3(plane.normalPatientRas),
  );
}

function unevaluatedTrajectory(
  channel: ChannelPlan,
  reason: string,
): ChannelTrajectoryAngleMeasurement {
  return {
    evaluationState: "not_evaluated",
    channelId: channel.id,
    channelLabel: channel.label,
    bone: channel.bone,
    sagittalToTibialPlateauDeg: null,
    coronalToTibialPlateauDeg: null,
    axialToPosteriorCondylarDeg: null,
    referenceFrameVersion: ANATOMIC_REFERENCE_FRAME_VERSION,
    provisional: true,
    reason,
  };
}

function projectedAcuteAngleDeg(
  direction: Vec3,
  referenceAxis: Vec3,
  perpendicularAxis: Vec3,
): number | null {
  const parallelComponent = Math.abs(dot3(direction, referenceAxis));
  const perpendicularComponent = Math.abs(dot3(direction, perpendicularAxis));
  if (Math.hypot(parallelComponent, perpendicularComponent) <= TRAJECTORY_PROJECTION_EPSILON) {
    return null;
  }
  return Math.atan2(perpendicularComponent, parallelComponent) * 180 / Math.PI;
}

/**
 * Reports the planned drilled axis against the same patient-RAS anatomical
 * frame used by the Start-point readout. Angles are line angles (0–90°), not
 * directed vectors, because the stored inward axis and an exterior anchor rod
 * point in opposite directions while representing the same trajectory.
 */
export function measureChannelTrajectoryAngles(
  channel: ChannelPlan,
  frame: AnatomicReferenceFrame,
): ChannelTrajectoryAngleMeasurement {
  if (
    channel.noLargeTunnel ||
    channel.geometryType === "onlay_no_large_tunnel" ||
    resolvedTrajectoryControlMode(channel) === "none"
  ) {
    return unevaluatedTrajectory(channel, "This fixation point has no drilled trajectory.");
  }
  if (frame.evaluationState !== "evaluated") {
    return unevaluatedTrajectory(channel, frame.reason);
  }

  const axis = resolvedChannelAxis(channel);
  if (!axis) {
    return unevaluatedTrajectory(channel, "The selected channel has no finite rendered trajectory.");
  }

  try {
    const direction = normalize3(axis.inwardUnit, "channel trajectory");
    const superior = normalize3(toVec3(frame.jointLine.normalPatientRas), "joint-line normal");
    const anterior = normalize3(
      toVec3(frame.posteriorCondylar.normalPatientRas),
      "posterior-condylar plane normal",
    );
    const lateral = normalize3(toVec3(frame.midline.normalPatientRas), "midline normal");
    if (
      Math.abs(dot3(superior, anterior)) > FRAME_ORTHOGONALITY_TOLERANCE ||
      Math.abs(dot3(superior, lateral)) > FRAME_ORTHOGONALITY_TOLERANCE ||
      Math.abs(dot3(anterior, lateral)) > FRAME_ORTHOGONALITY_TOLERANCE
    ) {
      return unevaluatedTrajectory(channel, "The anatomical reference axes are not orthogonal.");
    }

    return {
      evaluationState: "evaluated",
      channelId: channel.id,
      channelLabel: channel.label,
      bone: channel.bone,
      // In the sagittal plane, anterior is the tibial-plateau axis and
      // superior is its perpendicular. Thus 90° is perpendicular as requested.
      sagittalToTibialPlateauDeg: projectedAcuteAngleDeg(direction, anterior, superior),
      // In the coronal plane, lateral is the tibial-plateau axis.
      coronalToTibialPlateauDeg: projectedAcuteAngleDeg(direction, lateral, superior),
      // In the axial plane, lateral is the posterior-condylar line direction.
      axialToPosteriorCondylarDeg: projectedAcuteAngleDeg(direction, lateral, anterior),
      referenceFrameVersion: ANATOMIC_REFERENCE_FRAME_VERSION,
      provisional: !frame.scaleVerified || !frame.lateralityVerified,
      reason: null,
    };
  } catch {
    return unevaluatedTrajectory(channel, "The anatomical reference axes are invalid.");
  }
}

export function measureChannelStartPoint(
  channel: ChannelPlan,
  frame: AnatomicReferenceFrame,
  anatomyMeshes?: ViewerMeshPayload[],
): ChannelStartPointMeasurement {
  const resolved = channelStartPointPatientRas(channel, anatomyMeshes);
  const base = {
    channelId: channel.id,
    channelLabel: channel.label,
    bone: channel.bone,
    pointPatientRasMm: resolved?.point ?? null,
    pointSource: resolved?.source ?? null,
  };
  if (channel.bone !== "femur" && channel.bone !== "tibia") {
    return {
      ...base,
      evaluationState: "not_evaluated",
      jointLineSignedMm: null,
      midlineSignedMm: null,
      midlineUnsignedMm: null,
      posteriorCondylarSignedMm: null,
      lateralityVerified: false,
      scaleVerified: false,
      provisional: true,
      reason: "This knee reference frame reports femur and tibia Start points only.",
    };
  }
  if (!resolved) {
    return {
      ...base,
      evaluationState: "not_evaluated",
      jointLineSignedMm: null,
      midlineSignedMm: null,
      midlineUnsignedMm: null,
      posteriorCondylarSignedMm: null,
      lateralityVerified: false,
      scaleVerified: false,
      provisional: true,
      reason: "The selected channel has no finite rendered Start point.",
    };
  }
  if (frame.evaluationState !== "evaluated") {
    return {
      ...base,
      evaluationState: "not_evaluated",
      jointLineSignedMm: null,
      midlineSignedMm: null,
      midlineUnsignedMm: null,
      posteriorCondylarSignedMm: null,
      lateralityVerified: false,
      scaleVerified: false,
      provisional: true,
      reason: frame.reason,
    };
  }

  const midlineDistance = signedDistanceToPlane(resolved.point, frame.midline);
  const medialLateralDirectionAvailable = frame.lateralityVerified ||
    frame.jointLineDefinition.medialLateralAssignment === "dicom_metadata_provisional";
  return {
    ...base,
    evaluationState: "evaluated",
    jointLineSignedMm: signedDistanceToPlane(resolved.point, frame.jointLine),
    midlineSignedMm: medialLateralDirectionAvailable ? midlineDistance : null,
    midlineUnsignedMm: Math.abs(midlineDistance),
    posteriorCondylarSignedMm: signedDistanceToPlane(resolved.point, frame.posteriorCondylar),
    lateralityVerified: frame.lateralityVerified,
    scaleVerified: frame.scaleVerified,
    provisional: !frame.scaleVerified || !frame.lateralityVerified,
    reason: null,
  };
}
