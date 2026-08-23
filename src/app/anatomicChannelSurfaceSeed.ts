import type {
  Bone,
  ChannelPlan,
  PlanCase,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import {
  deriveAnatomicReferenceFrame,
  type EvaluatedAnatomicReferenceFrame,
} from "../geometry/anatomicReferencePlanes";
import type { ViewerMeshPayload } from "../viewer/types";

const EPSILON = 1e-9;

export const ANATOMY_DERIVED_SURFACE_SEED_WARNING =
  "The initial surface location and trajectory were derived from the loaded bone surfaces and provisional medial/lateral reference axes. This is an editable visual starting point, not an anatomic recommendation; confirm knee laterality and placement.";

interface SurfaceSample {
  point: Vector3;
  normal: Vector3;
  stableKey: string;
}

interface BoneSampleSet {
  samples: SurfaceSample[];
  centroid: Vector3;
  lateralRange: readonly [number, number];
  anteriorRange: readonly [number, number];
  superiorRange: readonly [number, number];
}

export interface AnatomicChannelSeedContext {
  frame: EvaluatedAnatomicReferenceFrame;
  /** DICOM/import-declared side used to orient the seed; clinician verification remains separate. */
  laterality: PlanCase["laterality"];
  lateralityVerified: boolean;
  samplesByBone: ReadonlyMap<Bone, BoneSampleSet>;
}

export interface AnatomicChannelSurfaceSeed {
  requestedPointPatientRasMm: Vector3;
  preferredDirectionPatientRas: Vector3;
  ruleId:
    | "acl_femoral_lateral_notch_wall"
    | "pcl_femoral_medial_notch_wall"
    | "lateral_extra_articular_surface"
    | "medial_extra_articular_surface"
    | "cruciate_tibial_plateau"
    | "root_tibial_plateau"
    | "plc_posterolateral_surface";
}

export interface PlanAnatomicReferenceFrameOptions {
  laterality: "left" | "right" | "unverified";
  lateralityVerified: boolean;
  scaleVerified: boolean;
  provisionalLateralitySource?: "dicom_metadata";
}

type PlanLateralityContext = Pick<
  PlanCase,
  "laterality" | "lateralityVerified" | "scaleVerified"
> & {
  imaging: Pick<PlanCase["imaging"], "lateralityHint" | "segmentationRuns">;
};

interface SeedRule {
  ruleId: AnatomicChannelSurfaceSeed["ruleId"];
  lateral01: number;
  anterior01: number;
  superior01: number;
  lateralRange01: readonly [number, number];
  anteriorRange01: readonly [number, number];
  superiorRange01: readonly [number, number];
  midlineSide: "lateral" | "medial" | null;
  normalDirection: Vector3;
  trajectoryDirection?: Vector3;
}

function tuple(value: readonly number[]): Vector3 {
  return [value[0], value[1], value[2]];
}

function add(left: Vector3, right: Vector3): Vector3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(value: Vector3, factor: number): Vector3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalized(value: Vector3): Vector3 | null {
  const magnitude = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(magnitude) || magnitude <= EPSILON) return null;
  return [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude];
}

function average(points: readonly Vector3[]): Vector3 | null {
  if (!points.length) return null;
  const sum = points.reduce<Vector3>((total, point) => add(total, point), [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

function finitePoint(value: readonly number[] | undefined): value is Vector3 {
  return value?.length === 3 && value.every(Number.isFinite);
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function robustRange(values: number[]): readonly [number, number] | null {
  if (!values.length) return null;
  values.sort((left, right) => left - right);
  const minimum = quantile(values, 0.01);
  const maximum = quantile(values, 0.99);
  return maximum - minimum > EPSILON ? [minimum, maximum] : null;
}

function normalizedCoordinate(value: number, range: readonly [number, number]): number {
  return (value - range[0]) / (range[1] - range[0]);
}

function surfaceSamplesForBone(
  bone: Bone,
  meshes: readonly ViewerMeshPayload[],
  frame: EvaluatedAnatomicReferenceFrame,
): BoneSampleSet | null {
  const boneMeshes = meshes.filter((mesh) => mesh.anatomyBone === bone);
  const allVertices = boneMeshes.flatMap((mesh) => mesh.vertices
    .filter(finitePoint)
    .map(tuple));
  const centroid = average(allVertices);
  if (!centroid) return null;

  const samples: SurfaceSample[] = [];
  for (const mesh of boneMeshes) {
    const vertices = mesh.vertices.map((point) => finitePoint(point) ? tuple(point) : null);
    const meshCentroid = average(vertices.filter((point): point is Vector3 => point !== null));
    if (!meshCentroid) continue;
    const normalSums = vertices.map<Vector3>(() => [0, 0, 0]);
    for (const face of mesh.faces) {
      if (face.length !== 3) continue;
      const a = vertices[face[0]];
      const b = vertices[face[1]];
      const c = vertices[face[2]];
      if (!a || !b || !c) continue;
      const faceCenter = scale(add(add(a, b), c), 1 / 3);
      let faceNormal = normalized(cross(subtract(b, a), subtract(c, a)));
      if (!faceNormal) continue;
      // Imported winding is not assumed. Orient every face away from its own
      // connected display object before accumulating deterministic vertex normals.
      if (dot(faceNormal, subtract(faceCenter, meshCentroid)) < 0) {
        faceNormal = scale(faceNormal, -1);
      }
      for (const vertexIndex of face) {
        normalSums[vertexIndex] = add(normalSums[vertexIndex], faceNormal);
      }
    }
    vertices.forEach((point, vertexIndex) => {
      if (!point) return;
      const fallbackNormal = normalized(subtract(point, meshCentroid));
      const normal = normalized(normalSums[vertexIndex]) ?? fallbackNormal;
      if (!normal) return;
      samples.push({
        point,
        normal,
        stableKey: `${mesh.id}:vertex:${vertexIndex}`,
      });
    });
  }
  if (!samples.length) return null;

  const lateral = tuple(frame.midline.normalPatientRas);
  const anterior = tuple(frame.posteriorCondylar.normalPatientRas);
  const superior = tuple(frame.jointLine.normalPatientRas);
  const lateralRange = robustRange(samples.map((sample) => dot(sample.point, lateral)));
  const anteriorRange = robustRange(samples.map((sample) => dot(sample.point, anterior)));
  const superiorRange = robustRange(samples.map((sample) => dot(sample.point, superior)));
  if (!lateralRange || !anteriorRange || !superiorRange) return null;
  return { samples, centroid, lateralRange, anteriorRange, superiorRange };
}

/**
 * Builds an orientation-aware seed context from patient-space surfaces.
 *
 * The declared DICOM/import side is used even before clinician verification so
 * a left knee mirrors correctly instead of silently falling back to patient
 * right. Verification state is retained separately and no reviewed landmark or
 * clinical recommendation is inferred from this presentation-only default.
 */
export function resolvedDicomLateralityHint(
  plan: Pick<PlanLateralityContext, "laterality" | "imaging">,
): PlanCase["laterality"] | null {
  const latestRun = [...plan.imaging.segmentationRuns]
    .sort((left, right) => left.generatedAt.localeCompare(right.generatedAt))
    .at(-1);
  const hint = plan.imaging.lateralityHint ?? latestRun?.lateralityHint;
  return hint?.status === "resolved" && hint.laterality === plan.laterality
    ? hint.laterality
    : null;
}

/** Shared options keep Viewer measurements and new-channel seeds side-consistent. */
export function anatomicReferenceFrameOptionsForPlan(
  plan: PlanLateralityContext,
): PlanAnatomicReferenceFrameOptions {
  const hasDicomHint = !plan.lateralityVerified && resolvedDicomLateralityHint(plan) !== null;
  return {
    laterality: plan.laterality,
    lateralityVerified: plan.lateralityVerified,
    scaleVerified: plan.scaleVerified,
    ...(hasDicomHint ? { provisionalLateralitySource: "dicom_metadata" as const } : {}),
  };
}

export function createAnatomicChannelSeedContext(
  plan: PlanLateralityContext,
  meshes: readonly ViewerMeshPayload[],
): AnatomicChannelSeedContext | null {
  const frame = deriveAnatomicReferenceFrame(meshes, anatomicReferenceFrameOptionsForPlan(plan));
  if (frame.evaluationState !== "evaluated") return null;
  const samplesByBone = new Map<Bone, BoneSampleSet>();
  for (const bone of ["femur", "tibia", "fibula"] as const) {
    const samples = surfaceSamplesForBone(bone, meshes, frame);
    if (samples) samplesByBone.set(bone, samples);
  }
  return {
    frame,
    laterality: plan.laterality,
    lateralityVerified: plan.lateralityVerified,
    samplesByBone,
  };
}

function axes(context: AnatomicChannelSeedContext): {
  lateral: Vector3;
  anterior: Vector3;
  superior: Vector3;
} {
  return {
    lateral: tuple(context.frame.midline.normalPatientRas),
    anterior: tuple(context.frame.posteriorCondylar.normalPatientRas),
    superior: tuple(context.frame.jointLine.normalPatientRas),
  };
}

function combineDirections(...terms: readonly [Vector3, number][]): Vector3 {
  const sum = terms.reduce<Vector3>(
    (value, [axis, weight]) => add(value, scale(axis, weight)),
    [0, 0, 0],
  );
  return normalized(sum) ?? [0, 0, 1];
}

function semanticOffset(channel: ChannelPlan): { lateral: number; anterior: number } {
  const semantic = `${channel.semanticKey ?? ""} ${channel.label}`;
  if (/(?:^|[\s-])AM(?:$|[\s-])/i.test(semantic)) return { lateral: 0, anterior: 0.045 };
  if (/(?:^|[\s-])PL(?:$|[\s-])/i.test(semantic)) return { lateral: 0.025, anterior: -0.045 };
  if (/(?:^|[\s-])AL(?:$|[\s-])/i.test(semantic)) return { lateral: 0.025, anterior: 0.045 };
  if (/(?:^|[\s-])PM(?:$|[\s-])/i.test(semantic)) return { lateral: -0.025, anterior: -0.045 };
  const ordinal = /(?:^|[\s-])(\d+)(?:$|[\s-])/i.exec(semantic)?.[1];
  if (!ordinal) return { lateral: 0, anterior: 0 };
  const index = Math.max(1, Number.parseInt(ordinal, 10));
  return { lateral: 0, anterior: Math.max(-0.08, Math.min(0.08, (index - 1.5) * 0.06)) };
}

function rootIsAnterior(channel: ChannelPlan): boolean {
  return /(?:^|[\s-])anterior(?:$|[\s-])/i.test(`${channel.semanticKey ?? ""} ${channel.label}`);
}

function seedRule(
  context: AnatomicChannelSeedContext,
  channel: ChannelPlan,
  procedure: ProcedureIdentity | null,
): SeedRule | null {
  const { lateral, anterior, superior } = axes(context);
  const medial = scale(lateral, -1);
  const posterior = scale(anterior, -1);
  const inferior = scale(superior, -1);
  const offset = semanticOffset(channel);

  if (channel.bone === "femur" && procedure === "ACL") {
    return {
      ruleId: "acl_femoral_lateral_notch_wall",
      lateral01: 0.56 + offset.lateral,
      anterior01: 0.46 + offset.anterior,
      superior01: 0.17,
      lateralRange01: [0.5, 0.76],
      anteriorRange01: [0.2, 0.72],
      superiorRange01: [0.04, 0.34],
      midlineSide: "lateral",
      normalDirection: medial,
      trajectoryDirection: lateral,
    };
  }
  if (channel.bone === "femur" && procedure === "PCL") {
    return {
      ruleId: "pcl_femoral_medial_notch_wall",
      lateral01: 0.44 + offset.lateral,
      anterior01: 0.4 + offset.anterior,
      superior01: 0.17,
      lateralRange01: [0.24, 0.5],
      anteriorRange01: [0.16, 0.7],
      superiorRange01: [0.04, 0.34],
      midlineSide: "medial",
      normalDirection: lateral,
      trajectoryDirection: medial,
    };
  }
  if (channel.bone === "tibia" && (procedure === "ACL" || procedure === "PCL")) {
    const isAcl = procedure === "ACL";
    return {
      ruleId: "cruciate_tibial_plateau",
      lateral01: (isAcl ? 0.52 : 0.45) + offset.lateral,
      anterior01: (isAcl ? 0.64 : 0.22) + offset.anterior,
      superior01: 0.98,
      lateralRange01: isAcl ? [0.35, 0.7] : [0.25, 0.62],
      anteriorRange01: isAcl ? [0.45, 0.84] : [0.04, 0.45],
      superiorRange01: [0.86, 1.04],
      midlineSide: null,
      normalDirection: superior,
      trajectoryDirection: combineDirections([medial, 0.22], [anterior, 0.48], [inferior, 1]),
    };
  }
  if (channel.bone === "tibia" && (procedure === "MEDIAL_ROOT" || procedure === "LATERAL_ROOT")) {
    const isMedial = procedure === "MEDIAL_ROOT";
    return {
      ruleId: "root_tibial_plateau",
      lateral01: (isMedial ? 0.24 : 0.76) + offset.lateral,
      anterior01: (rootIsAnterior(channel) ? 0.66 : 0.28) + offset.anterior,
      superior01: 0.98,
      lateralRange01: isMedial ? [0.06, 0.43] : [0.57, 0.94],
      anteriorRange01: rootIsAnterior(channel) ? [0.46, 0.88] : [0.08, 0.5],
      superiorRange01: [0.86, 1.04],
      midlineSide: isMedial ? "medial" : "lateral",
      normalDirection: superior,
      trajectoryDirection: combineDirections(
        [isMedial ? medial : lateral, 0.18],
        [anterior, 0.5],
        [inferior, 1],
      ),
    };
  }
  if (procedure === "MCL_POL_PMC" && (channel.bone === "femur" || channel.bone === "tibia")) {
    return {
      ruleId: "medial_extra_articular_surface",
      lateral01: 0.055,
      anterior01: 0.52 + offset.anterior,
      superior01: channel.bone === "femur" ? 0.2 : 0.82,
      lateralRange01: [0, 0.2],
      anteriorRange01: [0.25, 0.78],
      superiorRange01: channel.bone === "femur" ? [0.06, 0.4] : [0.62, 0.96],
      midlineSide: "medial",
      normalDirection: medial,
    };
  }
  if (
    (procedure === "ALL" || procedure === "LET" || procedure === "PLC_FCL") &&
    (channel.bone === "femur" || channel.bone === "tibia" || channel.bone === "fibula")
  ) {
    const isPlc = procedure === "PLC_FCL";
    const posteriorStructure = isPlc && /poplite|posterior|tibia/i.test(`${channel.semanticKey ?? ""} ${channel.label}`);
    const isTibialPlc = isPlc && channel.bone === "tibia";
    return {
      ruleId: isTibialPlc ? "plc_posterolateral_surface" : "lateral_extra_articular_surface",
      lateral01: channel.bone === "fibula" ? 0.91 : 0.945,
      anterior01: (posteriorStructure ? 0.2 : 0.53) + offset.anterior,
      superior01: channel.bone === "femur" ? (procedure === "LET" ? 0.25 : 0.2)
        : channel.bone === "fibula" ? 0.82 : 0.8,
      lateralRange01: [0.8, 1],
      anteriorRange01: posteriorStructure ? [0, 0.46] : [0.26, 0.8],
      superiorRange01: channel.bone === "femur" ? [0.06, 0.42] : [0.6, 0.98],
      midlineSide: "lateral",
      normalDirection: posteriorStructure
        ? combineDirections([lateral, 0.75], [posterior, 0.65])
        : lateral,
      // The LaPrade-style tibial channel begins on the posterolateral surface
      // and traverses mainly anteriorly, keeping its exterior Start on the
      // lateral side instead of crossing toward the medial cortex.
      trajectoryDirection: isTibialPlc
        ? combineDirections([anterior, 1], [medial, 0.18], [inferior, 0.08])
        : undefined,
    };
  }
  return null;
}

function inside(value: number, range: readonly [number, number]): boolean {
  return value >= range[0] - EPSILON && value <= range[1] + EPSILON;
}

function selectedSurfaceSample(
  sampleSet: BoneSampleSet,
  frame: EvaluatedAnatomicReferenceFrame,
  rule: SeedRule,
): SurfaceSample | null {
  const lateralAxis = tuple(frame.midline.normalPatientRas);
  const anteriorAxis = tuple(frame.posteriorCondylar.normalPatientRas);
  const superiorAxis = tuple(frame.jointLine.normalPatientRas);
  const midlineOrigin = tuple(frame.midline.originPatientRasMm);
  let best: { sample: SurfaceSample; score: number } | null = null;
  for (const sample of sampleSet.samples) {
    const lateral01 = normalizedCoordinate(dot(sample.point, lateralAxis), sampleSet.lateralRange);
    const anterior01 = normalizedCoordinate(dot(sample.point, anteriorAxis), sampleSet.anteriorRange);
    const superior01 = normalizedCoordinate(dot(sample.point, superiorAxis), sampleSet.superiorRange);
    const midlineSignedMm = dot(subtract(sample.point, midlineOrigin), lateralAxis);
    if (
      !inside(lateral01, rule.lateralRange01) ||
      !inside(anterior01, rule.anteriorRange01) ||
      !inside(superior01, rule.superiorRange01)
    ) continue;
    if (
      (rule.midlineSide === "lateral" && midlineSignedMm <= EPSILON) ||
      (rule.midlineSide === "medial" && midlineSignedMm >= -EPSILON)
    ) continue;
    const normalAlignment = dot(sample.normal, rule.normalDirection);
    // A location on the correct half but facing the wrong surface (for example
    // the outer face rather than the ACL notch wall) is not an acceptable seed.
    if (normalAlignment < 0.18) continue;
    const score =
      (lateral01 - rule.lateral01) ** 2 * 5 +
      (anterior01 - rule.anterior01) ** 2 * 1.8 +
      (superior01 - rule.superior01) ** 2 * 2.8 +
      (1 - normalAlignment) ** 2 * 3;
    if (
      best === null ||
      score < best.score - EPSILON ||
      (Math.abs(score - best.score) <= EPSILON && sample.stableKey.localeCompare(best.sample.stableKey) < 0)
    ) {
      best = { sample, score };
    }
  }
  return best?.sample ?? null;
}

/**
 * Returns an editable, surface-derived ballpark seed for a new channel.
 * Existing/default-applied and clinician-edited geometry must never call this
 * function; the integration gate lives in channelSurfaceInitialization.
 */
export function anatomicChannelSurfaceSeed(
  context: AnatomicChannelSeedContext,
  channel: ChannelPlan,
  procedure: ProcedureIdentity | null,
): AnatomicChannelSurfaceSeed | null {
  const sampleSet = context.samplesByBone.get(channel.bone);
  const rule = seedRule(context, channel, procedure);
  if (!sampleSet || !rule) return null;
  const sample = selectedSurfaceSample(sampleSet, context.frame, rule);
  if (!sample) return null;
  const inward = normalized(subtract(sampleSet.centroid, sample.point));
  const direction = normalized(rule.trajectoryDirection ?? inward ?? scale(sample.normal, -1));
  if (!direction) return null;
  return {
    requestedPointPatientRasMm: sample.point,
    preferredDirectionPatientRas: direction,
    ruleId: rule.ruleId,
  };
}
