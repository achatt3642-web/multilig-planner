/**
 * Small, dependency-free patient-space geometry kernel.
 *
 * Coordinates and all lengths are millimetres. Meshes are deterministic display
 * artifacts; analytic collision primitives remain authoritative for analysis.
 */

export const GEOMETRY_EPSILON = 1e-9;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Segment3 {
  start: Vec3;
  end: Vec3;
}

export interface Aabb3 {
  min: Vec3;
  max: Vec3;
}

export interface TriangleMesh {
  /** Flat xyz patient-space coordinates in millimetres. */
  positions: number[];
  /** Counter-clockwise triangle vertex indices. */
  indices: number[];
  bounds: Aabb3;
}

export type ProfileDefinition =
  | { kind: "ellipse"; widthMm: number; heightMm: number; segments?: number }
  | { kind: "stadium"; widthMm: number; heightMm: number; segments?: number }
  | { kind: "rectangle"; widthMm: number; heightMm: number }
  | {
      kind: "roundedRectangle";
      widthMm: number;
      heightMm: number;
      cornerRadiusMm: number;
      segmentsPerCorner?: number;
    }
  | {
      kind: "cProfile";
      outerRadiusMm: number;
      innerRadiusMm: number;
      gapAngleDeg: number;
      segments?: number;
    }
  | { kind: "slot"; lengthMm: number; widthMm: number; segments?: number }
  | { kind: "ribbon"; widthMm: number; thicknessMm: number; cornerRadiusMm?: number }
  | { kind: "polygon"; points: Vec2[] }
  | { kind: "importedProfile"; points: Vec2[]; sourceId: string };

export interface ResolvedProfile {
  kind: ProfileDefinition["kind"];
  points: Vec2[];
  supportRadiusMm: number;
  areaMm2: number;
}

export interface SegmentClosestPoints {
  pointA: Vec3;
  pointB: Vec3;
  parameterA: number;
  parameterB: number;
  distanceMm: number;
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });
export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add3 = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub3 = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale3 = (value: Vec3, scalar: number): Vec3 =>
  vec3(value.x * scalar, value.y * scalar, value.z * scalar);

export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross3 = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const lengthSquared3 = (value: Vec3): number => dot3(value, value);
export const length3 = (value: Vec3): number => Math.sqrt(lengthSquared3(value));
export const distance3 = (a: Vec3, b: Vec3): number => length3(sub3(a, b));

export function normalize3(value: Vec3, label = "vector"): Vec3 {
  const magnitude = length3(value);
  if (!Number.isFinite(magnitude) || magnitude <= GEOMETRY_EPSILON) {
    throw new Error(`${label} must have non-zero finite length`);
  }
  return scale3(value, 1 / magnitude);
}

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 =>
  add3(a, scale3(sub3(b, a), t));

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function assertPositive(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value <= 0) throw new Error(`${label} must be greater than zero`);
}

export function assertNonNegative(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) throw new Error(`${label} must be zero or greater`);
}

export function segmentLength(segment: Segment3): number {
  return distance3(segment.start, segment.end);
}

export function segmentFromDirection(start: Vec3, direction: Vec3, lengthMm: number): Segment3 {
  assertPositive(lengthMm, "segment length");
  return { start, end: add3(start, scale3(normalize3(direction, "segment direction"), lengthMm)) };
}

export function extendSegmentEnd(segment: Segment3, extensionMm: number): Segment3 {
  assertNonNegative(extensionMm, "segment extension");
  if (extensionMm === 0) return { start: { ...segment.start }, end: { ...segment.end } };
  const direction = normalize3(sub3(segment.end, segment.start), "segment");
  return { start: { ...segment.start }, end: add3(segment.end, scale3(direction, extensionMm)) };
}

export function closestPointsBetweenSegments(a: Segment3, b: Segment3): SegmentClosestPoints {
  // Ericson, Real-Time Collision Detection, finite-segment form with explicit
  // handling for degenerate segments.
  const d1 = sub3(a.end, a.start);
  const d2 = sub3(b.end, b.start);
  const r = sub3(a.start, b.start);
  const aa = dot3(d1, d1);
  const ee = dot3(d2, d2);
  const ff = dot3(d2, r);
  let s: number;
  let t: number;

  if (aa <= GEOMETRY_EPSILON && ee <= GEOMETRY_EPSILON) {
    s = 0;
    t = 0;
  } else if (aa <= GEOMETRY_EPSILON) {
    s = 0;
    t = clamp(ff / ee, 0, 1);
  } else {
    const cc = dot3(d1, r);
    if (ee <= GEOMETRY_EPSILON) {
      t = 0;
      s = clamp(-cc / aa, 0, 1);
    } else {
      const bb = dot3(d1, d2);
      const denominator = aa * ee - bb * bb;
      s = Math.abs(denominator) > GEOMETRY_EPSILON
        ? clamp((bb * ff - cc * ee) / denominator, 0, 1)
        : 0;
      t = (bb * s + ff) / ee;
      if (t < 0) {
        t = 0;
        s = clamp(-cc / aa, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((bb - cc) / aa, 0, 1);
      }
    }
  }

  const pointA = lerp3(a.start, a.end, s);
  const pointB = lerp3(b.start, b.end, t);
  return { pointA, pointB, parameterA: s, parameterB: t, distanceMm: distance3(pointA, pointB) };
}

export function deterministicPerpendicular(direction: Vec3): Vec3 {
  const unit = normalize3(direction, "direction");
  const reference = Math.abs(unit.x) <= Math.abs(unit.y) && Math.abs(unit.x) <= Math.abs(unit.z)
    ? vec3(1, 0, 0)
    : Math.abs(unit.y) <= Math.abs(unit.z)
      ? vec3(0, 1, 0)
      : vec3(0, 0, 1);
  return normalize3(cross3(unit, reference), "perpendicular");
}

export function profileArea(points: Vec2[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

export function profileSupportRadius(points: Vec2[]): number {
  return Math.max(...points.map((point) => Math.hypot(point.x, point.y)));
}

export function resolveProfile(definition: ProfileDefinition): ResolvedProfile {
  let points: Vec2[];
  switch (definition.kind) {
    case "ellipse": {
      assertPositive(definition.widthMm, "ellipse width");
      assertPositive(definition.heightMm, "ellipse height");
      const segments = normalizedSegments(definition.segments, 32, 12);
      points = Array.from({ length: segments }, (_, index) => {
        const angle = (index / segments) * Math.PI * 2;
        return vec2(Math.cos(angle) * definition.widthMm / 2, Math.sin(angle) * definition.heightMm / 2);
      });
      break;
    }
    case "stadium":
      points = stadiumPoints(definition.widthMm, definition.heightMm, definition.segments);
      break;
    case "rectangle":
      points = rectanglePoints(definition.widthMm, definition.heightMm);
      break;
    case "roundedRectangle":
      points = roundedRectanglePoints(
        definition.widthMm,
        definition.heightMm,
        definition.cornerRadiusMm,
        definition.segmentsPerCorner,
      );
      break;
    case "cProfile":
      points = cProfilePoints(definition);
      break;
    case "slot":
      points = stadiumPoints(definition.lengthMm, definition.widthMm, definition.segments);
      break;
    case "ribbon": {
      const radius = definition.cornerRadiusMm ?? Math.min(definition.widthMm, definition.thicknessMm) * 0.15;
      points = radius > GEOMETRY_EPSILON
        ? roundedRectanglePoints(definition.widthMm, definition.thicknessMm, radius, 4)
        : rectanglePoints(definition.widthMm, definition.thicknessMm);
      break;
    }
    case "polygon":
    case "importedProfile":
      points = sanitizePolygon(definition.points, definition.kind);
      break;
  }

  const signedArea = profileArea(points);
  if (Math.abs(signedArea) <= GEOMETRY_EPSILON) throw new Error(`${definition.kind} profile has zero area`);
  if (signedArea < 0) points.reverse();
  return {
    kind: definition.kind,
    points,
    supportRadiusMm: profileSupportRadius(points),
    areaMm2: Math.abs(profileArea(points)),
  };
}

function rectanglePoints(widthMm: number, heightMm: number): Vec2[] {
  assertPositive(widthMm, "rectangle width");
  assertPositive(heightMm, "rectangle height");
  const x = widthMm / 2;
  const y = heightMm / 2;
  return [vec2(-x, -y), vec2(x, -y), vec2(x, y), vec2(-x, y)];
}

function roundedRectanglePoints(
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
  segmentsPerCorner = 5,
): Vec2[] {
  assertPositive(widthMm, "rounded rectangle width");
  assertPositive(heightMm, "rounded rectangle height");
  assertNonNegative(cornerRadiusMm, "corner radius");
  if (cornerRadiusMm > Math.min(widthMm, heightMm) / 2 + GEOMETRY_EPSILON) {
    throw new Error("corner radius exceeds half the shortest side");
  }
  if (cornerRadiusMm <= GEOMETRY_EPSILON) return rectanglePoints(widthMm, heightMm);
  const count = normalizedSegments(segmentsPerCorner, 5, 1);
  const cx = widthMm / 2 - cornerRadiusMm;
  const cy = heightMm / 2 - cornerRadiusMm;
  const centers = [vec2(cx, cy), vec2(-cx, cy), vec2(-cx, -cy), vec2(cx, -cy)];
  const starts = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  const points: Vec2[] = [];
  for (let corner = 0; corner < centers.length; corner += 1) {
    for (let step = 0; step <= count; step += 1) {
      const angle = starts[corner] + (step / count) * Math.PI / 2;
      points.push(vec2(
        centers[corner].x + Math.cos(angle) * cornerRadiusMm,
        centers[corner].y + Math.sin(angle) * cornerRadiusMm,
      ));
    }
  }
  return points;
}

function stadiumPoints(widthMm: number, heightMm: number, requestedSegments?: number): Vec2[] {
  assertPositive(widthMm, "stadium width");
  assertPositive(heightMm, "stadium height");
  if (Math.abs(widthMm - heightMm) <= GEOMETRY_EPSILON) {
    return resolveProfile({ kind: "ellipse", widthMm, heightMm, segments: requestedSegments }).points;
  }
  if (heightMm > widthMm) {
    return stadiumPoints(heightMm, widthMm, requestedSegments).map((point) => vec2(-point.y, point.x));
  }
  const segments = normalizedSegments(requestedSegments, 16, 8);
  const halfArcSegments = Math.max(4, Math.floor(segments / 2));
  const radius = heightMm / 2;
  const centerOffset = (widthMm - heightMm) / 2;
  const points: Vec2[] = [];
  for (let index = 0; index <= halfArcSegments; index += 1) {
    const angle = -Math.PI / 2 + (index / halfArcSegments) * Math.PI;
    points.push(vec2(centerOffset + Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  for (let index = 0; index <= halfArcSegments; index += 1) {
    const angle = Math.PI / 2 + (index / halfArcSegments) * Math.PI;
    points.push(vec2(-centerOffset + Math.cos(angle) * radius, Math.sin(angle) * radius));
  }
  return points;
}

function cProfilePoints(definition: Extract<ProfileDefinition, { kind: "cProfile" }>): Vec2[] {
  assertPositive(definition.outerRadiusMm, "C-profile outer radius");
  assertPositive(definition.innerRadiusMm, "C-profile inner radius");
  if (definition.innerRadiusMm >= definition.outerRadiusMm) {
    throw new Error("C-profile inner radius must be smaller than outer radius");
  }
  assertPositive(definition.gapAngleDeg, "C-profile gap angle");
  if (definition.gapAngleDeg >= 360) throw new Error("C-profile gap angle must be below 360 degrees");
  const segments = normalizedSegments(definition.segments, 28, 8);
  const gap = definition.gapAngleDeg * Math.PI / 180;
  const startAngle = gap / 2;
  const endAngle = Math.PI * 2 - gap / 2;
  const outer: Vec2[] = [];
  const inner: Vec2[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const angle = startAngle + (index / segments) * (endAngle - startAngle);
    outer.push(vec2(Math.cos(angle) * definition.outerRadiusMm, Math.sin(angle) * definition.outerRadiusMm));
  }
  for (let index = segments; index >= 0; index -= 1) {
    const angle = startAngle + (index / segments) * (endAngle - startAngle);
    inner.push(vec2(Math.cos(angle) * definition.innerRadiusMm, Math.sin(angle) * definition.innerRadiusMm));
  }
  return [...outer, ...inner];
}

function sanitizePolygon(points: Vec2[], label: string): Vec2[] {
  const result: Vec2[] = [];
  for (const point of points) {
    assertFiniteNumber(point.x, `${label} x`);
    assertFiniteNumber(point.y, `${label} y`);
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > GEOMETRY_EPSILON) {
      result.push({ ...point });
    }
  }
  if (result.length > 1) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= GEOMETRY_EPSILON) result.pop();
  }
  if (result.length < 3) throw new Error(`${label} needs at least three distinct points`);
  return result;
}

function normalizedSegments(requested: number | undefined, fallback: number, minimum: number): number {
  const value = requested ?? fallback;
  assertFiniteNumber(value, "segment count");
  return Math.max(minimum, Math.floor(value));
}

interface OrthonormalBasis {
  axis: Vec3;
  u: Vec3;
  v: Vec3;
}

export function basisForSegment(segment: Segment3, orientationDeg = 0): OrthonormalBasis {
  const axis = normalize3(sub3(segment.end, segment.start), "extrusion axis");
  let u = deterministicPerpendicular(axis);
  let v = normalize3(cross3(axis, u), "basis");
  if (orientationDeg !== 0) {
    assertFiniteNumber(orientationDeg, "orientation");
    const radians = orientationDeg * Math.PI / 180;
    const rotatedU = add3(scale3(u, Math.cos(radians)), scale3(v, Math.sin(radians)));
    const rotatedV = add3(scale3(u, -Math.sin(radians)), scale3(v, Math.cos(radians)));
    u = rotatedU;
    v = rotatedV;
  }
  return { axis, u, v };
}

function profilePointInPatientSpace(
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  point: Vec2,
  angleRadians: number,
): Vec3 {
  const x = point.x * Math.cos(angleRadians) - point.y * Math.sin(angleRadians);
  const y = point.x * Math.sin(angleRadians) + point.y * Math.cos(angleRadians);
  return add3(origin, add3(scale3(u, x), scale3(v, y)));
}

export function createExtrusionMesh(
  profile: ResolvedProfile | ProfileDefinition,
  segment: Segment3,
  orientationDeg = 0,
  twistDeg = 0,
): TriangleMesh {
  if (segmentLength(segment) <= GEOMETRY_EPSILON) throw new Error("extrusion segment must have length");
  assertFiniteNumber(twistDeg, "twist");
  const resolved = "supportRadiusMm" in profile ? profile : resolveProfile(profile);
  const basis = basisForSegment(segment, orientationDeg);
  const positions: number[] = [];
  for (const point of resolved.points) {
    pushVec3(positions, profilePointInPatientSpace(segment.start, basis.u, basis.v, point, 0));
  }
  const twistRadians = twistDeg * Math.PI / 180;
  for (const point of resolved.points) {
    pushVec3(positions, profilePointInPatientSpace(segment.end, basis.u, basis.v, point, twistRadians));
  }
  const count = resolved.points.length;
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
  }
  const capTriangles = triangulatePolygon(resolved.points);
  for (const [a, b, c] of capTriangles) {
    indices.push(c, b, a);
    indices.push(count + a, count + b, count + c);
  }
  return finalizeMesh(positions, indices);
}

export function createCylinderMesh(
  segment: Segment3,
  radiusMm: number,
  radialSegments = 24,
): TriangleMesh {
  assertPositive(radiusMm, "cylinder radius");
  return createExtrusionMesh(
    { kind: "ellipse", widthMm: radiusMm * 2, heightMm: radiusMm * 2, segments: radialSegments },
    segment,
  );
}

export function createPolylineTubeMesh(points: Vec3[], radiusMm: number, radialSegments = 16): TriangleMesh {
  assertPositive(radiusMm, "tube radius");
  if (points.length < 2) throw new Error("polyline tube needs at least two points");
  const meshes: TriangleMesh[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (distance3(points[index], points[index + 1]) > GEOMETRY_EPSILON) {
      meshes.push(createCylinderMesh({ start: points[index], end: points[index + 1] }, radiusMm, radialSegments));
    }
  }
  if (meshes.length === 0) throw new Error("polyline tube needs distinct points");
  return mergeMeshes(meshes);
}

export function createAnnulusMesh(
  segment: Segment3,
  innerRadiusMm: number,
  outerRadiusMm: number,
  radialSegments = 32,
): TriangleMesh {
  assertNonNegative(innerRadiusMm, "annulus inner radius");
  assertPositive(outerRadiusMm, "annulus outer radius");
  if (innerRadiusMm >= outerRadiusMm) throw new Error("annulus inner radius must be smaller than outer radius");
  const count = normalizedSegments(radialSegments, 32, 12);
  const basis = basisForSegment(segment);
  const positions: number[] = [];
  for (const origin of [segment.start, segment.end]) {
    for (const radius of [outerRadiusMm, innerRadiusMm]) {
      for (let index = 0; index < count; index += 1) {
        const angle = index / count * Math.PI * 2;
        pushVec3(positions, add3(origin, add3(
          scale3(basis.u, Math.cos(angle) * radius),
          scale3(basis.v, Math.sin(angle) * radius),
        )));
      }
    }
  }
  const startOuter = 0;
  const startInner = count;
  const endOuter = count * 2;
  const endInner = count * 3;
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(startOuter + index, startOuter + next, endOuter + next);
    indices.push(startOuter + index, endOuter + next, endOuter + index);
    indices.push(startInner + index, endInner + next, startInner + next);
    indices.push(startInner + index, endInner + index, endInner + next);
    indices.push(startOuter + next, startOuter + index, startInner + index);
    indices.push(startOuter + next, startInner + index, startInner + next);
    indices.push(endOuter + index, endOuter + next, endInner + next);
    indices.push(endOuter + index, endInner + next, endInner + index);
  }
  return finalizeMesh(positions, indices);
}

export function createFrustumMesh(
  segment: Segment3,
  startRadiusMm: number,
  endRadiusMm: number,
  radialSegments = 24,
): TriangleMesh {
  assertPositive(startRadiusMm, "frustum start radius");
  assertPositive(endRadiusMm, "frustum end radius");
  const count = normalizedSegments(radialSegments, 24, 8);
  const basis = basisForSegment(segment);
  const positions: number[] = [];
  for (const [origin, radius] of [[segment.start, startRadiusMm], [segment.end, endRadiusMm]] as const) {
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * Math.PI * 2;
      pushVec3(positions, add3(origin, add3(
        scale3(basis.u, Math.cos(angle) * radius),
        scale3(basis.v, Math.sin(angle) * radius),
      )));
    }
  }
  const indices: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    indices.push(index, next, count + next, index, count + next, count + index);
  }
  for (let index = 1; index < count - 1; index += 1) {
    indices.push(0, index + 1, index);
    indices.push(count, count + index, count + index + 1);
  }
  return finalizeMesh(positions, indices);
}

export function mergeMeshes(meshes: TriangleMesh[]): TriangleMesh {
  if (meshes.length === 0) return emptyMesh();
  const positions: number[] = [];
  const indices: number[] = [];
  for (const mesh of meshes) {
    const offset = positions.length / 3;
    positions.push(...mesh.positions);
    indices.push(...mesh.indices.map((index) => index + offset));
  }
  return finalizeMesh(positions, indices);
}

export function emptyMesh(): TriangleMesh {
  return {
    positions: [],
    indices: [],
    bounds: { min: vec3(0, 0, 0), max: vec3(0, 0, 0) },
  };
}

function pushVec3(target: number[], value: Vec3): void {
  target.push(value.x, value.y, value.z);
}

function finalizeMesh(positions: number[], indices: number[]): TriangleMesh {
  if (positions.length % 3 !== 0) throw new Error("mesh positions must be xyz triples");
  if (indices.length % 3 !== 0) throw new Error("mesh indices must be triangles");
  if (positions.length === 0) return emptyMesh();
  const min = vec3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = vec3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (let index = 0; index < positions.length; index += 3) {
    min.x = Math.min(min.x, positions[index]);
    min.y = Math.min(min.y, positions[index + 1]);
    min.z = Math.min(min.z, positions[index + 2]);
    max.x = Math.max(max.x, positions[index]);
    max.y = Math.max(max.y, positions[index + 1]);
    max.z = Math.max(max.z, positions[index + 2]);
  }
  return { positions, indices, bounds: { min, max } };
}

function triangulatePolygon(points: Vec2[]): Array<[number, number, number]> {
  // Deterministic ear clipping supports concave C and imported profiles.
  const remaining = points.map((_, index) => index);
  const triangles: Array<[number, number, number]> = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard > 0) {
    let earFound = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previousIndex = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const currentIndex = remaining[cursor];
      const nextIndex = remaining[(cursor + 1) % remaining.length];
      const previous = points[previousIndex];
      const current = points[currentIndex];
      const next = points[nextIndex];
      if (cross2(previous, current, next) <= GEOMETRY_EPSILON) continue;
      let containsPoint = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        if (pointInTriangle(points[candidateIndex], previous, current, next)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;
      triangles.push([previousIndex, currentIndex, nextIndex]);
      remaining.splice(cursor, 1);
      earFound = true;
      break;
    }
    if (!earFound) break;
    guard -= 1;
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  if (triangles.length !== points.length - 2) {
    throw new Error("profile must be a simple non-self-intersecting polygon");
  }
  return triangles;
}

function cross2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const ab = cross2(a, b, point);
  const bc = cross2(b, c, point);
  const ca = cross2(c, a, point);
  return ab >= -GEOMETRY_EPSILON && bc >= -GEOMETRY_EPSILON && ca >= -GEOMETRY_EPSILON;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
