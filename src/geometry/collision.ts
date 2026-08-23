import { stableHash } from "./hash";
import {
  GEOMETRY_EPSILON,
  add3,
  closestPointsBetweenSegments,
  deterministicPerpendicular,
  normalize3,
  scale3,
  sub3,
  type Segment3,
  type Vec3,
} from "./mesh";
import type { AnalyticPrimitive, GeometryLayerType } from "./recipes";

export type AnalysisStatus =
  | "conflict"
  | "below_threshold"
  | "clear"
  | "intentional_shared"
  | "not_evaluated";

export type EvaluationState =
  | "evaluated"
  | "missing_dimensions"
  | "missing_geometry"
  | "missing_anatomy";

/** Structural geometry input: callers do not need to import the domain model. */
export interface CollisionGeometry {
  id: string;
  geometryHash: string;
  complete: boolean;
  missingDimensions: readonly string[];
  layers: ReadonlyArray<{
    id: string;
    type: GeometryLayerType;
    analyzable: boolean;
    primitives: readonly AnalyticPrimitive[];
  }>;
}

export interface IntentionalRelationship {
  id?: string;
  objectAId: string;
  objectBId: string;
  kind: "shared" | "coalesced";
  rationale: string;
}

export interface ClearanceOptions {
  thresholdMm?: number;
  thresholdSource?: "user" | "institution" | "informational";
  includeSafetyMargins?: boolean;
  includedLayerTypes?: readonly GeometryLayerType[];
  intentionalRelationship?: IntentionalRelationship;
  intentionalRelationships?: readonly IntentionalRelationship[];
}

export interface ClosestVolumePoints {
  pointA: Vec3;
  pointB: Vec3;
  centerlinePointA: Vec3;
  centerlinePointB: Vec3;
}

export interface SignedPrimitiveClearance {
  signedDistanceMm: number;
  closestPoints: ClosestVolumePoints;
  primitiveAId: string;
  primitiveBId: string;
  sourceComponentA: string;
  sourceComponentB: string;
  conservative: boolean;
}

export interface AnalysisResult {
  id: string;
  objectAId: string;
  objectBId: string;
  geometryHashA: string;
  geometryHashB: string;
  cacheKey: string;
  status: AnalysisStatus;
  evaluationState: EvaluationState;
  signedClearanceMm: number | null;
  minimumClearanceMm: number | null;
  intersects: boolean | null;
  overlapDepthMm: number | null;
  closestPoints: ClosestVolumePoints | null;
  nearestPrimitiveAId: string | null;
  nearestPrimitiveBId: string | null;
  nearestLayerAId: string | null;
  nearestLayerBId: string | null;
  conservative: boolean;
  thresholdMm: number;
  thresholdSource: "user" | "institution" | "informational";
  intentionalRelationshipId?: string;
  missingRequirements: string[];
  message: string;
}

interface IndexedPrimitive {
  layerId: string;
  primitive: AnalyticPrimitive;
}

interface PairClearance extends SignedPrimitiveClearance {
  layerAId: string;
  layerBId: string;
}

export function signedPrimitiveClearance(
  primitiveA: AnalyticPrimitive,
  primitiveB: AnalyticPrimitive,
): SignedPrimitiveClearance {
  let best: SignedPrimitiveClearance | undefined;
  for (const segmentA of primitiveA.segments) {
    for (const segmentB of primitiveB.segments) {
      const candidate = signedSegmentSupportClearance(
        segmentA,
        primitiveA.supportRadiusMm,
        segmentB,
        primitiveB.supportRadiusMm,
      );
      const result: SignedPrimitiveClearance = {
        ...candidate,
        primitiveAId: primitiveA.id,
        primitiveBId: primitiveB.id,
        sourceComponentA: primitiveA.sourceComponent,
        sourceComponentB: primitiveB.sourceComponent,
        conservative:
          primitiveA.analysisMode === "conservativeSupportRadius" ||
          primitiveB.analysisMode === "conservativeSupportRadius",
      };
      if (!best || result.signedDistanceMm < best.signedDistanceMm) best = result;
    }
  }
  if (!best) throw new Error("collision primitives must contain at least one finite segment");
  return best;
}

export function signedSegmentSupportClearance(
  segmentA: Segment3,
  radiusAmm: number,
  segmentB: Segment3,
  radiusBmm: number,
): Pick<SignedPrimitiveClearance, "signedDistanceMm" | "closestPoints"> {
  if (!Number.isFinite(radiusAmm) || radiusAmm <= 0 || !Number.isFinite(radiusBmm) || radiusBmm <= 0) {
    throw new Error("support radii must be positive and finite");
  }
  const centerline = closestPointsBetweenSegments(segmentA, segmentB);
  const signedDistanceMm = centerline.distanceMm - radiusAmm - radiusBmm;
  let normal: Vec3;
  if (centerline.distanceMm > GEOMETRY_EPSILON) {
    normal = scale3(sub3(centerline.pointB, centerline.pointA), 1 / centerline.distanceMm);
  } else {
    const directionA = sub3(segmentA.end, segmentA.start);
    const directionB = sub3(segmentB.end, segmentB.start);
    const candidate = Math.hypot(directionA.x, directionA.y, directionA.z) > GEOMETRY_EPSILON
      ? directionA
      : directionB;
    normal = deterministicPerpendicular(normalize3(candidate, "coincident segment direction"));
  }
  return {
    signedDistanceMm,
    closestPoints: {
      pointA: add3(centerline.pointA, scale3(normal, radiusAmm)),
      pointB: add3(centerline.pointB, scale3(normal, -radiusBmm)),
      centerlinePointA: centerline.pointA,
      centerlinePointB: centerline.pointB,
    },
  };
}

export function analyzeClearance(
  geometryA: CollisionGeometry,
  geometryB: CollisionGeometry,
  options: ClearanceOptions = {},
): AnalysisResult {
  const thresholdMm = options.thresholdMm ?? 2;
  if (!Number.isFinite(thresholdMm) || thresholdMm < 0) {
    throw new Error("clearance threshold must be non-negative and finite");
  }
  if (geometryA.id === geometryB.id) throw new Error("clearance requires two distinct geometry ids");
  const cacheKey = analysisCacheKey(geometryA, geometryB, options);
  const resultBase = {
    id: `analysis:${stableHash([geometryA.id, geometryB.id, cacheKey])}`,
    objectAId: geometryA.id,
    objectBId: geometryB.id,
    geometryHashA: geometryA.geometryHash,
    geometryHashB: geometryB.geometryHash,
    cacheKey,
    thresholdMm,
    thresholdSource: options.thresholdSource ?? "informational",
  };

  if (!geometryA.complete || !geometryB.complete) {
    const missingRequirements = [
      ...geometryA.missingDimensions.map((value) => `${geometryA.id}:${value}`),
      ...geometryB.missingDimensions.map((value) => `${geometryB.id}:${value}`),
    ].sort();
    return {
      ...resultBase,
      status: "not_evaluated",
      evaluationState: "missing_dimensions",
      signedClearanceMm: null,
      minimumClearanceMm: null,
      intersects: null,
      overlapDepthMm: null,
      closestPoints: null,
      nearestPrimitiveAId: null,
      nearestPrimitiveBId: null,
      nearestLayerAId: null,
      nearestLayerBId: null,
      conservative: false,
      missingRequirements,
      message: `Not evaluated: geometry-critical dimensions are missing (${missingRequirements.join(", ")}).`,
    };
  }

  const primitivesA = indexPrimitives(geometryA, options);
  const primitivesB = indexPrimitives(geometryB, options);
  if (primitivesA.length === 0 || primitivesB.length === 0) {
    const missingRequirements = [
      ...(primitivesA.length === 0 ? [`${geometryA.id}:analyzableVolume`] : []),
      ...(primitivesB.length === 0 ? [`${geometryB.id}:analyzableVolume`] : []),
    ];
    return {
      ...resultBase,
      status: "not_evaluated",
      evaluationState: "missing_geometry",
      signedClearanceMm: null,
      minimumClearanceMm: null,
      intersects: null,
      overlapDepthMm: null,
      closestPoints: null,
      nearestPrimitiveAId: null,
      nearestPrimitiveBId: null,
      nearestLayerAId: null,
      nearestLayerBId: null,
      conservative: false,
      missingRequirements,
      message: "Not evaluated: one or both objects have no analyzable full-volume geometry.",
    };
  }

  let nearest: PairClearance | undefined;
  for (const indexedA of primitivesA) {
    for (const indexedB of primitivesB) {
      const primitiveResult = signedPrimitiveClearance(indexedA.primitive, indexedB.primitive);
      const candidate: PairClearance = {
        ...primitiveResult,
        layerAId: indexedA.layerId,
        layerBId: indexedB.layerId,
      };
      if (!nearest || candidate.signedDistanceMm < nearest.signedDistanceMm) nearest = candidate;
    }
  }
  if (!nearest) throw new Error("pairwise clearance unexpectedly produced no result");

  const relationship = matchingRelationship(
    geometryA.id,
    geometryB.id,
    options.intentionalRelationships ?? (options.intentionalRelationship ? [options.intentionalRelationship] : []),
  );
  const intentionalLayerTypes = new Set<GeometryLayerType>(["boneRemovalOrCompaction"]);
  const relationshipApplies = Boolean(
    relationship &&
    intentionalLayerTypes.has(geometryA.layers.find((layer) => layer.id === nearest.layerAId)?.type ?? "safetyMargin") &&
    intentionalLayerTypes.has(geometryB.layers.find((layer) => layer.id === nearest.layerBId)?.type ?? "safetyMargin"),
  );
  const intersects = nearest.signedDistanceMm <= GEOMETRY_EPSILON;
  let status: AnalysisStatus;
  if (intersects && relationshipApplies) status = "intentional_shared";
  else if (intersects) status = "conflict";
  else if (nearest.signedDistanceMm < thresholdMm) status = "below_threshold";
  else status = "clear";

  const message = analysisMessage(status, nearest.signedDistanceMm, thresholdMm, nearest, relationshipApplies ? relationship : undefined);
  return {
    ...resultBase,
    status,
    evaluationState: "evaluated",
    signedClearanceMm: nearest.signedDistanceMm,
    minimumClearanceMm: nearest.signedDistanceMm,
    intersects,
    overlapDepthMm: intersects ? Math.max(0, -nearest.signedDistanceMm) : 0,
    closestPoints: nearest.closestPoints,
    nearestPrimitiveAId: nearest.primitiveAId,
    nearestPrimitiveBId: nearest.primitiveBId,
    nearestLayerAId: nearest.layerAId,
    nearestLayerBId: nearest.layerBId,
    conservative: nearest.conservative,
    intentionalRelationshipId: relationshipApplies ? relationship?.id : undefined,
    missingRequirements: [],
    message,
  };
}

export function analysisCacheKey(
  geometryA: CollisionGeometry,
  geometryB: CollisionGeometry,
  options: ClearanceOptions = {},
): string {
  return stableHash({
    version: 1,
    geometryA: { id: geometryA.id, hash: geometryA.geometryHash },
    geometryB: { id: geometryB.id, hash: geometryB.geometryHash },
    thresholdMm: options.thresholdMm ?? 2,
    thresholdSource: options.thresholdSource ?? "informational",
    includeSafetyMargins: options.includeSafetyMargins ?? false,
    includedLayerTypes: options.includedLayerTypes ? [...options.includedLayerTypes].sort() : null,
    intentionalRelationship: options.intentionalRelationship ?? null,
    intentionalRelationships: options.intentionalRelationships
      ? [...options.intentionalRelationships].sort((left, right) => (left.id ?? "").localeCompare(right.id ?? ""))
      : null,
  });
}

/**
 * Produces an explicit non-result for a required anatomy object that was not
 * imported/segmented. This is intentionally separate from geometric clearance:
 * absent anatomy can never yield a reassuring numeric value.
 */
export function notEvaluatedForMissingAnatomy(
  geometry: CollisionGeometry,
  absentObjectId: string,
  anatomyLabel: string,
  options: Pick<ClearanceOptions, "thresholdMm" | "thresholdSource"> = {},
): AnalysisResult {
  if (!absentObjectId.trim() || !anatomyLabel.trim()) {
    throw new Error("missing anatomy id and label are required");
  }
  const thresholdMm = options.thresholdMm ?? 2;
  if (!Number.isFinite(thresholdMm) || thresholdMm < 0) {
    throw new Error("clearance threshold must be non-negative and finite");
  }
  const cacheKey = stableHash({
    version: 1,
    geometry: { id: geometry.id, hash: geometry.geometryHash },
    missingAnatomy: absentObjectId,
    thresholdMm,
    thresholdSource: options.thresholdSource ?? "informational",
  });
  return {
    id: `analysis:${stableHash([geometry.id, absentObjectId, cacheKey])}`,
    objectAId: geometry.id,
    objectBId: absentObjectId,
    geometryHashA: geometry.geometryHash,
    geometryHashB: "missing",
    cacheKey,
    status: "not_evaluated",
    evaluationState: "missing_anatomy",
    signedClearanceMm: null,
    minimumClearanceMm: null,
    intersects: null,
    overlapDepthMm: null,
    closestPoints: null,
    nearestPrimitiveAId: null,
    nearestPrimitiveBId: null,
    nearestLayerAId: null,
    nearestLayerBId: null,
    conservative: false,
    thresholdMm,
    thresholdSource: options.thresholdSource ?? "informational",
    missingRequirements: [`${absentObjectId}:${anatomyLabel}`],
    message: `Not evaluated: ${anatomyLabel} is absent or not registered.`,
  };
}

export class GeometryAnalysisCache {
  private readonly results = new Map<string, AnalysisResult>();
  private readonly keysByGeometryId = new Map<string, Set<string>>();

  get size(): number {
    return this.results.size;
  }

  analyze(
    geometryA: CollisionGeometry,
    geometryB: CollisionGeometry,
    options: ClearanceOptions = {},
  ): AnalysisResult {
    const key = analysisCacheKey(geometryA, geometryB, options);
    const cached = this.results.get(key);
    if (cached) return cached;
    const result = analyzeClearance(geometryA, geometryB, options);
    this.results.set(key, result);
    this.trackKey(geometryA.id, key);
    this.trackKey(geometryB.id, key);
    return result;
  }

  invalidateGeometry(geometryId: string): number {
    const keys = this.keysByGeometryId.get(geometryId);
    if (!keys) return 0;
    let removed = 0;
    for (const key of keys) {
      if (this.results.delete(key)) removed += 1;
      for (const [otherId, otherKeys] of this.keysByGeometryId) {
        if (otherId !== geometryId) otherKeys.delete(key);
      }
    }
    this.keysByGeometryId.delete(geometryId);
    return removed;
  }

  clear(): void {
    this.results.clear();
    this.keysByGeometryId.clear();
  }

  private trackKey(geometryId: string, key: string): void {
    const keys = this.keysByGeometryId.get(geometryId) ?? new Set<string>();
    keys.add(key);
    this.keysByGeometryId.set(geometryId, keys);
  }
}

export function analyzeAllPairs(
  geometries: readonly CollisionGeometry[],
  options: ClearanceOptions = {},
  cache = new GeometryAnalysisCache(),
): AnalysisResult[] {
  const results: AnalysisResult[] = [];
  for (let left = 0; left < geometries.length; left += 1) {
    for (let right = left + 1; right < geometries.length; right += 1) {
      results.push(cache.analyze(geometries[left], geometries[right], options));
    }
  }
  return results;
}

function indexPrimitives(geometry: CollisionGeometry, options: ClearanceOptions): IndexedPrimitive[] {
  const includedTypes = options.includedLayerTypes ? new Set(options.includedLayerTypes) : undefined;
  return geometry.layers.flatMap((layer) => {
    if (!layer.analyzable) return [];
    if (!options.includeSafetyMargins && layer.type === "safetyMargin") return [];
    if (includedTypes && !includedTypes.has(layer.type)) return [];
    return layer.primitives.map((primitive) => ({ layerId: layer.id, primitive }));
  });
}

function matchingRelationship(
  objectAId: string,
  objectBId: string,
  relationships: readonly IntentionalRelationship[],
): IntentionalRelationship | undefined {
  return relationships.find((relationship) => {
    if (!relationship.rationale.trim()) return false;
    const direct = relationship.objectAId === objectAId && relationship.objectBId === objectBId;
    const reverse = relationship.objectAId === objectBId && relationship.objectBId === objectAId;
    return direct || reverse;
  });
}

function analysisMessage(
  status: AnalysisStatus,
  distanceMm: number,
  thresholdMm: number,
  nearest: PairClearance,
  relationship: IntentionalRelationship | undefined,
): string {
  const qualifier = nearest.conservative ? " Conservative support-radius evaluation." : "";
  switch (status) {
    case "intentional_shared":
      return `Intentional ${relationship?.kind ?? "shared"} overlap (${formatMm(distanceMm)} signed clearance): ${relationship?.rationale}.${qualifier}`;
    case "conflict":
      return `Full volumes overlap or contact (${formatMm(distanceMm)} signed clearance) between ${nearest.sourceComponentA} and ${nearest.sourceComponentB}.${qualifier}`;
    case "below_threshold":
      return `Clearance ${formatMm(distanceMm)} is below the informational ${formatMm(thresholdMm)} threshold.${qualifier}`;
    case "clear":
      return `Clearance ${formatMm(distanceMm)} is at or above the informational ${formatMm(thresholdMm)} threshold.${qualifier}`;
    case "not_evaluated":
      return "Not evaluated.";
  }
}

function formatMm(value: number): string {
  return `${value.toFixed(2)} mm`;
}
