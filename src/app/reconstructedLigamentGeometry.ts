import type {
  ChannelPlan,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import {
  add3,
  cross3,
  deterministicPerpendicular,
  distance3,
  dot3,
  normalize3,
  scale3,
  sub3,
  type Vec3,
} from "../geometry/mesh";
import {
  closestMeshSurfaceContact,
  meshPointContainment,
} from "../geometry/surfaceClearance";
import type {
  ViewerLabelPayload,
  ViewerMeshPayload,
} from "../viewer/types";
import {
  resolvedChannelAxis,
  resolvedChannelDiameterMm,
  type ResolvedChannelAxis,
} from "./resolvedChannelGeometry";

const PATH_SEGMENTS = 28;
const CRUCIATE_ROUTE_STEP_MM = 0.5;
const RADIAL_SEGMENTS = 36;
const FIBER_COUNT = 4;
const MIN_ATTACHMENT_SEPARATION_MM = 4;
const MIN_CENTERLINE_STEP_MM = 1e-4;
const SURFACE_ROUTE_STEP_MM = 0.22;
// Candidate clearance is sampled approximately every 1.1 mm. The half-step
// margin makes the continuous curve conservative between adjacent samples.
const SURFACE_ROUTE_SAMPLING_MARGIN_MM = 0.6;
// This is presentation geometry, not a clearance result. The patient mask is
// voxel-derived and visibly faceted, so permit about one display voxel of
// cortical overlap instead of deforming the graft cross-section around each
// triangle. The tube itself always remains circular and constant-radius.
const SURFACE_DISPLAY_OVERLAP_TOLERANCE_MM = 0.9;
// The first/last graft segment represents tissue entering the fixation site.
// A slightly larger terminal allowance preserves the authored attachment on a
// stair-stepped mask without flattening or tapering the tube.
const SURFACE_DISPLAY_TERMINAL_OVERLAP_TOLERANCE_MM = 2.3;
const SURFACE_TERMINAL_VALIDATION_FRACTION = 0.35;
const SURFACE_ROUTE_MIN_SEGMENTS = 160;
const SURFACE_ROUTE_MAX_SEGMENTS = 2_048;
// Repeated handle drags produce unique routes. Keep only the most recent
// plans so presentation meshes cannot retain hundreds of megabytes.
const SURFACE_ROUTE_CACHE_LIMIT = 24;

const GRAFT_COLORS = [
  "#f2ccd8",
  "#f6dce4",
  "#fbecef",
] as const;

const centroidByVertices = new WeakMap<object, Vec3 | null>();
const boundsByVertices = new WeakMap<object, { min: Vec3; max: Vec3 } | null>();
const surfaceObjectIds = new WeakMap<object, number>();
const surfaceRouteCache = new Map<string, Vec3[]>();
const surfaceLigamentMeshCache = new Map<string, LigamentMeshGeometry>();
let nextSurfaceObjectId = 1;

interface AttachedEndpoint {
  channel: ChannelPlan;
  point: Vec3;
  outwardNormal: Vec3 | null;
}

interface LigamentSpan {
  procedureId: string;
  procedure: ProcedureIdentity;
  bundleKey: string;
  label: string;
  proximal: AttachedEndpoint;
  distal: AttachedEndpoint;
}

interface LigamentMeshGeometry {
  vertices: number[][];
  faces: number[][];
  midpoint: Vector3;
  fiberPaths: [number, number, number][][];
  unavailableReason: string | null;
}

export type ReconstructedLigamentBundleRole = "AM" | "PL" | "AL" | "PM";

export interface ReconstructedLigamentDescriptor {
  id: string;
  visibilityKey: string;
  procedureId: string;
  procedure: ProcedureIdentity;
  bundleKey: string;
  bundleRole: ReconstructedLigamentBundleRole | null;
  label: string;
  channelIds: readonly [string, string];
  rendered: boolean;
  unavailableReason: string | null;
}

export interface ReconstructedLigamentPayloads {
  meshes: ViewerMeshPayload[];
  labels: ViewerLabelPayload[];
  grafts: ReconstructedLigamentDescriptor[];
}

interface LigamentCenterline {
  centers: Vec3[];
  labelPoint: Vec3;
}

function finiteVector(value: readonly number[]): value is Vector3 {
  return value.length === 3 && value.every(Number.isFinite);
}

function toVec3(value: Vector3): Vec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

function toTuple(value: Vec3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizedOrNull(value: Vec3, label: string): Vec3 | null {
  try {
    return normalize3(value, label);
  } catch {
    return null;
  }
}

function meshCentroid(mesh: ViewerMeshPayload): Vec3 | null {
  const cacheKey = mesh.vertices as object;
  if (centroidByVertices.has(cacheKey)) return centroidByVertices.get(cacheKey) ?? null;
  let count = 0;
  const total = { x: 0, y: 0, z: 0 };
  for (const vertex of mesh.vertices) {
    if (!finiteVector(vertex)) continue;
    total.x += vertex[0];
    total.y += vertex[1];
    total.z += vertex[2];
    count += 1;
  }
  const centroid = count ? scale3(total, 1 / count) : null;
  centroidByVertices.set(cacheKey, centroid);
  return centroid;
}

function meshBounds(mesh: ViewerMeshPayload): { min: Vec3; max: Vec3 } | null {
  const cacheKey = mesh.vertices as object;
  if (boundsByVertices.has(cacheKey)) return boundsByVertices.get(cacheKey) ?? null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let count = 0;
  mesh.vertices.forEach((vertex) => {
    if (!finiteVector(vertex)) return;
    min.x = Math.min(min.x, vertex[0]);
    min.y = Math.min(min.y, vertex[1]);
    min.z = Math.min(min.z, vertex[2]);
    max.x = Math.max(max.x, vertex[0]);
    max.y = Math.max(max.y, vertex[1]);
    max.z = Math.max(max.z, vertex[2]);
    count += 1;
  });
  const bounds = count ? { min, max } : null;
  boundsByVertices.set(cacheKey, bounds);
  return bounds;
}

function pointDefinitelyOutsideMeshBounds(
  point: Vec3,
  mesh: ViewerMeshPayload,
  paddingMm = SURFACE_DISPLAY_OVERLAP_TOLERANCE_MM,
): boolean {
  const bounds = meshBounds(mesh);
  if (!bounds) return false;
  return point.x < bounds.min.x - paddingMm ||
    point.x > bounds.max.x + paddingMm ||
    point.y < bounds.min.y - paddingMm ||
    point.y > bounds.max.y + paddingMm ||
    point.z < bounds.min.z - paddingMm ||
    point.z > bounds.max.z + paddingMm;
}

function surfaceObjectId(value: object): number {
  const existing = surfaceObjectIds.get(value);
  if (existing !== undefined) return existing;
  const id = nextSurfaceObjectId;
  nextSurfaceObjectId += 1;
  surfaceObjectIds.set(value, id);
  return id;
}

function surfaceRouteKey(
  span: LigamentSpan,
  radiusMm: number,
  meshes: readonly ViewerMeshPayload[],
): string {
  const endpointKey = [span.proximal, span.distal].map((endpoint) => [
    endpoint.point.x,
    endpoint.point.y,
    endpoint.point.z,
    endpoint.outwardNormal?.x ?? "none",
    endpoint.outwardNormal?.y ?? "none",
    endpoint.outwardNormal?.z ?? "none",
  ].join(",")).join("|");
  const meshKey = meshes.map((mesh) => [
    mesh.id,
    surfaceObjectId(mesh.vertices as object),
    surfaceObjectId(mesh.faces as object),
  ].join(":")).sort().join("|");
  return `surface-route-v24:${span.procedure}:${radiusMm}:${endpointKey}:${meshKey}`;
}

function rememberSurfaceRoute(key: string, centers: Vec3[]): Vec3[] {
  if (surfaceRouteCache.size >= SURFACE_ROUTE_CACHE_LIMIT) {
    const oldest = surfaceRouteCache.keys().next().value as string | undefined;
    if (oldest) surfaceRouteCache.delete(oldest);
  }
  surfaceRouteCache.set(key, centers);
  return centers;
}

function endpointOutwardNormal(
  channel: ChannelPlan,
  point: Vec3,
  mesh: ViewerMeshPayload,
  centroidByMeshId: Map<string, Vec3 | null>,
): Vec3 | null {
  const attachmentNormal = channel.apertureSurfaceAttachment?.surfaceNormalPatientRas;
  const storedNormal = attachmentNormal && finiteVector(attachmentNormal)
    ? normalizedOrNull(toVec3(attachmentNormal), "attachment surface normal")
    : null;
  if (!centroidByMeshId.has(mesh.id)) centroidByMeshId.set(mesh.id, meshCentroid(mesh));
  const centroid = centroidByMeshId.get(mesh.id) ?? null;
  const radial = centroid
    ? normalizedOrNull(sub3(point, centroid), "outward surface direction")
    : null;
  if (!storedNormal) return radial;
  if (!radial || dot3(storedNormal, radial) >= 0) return storedNormal;
  // Imported triangle winding is not assumed to be consistent. Use the bone
  // centroid only to orient the persisted local face normal outward.
  return scale3(storedNormal, -1);
}

function attachedEndpoint(
  channel: ChannelPlan,
  anatomyMeshes: readonly ViewerMeshPayload[],
  centroidByMeshId: Map<string, Vec3 | null>,
): AttachedEndpoint | null {
  const attachment = channel.apertureSurfaceAttachment;
  if (
    !attachment ||
    attachment.coordinateSpace !== "patient_ras" ||
    attachment.units !== "mm" ||
    attachment.bone !== channel.bone ||
    !finiteVector(channel.aperture) ||
    !finiteVector(attachment.attachedPointPatientRasMm)
  ) return null;

  const currentSurface = anatomyMeshes.find((mesh) =>
    mesh.layer === "bones" &&
    mesh.id === attachment.meshId &&
    mesh.anatomyBone === channel.bone,
  );
  if (!currentSurface) return null;

  // The analytic aperture is authoritative. A stale attachment from a prior
  // image/mesh must not create a plausible-looking reconstructed graft.
  if (distance3(toVec3(channel.aperture), toVec3(attachment.attachedPointPatientRasMm)) > 1e-3) {
    return null;
  }
  const point = toVec3(channel.aperture);
  return {
    channel,
    point,
    outwardNormal: endpointOutwardNormal(channel, point, currentSurface, centroidByMeshId),
  };
}

function sorted(endpoints: AttachedEndpoint[]): AttachedEndpoint[] {
  return [...endpoints].sort((left, right) =>
    left.channel.label.localeCompare(right.channel.label) ||
    left.channel.id.localeCompare(right.channel.id),
  );
}

function bundleRole(channel: ChannelPlan): ReconstructedLigamentBundleRole | null {
  const value = `${channel.semanticKey ?? ""} ${channel.label}`.toUpperCase();
  const role = value.match(/(?:^|[\s-])(AM|PL|AL|PM)(?:[\s-]|$)/)?.[1];
  return role === "AM" || role === "PL" || role === "AL" || role === "PM" ? role : null;
}

function pairFanOrIndex(
  proximal: AttachedEndpoint[],
  distal: AttachedEndpoint[],
  labelPrefix: string,
): Array<{ proximal: AttachedEndpoint; distal: AttachedEndpoint; bundleKey: string; label: string }> {
  const first = sorted(proximal);
  const second = sorted(distal);
  if (first.length === 0 || second.length === 0) return [];
  if (first.length === 1 && second.length === 1) {
    return [{ proximal: first[0], distal: second[0], bundleKey: "single", label: `${labelPrefix} graft` }];
  }
  if (first.length === 1) {
    return second.map((endpoint, index) => ({
      proximal: first[0],
      distal: endpoint,
      bundleKey: `bundle-${index + 1}`,
      label: `${labelPrefix} graft · bundle ${index + 1}`,
    }));
  }
  if (second.length === 1) {
    return first.map((endpoint, index) => ({
      proximal: endpoint,
      distal: second[0],
      bundleKey: `bundle-${index + 1}`,
      label: `${labelPrefix} graft · bundle ${index + 1}`,
    }));
  }
  return first.slice(0, Math.min(first.length, second.length)).map((endpoint, index) => ({
    proximal: endpoint,
    distal: second[index],
    bundleKey: `bundle-${index + 1}`,
    label: `${labelPrefix} graft · bundle ${index + 1}`,
  }));
}

function cruciatePairs(
  procedure: "ACL" | "PCL",
  femoral: AttachedEndpoint[],
  tibial: AttachedEndpoint[],
): Array<{ proximal: AttachedEndpoint; distal: AttachedEndpoint; bundleKey: string; label: string }> {
  if (femoral.length === 0 || tibial.length === 0) return [];
  const roles = procedure === "ACL" ? ["AM", "PL"] : ["AL", "PM"];
  const pairedByRole = roles.flatMap((role) => {
    const proximal = sorted(femoral.filter((endpoint) => bundleRole(endpoint.channel) === role));
    const distal = sorted(tibial.filter((endpoint) => bundleRole(endpoint.channel) === role));
    return proximal.length && distal.length
      ? [{
          proximal: proximal[0],
          distal: distal[0],
          bundleKey: role.toLowerCase(),
          label: `${procedure} reconstructed graft · ${role} bundle`,
        }]
      : [];
  });
  if (pairedByRole.length > 0) return pairedByRole;

  // A single fixation point may intentionally collect two bundles (for
  // example, a clinician-selected PCL tibial onlay). Fan only when one side is
  // unambiguous; otherwise do not guess cross-bundle correspondence.
  if (femoral.length === 1 || tibial.length === 1) {
    return pairFanOrIndex(femoral, tibial, `${procedure} reconstructed`);
  }
  const noRoles = [...femoral, ...tibial].every((endpoint) => bundleRole(endpoint.channel) === null);
  return noRoles && femoral.length === tibial.length
    ? pairFanOrIndex(femoral, tibial, `${procedure} reconstructed`)
    : [];
}

function resolvedSpanBundleRole(span: LigamentSpan): ReconstructedLigamentBundleRole | null {
  const allowedRoles: readonly ReconstructedLigamentBundleRole[] = span.procedure === "ACL"
    ? ["AM", "PL"]
    : span.procedure === "PCL"
      ? ["AL", "PM"]
      : [];
  const uniqueRoles = [...new Set([
    bundleRole(span.proximal.channel),
    bundleRole(span.distal.channel),
  ].filter((role): role is ReconstructedLigamentBundleRole =>
    role !== null && allowedRoles.includes(role)))];
  return uniqueRoles.length === 1 ? uniqueRoles[0] : null;
}

function procedureLabel(procedure: ProcedureIdentity): string {
  switch (procedure) {
    case "MCL_POL_PMC": return "MCL";
    case "PLC_FCL": return "PLC";
    case "MEDIAL_ROOT": return "Medial root";
    case "LATERAL_ROOT": return "Lateral root";
    default: return procedure;
  }
}

function spansForProcedure(
  procedureId: string,
  procedure: ProcedureIdentity,
  endpoints: AttachedEndpoint[],
): LigamentSpan[] {
  const femoral = endpoints.filter((endpoint) => endpoint.channel.bone === "femur");
  const tibial = endpoints.filter((endpoint) => endpoint.channel.bone === "tibia");
  let pairs: Array<{ proximal: AttachedEndpoint; distal: AttachedEndpoint; bundleKey: string; label: string }> = [];
  switch (procedure) {
    case "ACL":
    case "PCL":
      pairs = cruciatePairs(procedure, femoral, tibial);
      break;
    case "MCL_POL_PMC":
    case "ALL":
    case "PLC_FCL":
      pairs = pairFanOrIndex(femoral, tibial, `${procedureLabel(procedure)} reconstructed`);
      break;
    // A root or LET plan currently defines only one reconstructed attachment.
    // Rendering a second end would invent anatomy that the clinician did not
    // place. These begin rendering automatically once a future plan contains
    // a valid paired attachment.
    case "LET":
    case "MEDIAL_ROOT":
    case "LATERAL_ROOT":
    case "CUSTOM":
      break;
  }
  return pairs
    .filter(({ proximal, distal }) => distance3(proximal.point, distal.point) >= MIN_ATTACHMENT_SEPARATION_MM)
    .map((pair) => ({ procedureId, procedure, ...pair }));
}

function graftRadiusMm(span: LigamentSpan): number {
  const channels = [span.proximal.channel, span.distal.channel];
  const measuredGraftDiameters = channels.flatMap((channel) => {
    const graftDiameter = channel.graft?.diameterMm;
    return graftDiameter !== null && graftDiameter !== undefined && Number.isFinite(graftDiameter) && graftDiameter > 0
      ? [graftDiameter]
      : [];
  });
  // A clinician-entered graft diameter is physical geometry, not a stylistic
  // width. Never shrink it to make an incompatible socket preview look valid.
  if (measuredGraftDiameters.length) return Math.max(...measuredGraftDiameters) / 2;

  const diameters = channels.flatMap((channel) => {
    // Anchor pilot and point-only fixation diameters describe bone/device
    // preparation, not tissue width. Using them here made reconstructed
    // extra-articular grafts look like thin guide wires.
    if (channel.geometryType === "anchor_pilot" || channel.noLargeTunnel) return [];
    const diameter = resolvedChannelDiameterMm(channel);
    return diameter !== null && Number.isFinite(diameter) && diameter > 0 ? [diameter] : [];
  });
  const fallbackDiameter = span.procedure === "ACL" || span.procedure === "PCL" ? 8 : 5;
  const diameter = diameters.length ? Math.min(...diameters) : fallbackDiameter;
  return Math.max(1.3, Math.min(4.5, diameter * 0.43));
}

function cubicBezier(
  start: Vec3,
  controlA: Vec3,
  controlB: Vec3,
  end: Vec3,
  t: number,
): Vec3 {
  const inverse = 1 - t;
  return add3(
    add3(scale3(start, inverse ** 3), scale3(controlA, 3 * inverse ** 2 * t)),
    add3(scale3(controlB, 3 * inverse * t ** 2), scale3(end, t ** 3)),
  );
}

function quinticHermite(
  start: Vec3,
  startDerivative: Vec3,
  end: Vec3,
  endDerivative: Vec3,
  t: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const startPositionBasis = 1 - 10 * t3 + 15 * t4 - 6 * t5;
  const startDerivativeBasis = t - 6 * t3 + 8 * t4 - 3 * t5;
  const endPositionBasis = 10 * t3 - 15 * t4 + 6 * t5;
  const endDerivativeBasis = -4 * t3 + 7 * t4 - 3 * t5;
  // Endpoint second derivatives are explicitly zero. Together with the
  // sextic clearance envelope this produces a single C2 terminal-to-terminal
  // graft arc rather than joined straight/curved pieces.
  return add3(
    add3(
      scale3(start, startPositionBasis),
      scale3(startDerivative, startDerivativeBasis),
    ),
    add3(
      scale3(end, endPositionBasis),
      scale3(endDerivative, endDerivativeBasis),
    ),
  );
}

function tangentToward(direction: Vec3, surfaceNormal: Vec3): Vec3 | null {
  const projected = sub3(direction, scale3(surfaceNormal, dot3(direction, surfaceNormal)));
  const tangent = normalizedOrNull(projected, "surface-tangent graft direction");
  if (!tangent) return null;
  return dot3(tangent, direction) >= 0 ? tangent : scale3(tangent, -1);
}

function isSurfaceWrapped(span: LigamentSpan): boolean {
  return span.procedure === "ALL" || span.procedure === "MCL_POL_PMC" || span.procedure === "PLC_FCL";
}

function curveControls(
  span: LigamentSpan,
  start: Vec3,
  end: Vec3,
): { controlA: Vec3; controlB: Vec3 } {
  const chord = sub3(end, start);
  const length = distance3(start, end);
  if (
    isSurfaceWrapped(span) &&
    span.proximal.outwardNormal &&
    span.distal.outwardNormal
  ) {
    const startTangent = tangentToward(chord, span.proximal.outwardNormal);
    const endTangent = tangentToward(chord, span.distal.outwardNormal);
    if (startTangent && endTangent) {
      const handleLengthMm = Math.min(20, length * 0.34);
      return {
        controlA: add3(start, scale3(startTangent, handleLengthMm)),
        controlB: sub3(end, scale3(endTangent, handleLengthMm)),
      };
    }
  }
  // Intra-articular and unpaired-surface grafts remain taut. Random bend
  // directions made identical plans appear anatomically implausible.
  return {
    controlA: add3(start, scale3(chord, 1 / 3)),
    controlB: add3(start, scale3(chord, 2 / 3)),
  };
}

function wrappingMeshes(
  span: LigamentSpan,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ViewerMeshPayload[] {
  const bones = new Set([span.proximal.channel.bone, span.distal.channel.bone]);
  const byId = new Map<string, ViewerMeshPayload>();
  anatomyMeshes.forEach((mesh) => {
    if (mesh.layer === "bones" && mesh.anatomyBone && bones.has(mesh.anatomyBone)) byId.set(mesh.id, mesh);
  });
  return [...byId.values()];
}

function averagedAttachmentDirection(span: LigamentSpan): Vec3 | null {
  const start = span.proximal.outwardNormal;
  const end = span.distal.outwardNormal;
  if (!start || !end) return null;
  return normalizedOrNull(
    add3(start, end),
    "averaged attachment exterior direction",
  ) ?? start;
}

function surfaceRouteOutwardDirection(
  span: LigamentSpan,
  meshes: readonly ViewerMeshPayload[],
): Vec3 | null {
  const centroidTotal = { x: 0, y: 0, z: 0 };
  let centroidCount = 0;
  meshes.forEach((mesh) => {
    const centroid = meshCentroid(mesh);
    if (!centroid) return;
    centroidTotal.x += centroid.x;
    centroidTotal.y += centroid.y;
    centroidTotal.z += centroid.z;
    centroidCount += 1;
  });
  const attachmentMidpoint = scale3(add3(span.proximal.point, span.distal.point), 0.5);
  const chord = normalizedOrNull(sub3(span.distal.point, span.proximal.point), "graft attachment chord");
  const centroid = centroidCount ? scale3(centroidTotal, 1 / centroidCount) : null;
  const radial = centroid ? sub3(attachmentMidpoint, centroid) : null;
  const lateral = radial && chord
    ? sub3(radial, scale3(chord, dot3(radial, chord)))
    : radial;
  let direction = lateral ? normalizedOrNull(lateral, "surface route outward direction") : null;
  const attachmentDirection = averagedAttachmentDirection(span);
  direction = direction ?? attachmentDirection;
  if (!direction) return null;
  if (attachmentDirection && dot3(direction, attachmentDirection) < 0) direction = scale3(direction, -1);
  return direction;
}

function surfaceBulgeEnvelope(t: number, peakT: number): number {
  if (t <= 0 || t >= 1) return 0;
  // Reparameterize the same unit-height quartic so its peak follows the
  // patient-specific obstruction instead of always bowing at mid-span.
  // Value and first derivative remain zero at both attachments, preserving a
  // single smooth, taut arc without joined segments or local kinks.
  const denominator = (1 - peakT) * t + peakT * (1 - t);
  const u = denominator > 0 ? ((1 - peakT) * t) / denominator : t;
  return 16 * u ** 2 * (1 - u) ** 2;
}

function surfaceRouteSegmentCount(
  start: Vec3,
  end: Vec3,
  bulgeMm: number,
): number {
  const estimatedLengthMm = distance3(start, end) + bulgeMm * 2;
  return Math.max(
    SURFACE_ROUTE_MIN_SEGMENTS,
    Math.min(SURFACE_ROUTE_MAX_SEGMENTS, Math.ceil(estimatedLengthMm / SURFACE_ROUTE_STEP_MM)),
  );
}

function surfaceCurveCenters(
  start: Vec3,
  startDerivative: Vec3,
  endDerivative: Vec3,
  end: Vec3,
  exteriorDirection: Vec3,
  bulgeMm: number,
  peakT: number,
  segmentCountOverride?: number,
): Vec3[] {
  const segmentCount = segmentCountOverride ?? surfaceRouteSegmentCount(
    start,
    end,
    bulgeMm,
  );
  return Array.from({ length: segmentCount + 1 }, (_, pathIndex) => {
    const t = pathIndex / segmentCount;
    const base = quinticHermite(start, startDerivative, end, endDerivative, t);
    return add3(base, scale3(exteriorDirection, bulgeMm * surfaceBulgeEnvelope(t, peakT)));
  });
}

function surfaceClearanceDeficitPeakT(options: {
  baseCenters: readonly Vec3[];
  radiusMm: number;
  meshes: readonly ViewerMeshPayload[];
}): number {
  const { baseCenters, radiusMm, meshes } = options;
  let maximumDeficitMm = 0;
  let weightedT = 0;
  let totalWeight = 0;
  baseCenters.forEach((center, index) => {
    const t = baseCenters.length > 1 ? index / (baseCenters.length - 1) : 0.5;
    const allowedOverlapMm = displayOverlapToleranceAt(t);
    const samplingMarginMm = allowedOverlapMm === SURFACE_DISPLAY_OVERLAP_TOLERANCE_MM
      ? SURFACE_ROUTE_SAMPLING_MARGIN_MM
      : 0;
    let pointDeficitMm = 0;
    meshes.forEach((mesh) => {
      if (pointDefinitelyOutsideMeshBounds(
        center,
        mesh,
        radiusMm + allowedOverlapMm + samplingMarginMm,
      )) return;
      const contact = closestMeshSurfaceContact(center, mesh);
      if (!contact) return;
      pointDeficitMm = Math.max(
        pointDeficitMm,
        radiusMm + samplingMarginMm - allowedOverlapMm - contact.signedDistanceMm,
      );
    });
    const deficitMm = Math.max(0, pointDeficitMm);
    maximumDeficitMm = Math.max(maximumDeficitMm, deficitMm);
    const weight = deficitMm ** 2;
    weightedT += t * weight;
    totalWeight += weight;
  });
  // Avoid moving an already-clear route in response to segmentation noise.
  // The 40-60% bound keeps the arc globally taut on unfamiliar knees while
  // still allowing the clearance lift to follow a proximal/distal obstacle.
  if (maximumDeficitMm < 0.25 || totalWeight <= 1e-9) return 0.5;
  return Math.max(0.4, Math.min(0.6, weightedT / totalWeight));
}

function displayOverlapToleranceAt(t: number): number {
  return t <= SURFACE_TERMINAL_VALIDATION_FRACTION ||
    t >= 1 - SURFACE_TERMINAL_VALIDATION_FRACTION
    ? SURFACE_DISPLAY_TERMINAL_OVERLAP_TOLERANCE_MM
    : SURFACE_DISPLAY_OVERLAP_TOLERANCE_MM;
}

/**
 * Conservative center-to-surface test for a complete constant-radius tube.
 * The shortest center/surface distance bounds every circular cross-section;
 * the small negative allowance is the documented display-mask tolerance, not
 * a clinical clearance result.
 */
function surfaceTubeCenterlineClears(
  centers: readonly Vec3[],
  radiusMm: number,
  meshes: readonly ViewerMeshPayload[],
): boolean {
  if (centers.length < 2 || meshes.length === 0) return false;
  const sampleStride = Math.max(1, Math.floor(1.1 / SURFACE_ROUTE_STEP_MM));
  for (let index = 0; index < centers.length; index += sampleStride) {
    const center = centers[index];
    const t = index / (centers.length - 1);
    const allowedOverlapMm = displayOverlapToleranceAt(t);
    const samplingMarginMm = allowedOverlapMm === SURFACE_DISPLAY_OVERLAP_TOLERANCE_MM
      ? SURFACE_ROUTE_SAMPLING_MARGIN_MM
      : 0;
    for (const mesh of meshes) {
      if (pointDefinitelyOutsideMeshBounds(
        center,
        mesh,
        radiusMm + allowedOverlapMm + samplingMarginMm,
      )) continue;
      const contact = closestMeshSurfaceContact(center, mesh);
      if (!contact) return false;
      if (contact.distanceMm + allowedOverlapMm + 1e-6 < radiusMm + samplingMarginMm) return false;
    }
  }
  const end = centers.at(-1)!;
  for (const mesh of meshes) {
    if (pointDefinitelyOutsideMeshBounds(
      end,
      mesh,
      radiusMm + SURFACE_DISPLAY_TERMINAL_OVERLAP_TOLERANCE_MM,
    )) continue;
    const contact = closestMeshSurfaceContact(end, mesh);
    if (!contact || contact.distanceMm + SURFACE_DISPLAY_TERMINAL_OVERLAP_TOLERANCE_MM + 1e-6 < radiusMm) {
      return false;
    }
  }
  return true;
}

function surfaceTubeCenterlineRemainsExterior(
  centers: readonly Vec3[],
  meshes: readonly ViewerMeshPayload[],
): boolean {
  const sampleStride = Math.max(1, Math.floor(4 / SURFACE_ROUTE_STEP_MM));
  for (let index = 0; index < centers.length; index += sampleStride) {
    const point = centers[index];
    for (const mesh of meshes) {
      if (pointDefinitelyOutsideMeshBounds(point, mesh)) continue;
      if (meshPointContainment(point, mesh) === "inside") return false;
    }
  }
  const end = centers.at(-1)!;
  return meshes.every((mesh) =>
    pointDefinitelyOutsideMeshBounds(end, mesh) || meshPointContainment(end, mesh) !== "inside");
}

function surfaceTubeCandidateValid(
  centers: readonly Vec3[],
  radiusMm: number,
  meshes: readonly ViewerMeshPayload[],
): boolean {
  return surfaceTubeCenterlineClears(centers, radiusMm, meshes) &&
    surfaceTubeCenterlineRemainsExterior(centers, meshes);
}

/**
 * Finds the smallest single smooth exterior lift that clears the full tube.
 * Because the objective is minimum lift, a knee that already supports a taut
 * tangent arc receives no procedure-specific bow or hand-tuned offset.
 */
function minimumGeometryDrivenBulgeMm(options: {
  atBulge: (bulgeMm: number) => Vec3[];
  radiusMm: number;
  meshes: readonly ViewerMeshPayload[];
  maximumBulgeMm: number;
}): number | null {
  const { atBulge, radiusMm, meshes, maximumBulgeMm } = options;
  if (surfaceTubeCandidateValid(atBulge(0), radiusMm, meshes)) return 0;
  const coarseStepMm = Math.max(0.65, radiusMm * 0.4);
  let previous = 0;
  for (let candidate = coarseStepMm; candidate <= maximumBulgeMm + 1e-6; candidate += coarseStepMm) {
    const boundedCandidate = Math.min(candidate, maximumBulgeMm);
    if (!surfaceTubeCandidateValid(atBulge(boundedCandidate), radiusMm, meshes)) {
      previous = boundedCandidate;
      continue;
    }
    // Refine the first valid interval by deterministic subdivision. This does
    // not assume that validity is globally monotone on a concave bone mask.
    let lower = previous;
    let upper = boundedCandidate;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const interval = (upper - lower) / 8;
      let firstValid = upper;
      let priorSample = lower;
      for (let sampleIndex = 1; sampleIndex <= 8; sampleIndex += 1) {
        const sample = lower + interval * sampleIndex;
        if (surfaceTubeCandidateValid(atBulge(sample), radiusMm, meshes)) {
          firstValid = sample;
          break;
        }
        priorSample = sample;
      }
      lower = priorSample;
      upper = firstValid;
    }
    return upper;
  }
  return surfaceTubeCandidateValid(atBulge(maximumBulgeMm), radiusMm, meshes)
    ? maximumBulgeMm
    : null;
}

function distinctCenterlinePoints(centers: readonly Vec3[]): Vec3[] {
  const distinct: Vec3[] = [];
  centers.forEach((center) => {
    const prior = distinct.at(-1);
    if (!prior || distance3(prior, center) > MIN_CENTERLINE_STEP_MM) distinct.push(center);
  });
  if (distinct.length >= 2) return distinct;
  const first = centers[0];
  const last = centers.at(-1);
  return first && last && distance3(first, last) > MIN_CENTERLINE_STEP_MM ? [first, last] : [];
}

function resamplePolylineByArcLength(
  points: readonly Vec3[],
  targetStepMm = SURFACE_ROUTE_STEP_MM,
): Vec3[] {
  const distinct = distinctCenterlinePoints(points);
  if (distinct.length < 2) return distinct;
  const cumulative = [0];
  for (let index = 1; index < distinct.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance3(distinct[index - 1], distinct[index]));
  }
  const totalLength = cumulative.at(-1)!;
  const segmentCount = Math.max(1, Math.ceil(totalLength / targetStepMm));
  let sourceIndex = 1;
  return Array.from({ length: segmentCount + 1 }, (_, outputIndex) => {
    if (outputIndex === 0) return distinct[0];
    if (outputIndex === segmentCount) return distinct.at(-1)!;
    const distanceAlong = totalLength * outputIndex / segmentCount;
    while (sourceIndex < cumulative.length - 1 && cumulative[sourceIndex] < distanceAlong) {
      sourceIndex += 1;
    }
    const priorIndex = sourceIndex - 1;
    const interval = cumulative[sourceIndex] - cumulative[priorIndex];
    const fraction = interval > 0 ? (distanceAlong - cumulative[priorIndex]) / interval : 0;
    return add3(
      distinct[priorIndex],
      scale3(sub3(distinct[sourceIndex], distinct[priorIndex]), fraction),
    );
  });
}

function centerlineTangent(centers: readonly Vec3[], index: number): Vec3 {
  const center = centers[index];
  let before = index - 1;
  let after = index + 1;
  while (before >= 0 && distance3(centers[before], center) <= MIN_CENTERLINE_STEP_MM) before -= 1;
  while (after < centers.length && distance3(centers[after], center) <= MIN_CENTERLINE_STEP_MM) after += 1;
  const start = before >= 0 ? centers[before] : center;
  const end = after < centers.length ? centers[after] : center;
  return normalize3(sub3(end, start), "ligament tangent");
}

function surfaceWrappedCenterline(
  span: LigamentSpan,
  radiusMm: number,
  meshes: readonly ViewerMeshPayload[],
): Vec3[] {
  const cacheKey = surfaceRouteKey(span, radiusMm, meshes);
  const cached = surfaceRouteCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const startDirection = span.proximal.outwardNormal;
  const endDirection = span.distal.outwardNormal;
  if (!startDirection || !endDirection || !meshes.length) {
    return rememberSurfaceRoute(cacheKey, []);
  }
  const exteriorDirection = surfaceRouteOutwardDirection(span, meshes);
  if (!exteriorDirection) {
    return rememberSurfaceRoute(cacheKey, []);
  }
  // The centerline starts one exact graft radius outside each aperture. A
  // terminal ring therefore remains circular while its bone-facing point is
  // exactly the clinician-authored attachment. No per-vertex or local
  // obstacle relaxation is applied.
  const start = add3(span.proximal.point, scale3(startDirection, radiusMm));
  const end = add3(span.distal.point, scale3(endDirection, radiusMm));
  const { controlA, controlB } = curveControls(span, start, end);
  const startDerivative = scale3(sub3(controlA, start), 3);
  const endDerivative = scale3(sub3(end, controlB), 3);
  const chordLengthMm = distance3(start, end);
  const measurementSegmentCount = Math.max(
    64,
    Math.min(384, Math.ceil(chordLengthMm / 0.5)),
  );
  const baseCenters = surfaceCurveCenters(
    start,
    startDerivative,
    endDerivative,
    end,
    exteriorDirection,
    0,
    0.5,
    measurementSegmentCount,
  );
  const peakT = surfaceClearanceDeficitPeakT({ baseCenters, radiusMm, meshes });
  const maximumBulgeMm = Math.min(40, Math.max(radiusMm * 6, chordLengthMm * 0.34));
  // Every candidate uses one fixed sample lattice. Otherwise increasing the
  // bulge changes the sample locations and can make the validity test alias
  // between apparently valid and invalid routes.
  const validationSegmentCount = surfaceRouteSegmentCount(start, end, maximumBulgeMm);
  const atBulge = (bulgeMm: number) => surfaceCurveCenters(
    start,
    startDerivative,
    endDerivative,
    end,
    exteriorDirection,
    bulgeMm,
    peakT,
    validationSegmentCount,
  );
  const bulgeMm = minimumGeometryDrivenBulgeMm({
    atBulge,
    radiusMm,
    meshes,
    maximumBulgeMm,
  });
  if (bulgeMm === null) return rememberSurfaceRoute(cacheKey, []);
  const finalCenters = atBulge(bulgeMm);
  if (!surfaceTubeCandidateValid(finalCenters, radiusMm, meshes)) {
    return rememberSurfaceRoute(cacheKey, []);
  }
  return rememberSurfaceRoute(
    cacheKey,
    distinctCenterlinePoints(resamplePolylineByArcLength(finalCenters)),
  );
}

const CRUCIATE_GRAFT_CONDUITS = new Set<ChannelPlan["geometryType"]>([
  "antegrade_blind_socket",
  "retrograde_socket",
  "flexible_reamed_socket",
  "stepped_button_tunnel",
  "round_full_tunnel",
]);

function sampleLineInclusive(start: Vec3, end: Vec3, stepMm: number): Vec3[] {
  const lengthMm = distance3(start, end);
  if (lengthMm <= MIN_CENTERLINE_STEP_MM) return [start];
  const segments = Math.max(1, Math.ceil(lengthMm / stepMm));
  return Array.from({ length: segments + 1 }, (_, index) =>
    add3(start, scale3(sub3(end, start), index / segments)));
}

function cruciateConduitAxis(
  endpoint: AttachedEndpoint,
  radiusMm: number,
): { valid: boolean; axis: ResolvedChannelAxis | null } {
  const channel = endpoint.channel;
  if (channel.noLargeTunnel || channel.geometryType === "onlay_no_large_tunnel") {
    return { valid: true, axis: null };
  }
  if (!CRUCIATE_GRAFT_CONDUITS.has(channel.geometryType)) return { valid: false, axis: null };
  const axis = resolvedChannelAxis(channel);
  if (!axis || axis.boreDiameterMm === null || !Number.isFinite(axis.boreDiameterMm) || axis.boreDiameterMm <= 0) {
    return { valid: false, axis: null };
  }
  // Fail closed instead of shrinking a clinician-entered graft to make an
  // incompatible channel look plausible.
  if (radiusMm > axis.boreDiameterMm / 2 + 1e-6) return { valid: false, axis: null };
  return { valid: true, axis };
}

function cruciateCompositeCenterline(
  span: LigamentSpan,
  radiusMm: number,
): LigamentCenterline {
  const proximal = cruciateConduitAxis(span.proximal, radiusMm);
  const distal = cruciateConduitAxis(span.distal, radiusMm);
  const empty = { centers: [] as Vec3[], labelPoint: span.proximal.point };
  if (!proximal.valid || !distal.valid) return empty;

  const jointStart = span.proximal.point;
  const jointEnd = span.distal.point;
  const chord = sub3(jointEnd, jointStart);
  const chordLengthMm = distance3(jointStart, jointEnd);
  const chordDirection = normalizedOrNull(chord, "cruciate aperture chord");
  if (!chordDirection || chordLengthMm < MIN_ATTACHMENT_SEPARATION_MM) return empty;

  const startTangent = proximal.axis
    ? scale3(proximal.axis.inwardUnit, -1)
    : chordDirection;
  const endTangent = distal.axis
    ? distal.axis.inwardUnit
    : chordDirection;
  // An axis pointing back away from the opposite footprint would force a
  // loop at the aperture. Do not manufacture a smooth-looking graft for an
  // internally inconsistent trajectory.
  if (dot3(startTangent, chordDirection) < -0.15 || dot3(endTangent, chordDirection) < -0.15) {
    return empty;
  }

  const derivativeLengthMm = Math.min(18, chordLengthMm * 0.3);
  const jointSegments = Math.max(PATH_SEGMENTS, Math.ceil(chordLengthMm / CRUCIATE_ROUTE_STEP_MM));
  const joint = Array.from({ length: jointSegments + 1 }, (_, index) => quinticHermite(
    jointStart,
    scale3(startTangent, derivativeLengthMm),
    jointEnd,
    scale3(endTangent, derivativeLengthMm),
    index / jointSegments,
  ));
  const proximalSocket = proximal.axis
    ? sampleLineInclusive(proximal.axis.end, proximal.axis.aperture, CRUCIATE_ROUTE_STEP_MM)
    : [jointStart];
  const distalSocket = distal.axis
    ? sampleLineInclusive(distal.axis.aperture, distal.axis.end, CRUCIATE_ROUTE_STEP_MM)
    : [jointEnd];
  const centers = distinctCenterlinePoints([
    ...proximalSocket,
    ...joint.slice(1),
    ...distalSocket.slice(1),
  ]);
  return {
    centers,
    labelPoint: joint[Math.floor(joint.length / 2)],
  };
}

function ligamentCenterline(
  span: LigamentSpan,
  radiusMm: number,
  anatomyMeshes: readonly ViewerMeshPayload[],
): LigamentCenterline {
  const wrapped = isSurfaceWrapped(span);
  if (wrapped) {
    const centers = surfaceWrappedCenterline(span, radiusMm, wrappingMeshes(span, anatomyMeshes));
    return {
      centers,
      labelPoint: centers[Math.floor(centers.length / 2)] ?? span.proximal.point,
    };
  }
  if (span.procedure === "ACL" || span.procedure === "PCL") {
    return cruciateCompositeCenterline(span, radiusMm);
  }
  const segmentCount = PATH_SEGMENTS;
  const start = span.proximal.point;
  const end = span.distal.point;
  const { controlA, controlB } = curveControls(span, start, end);
  const centers = Array.from({ length: segmentCount + 1 }, (_, pathIndex) => {
    const t = pathIndex / segmentCount;
    return cubicBezier(start, controlA, controlB, end, t);
  });
  return { centers, labelPoint: centers[Math.floor(centers.length / 2)] };
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return add3(
    add3(scale3(vector, cosine), scale3(cross3(axis, vector), sine)),
    scale3(axis, dot3(axis, vector) * (1 - cosine)),
  );
}

function projectedFrameNormal(normal: Vec3, tangent: Vec3, label: string): Vec3 | null {
  return normalizedOrNull(
    sub3(normal, scale3(tangent, dot3(normal, tangent))),
    label,
  );
}

function surfaceCenterlineTangent(
  centers: readonly Vec3[],
  index: number,
  endpointNormal: Vec3 | null,
): Vec3 {
  const finiteDifference = centerlineTangent(centers, index);
  if (!endpointNormal) return finiteDifference;
  return tangentToward(finiteDifference, endpointNormal) ?? finiteDifference;
}

function surfaceFrames(
  span: LigamentSpan,
  centers: readonly Vec3[],
): Array<{ tangent: Vec3; u: Vec3; v: Vec3 }> | null {
  const startNormal = span.proximal.outwardNormal;
  const endNormal = span.distal.outwardNormal;
  if (!startNormal || !endNormal || centers.length < 2) return null;
  const tangents = centers.map((_, index) => surfaceCenterlineTangent(
    centers,
    index,
    index === 0 ? startNormal : index === centers.length - 1 ? endNormal : null,
  ));
  const startU = projectedFrameNormal(startNormal, tangents[0], "proximal graft surface frame");
  const endU = projectedFrameNormal(endNormal, tangents.at(-1)!, "distal graft surface frame");
  if (!startU || !endU) return null;

  // Rotation-minimizing (Bishop) transport avoids the visible torsion and
  // frame flips that occur when each ring is oriented independently.
  const transported: Vec3[] = [startU];
  for (let index = 1; index < tangents.length; index += 1) {
    const priorTangent = tangents[index - 1];
    const tangent = tangents[index];
    const axisVector = cross3(priorTangent, tangent);
    const axisLength = Math.hypot(axisVector.x, axisVector.y, axisVector.z);
    const priorU = transported[index - 1];
    const rotated = axisLength > 1e-8
      ? rotateAroundAxis(
          priorU,
          scale3(axisVector, 1 / axisLength),
          Math.atan2(axisLength, Math.max(-1, Math.min(1, dot3(priorTangent, tangent)))),
        )
      : priorU;
    transported.push(
      projectedFrameNormal(rotated, tangent, "transported graft surface frame") ??
      deterministicPerpendicular(tangent),
    );
  }

  const transportedEnd = transported.at(-1)!;
  const endTangent = tangents.at(-1)!;
  const residualTwist = Math.atan2(
    dot3(cross3(transportedEnd, endU), endTangent),
    Math.max(-1, Math.min(1, dot3(transportedEnd, endU))),
  );
  return transported.map((transportedU, index) => {
    const t = index / (transported.length - 1);
    // Quintic smoothstep distributes only the residual end alignment, with
    // zero twist-rate and twist-acceleration at both attachments.
    const blend = t ** 3 * (10 - 15 * t + 6 * t ** 2);
    const tangent = tangents[index];
    const u = rotateAroundAxis(transportedU, tangent, residualTwist * blend);
    const v = normalizedOrNull(cross3(tangent, u), "graft surface frame binormal") ??
      deterministicPerpendicular(u);
    let frameTangent = normalize3(cross3(u, v), "graft surface frame tangent");
    if (dot3(frameTangent, tangent) < 0) frameTangent = scale3(frameTangent, -1);
    return { tangent: frameTangent, u, v };
  });
}

function ligamentMesh(
  span: LigamentSpan,
  anatomyMeshes: readonly ViewerMeshPayload[],
): LigamentMeshGeometry {
  const radiusMm = graftRadiusMm(span);
  const surfaceMeshes = isSurfaceWrapped(span) ? wrappingMeshes(span, anatomyMeshes) : [];
  const meshCacheKey = surfaceMeshes.length
    ? `${surfaceRouteKey(span, radiusMm, surfaceMeshes)}:constant-tube-mesh-v1`
    : null;
  const cachedMesh = meshCacheKey ? surfaceLigamentMeshCache.get(meshCacheKey) : undefined;
  if (cachedMesh) return cachedMesh;
  const vertices: number[][] = [];
  const faces: number[][] = [];
  const route = surfaceMeshes.length
    ? (() => {
        const centers = surfaceWrappedCenterline(span, radiusMm, surfaceMeshes);
        return {
          centers,
          labelPoint: centers[Math.floor(centers.length / 2)] ?? span.proximal.point,
        };
      })()
    : ligamentCenterline(span, radiusMm, anatomyMeshes);
  if (route.centers.length < 2) {
    return {
      vertices,
      faces,
      midpoint: toTuple(span.proximal.point),
      fiberPaths: [],
      unavailableReason: surfaceMeshes.length
        ? "No minimum-lift surface route satisfied the full-tube display tolerance."
        : "The paired conduit depth, direction, circular bore, or graft fit is unresolved or incompatible.",
    };
  }
  const centers = route.centers;
  let wrappedFrames: Array<{ tangent: Vec3; u: Vec3; v: Vec3 }> | null = null;
  if (surfaceMeshes.length) {
    wrappedFrames = surfaceFrames(span, centers);
    if (!wrappedFrames) {
      return { vertices, faces, midpoint: toTuple(span.proximal.point), fiberPaths: [], unavailableReason: "A stable rotation-minimizing surface frame could not be constructed." };
    }
  }
  const pathSegments = centers.length - 1;
  const frames: Array<{ u: Vec3; v: Vec3 }> = [];
  let priorU: Vec3 | null = null;

  for (let pathIndex = 0; pathIndex <= pathSegments; pathIndex += 1) {
    const center = centers[pathIndex];
    const tangent = wrappedFrames?.[pathIndex].tangent ?? centerlineTangent(centers, pathIndex);
    let u: Vec3;
    if (wrappedFrames) {
      u = wrappedFrames[pathIndex].u;
    } else if (priorU) {
      const projected = sub3(priorU, scale3(tangent, dot3(priorU, tangent)));
      try {
        u = normalize3(projected, "ligament transported frame");
      } catch {
        u = deterministicPerpendicular(tangent);
      }
    } else {
      u = deterministicPerpendicular(tangent);
    }
    const v = wrappedFrames?.[pathIndex].v ??
      normalize3(cross3(tangent, u), "ligament transported frame normal");
    priorU = u;
    frames.push({ u, v });
    for (let radialIndex = 0; radialIndex < RADIAL_SEGMENTS; radialIndex += 1) {
      const angle = radialIndex / RADIAL_SEGMENTS * Math.PI * 2;
      const x = Math.cos(angle) * radiusMm;
      const y = Math.sin(angle) * radiusMm;
      const point = add3(center, add3(scale3(u, x), scale3(v, y)));
      vertices.push([point.x, point.y, point.z]);
    }
  }

  const fiberPaths = Array.from({ length: FIBER_COUNT }, (_, fiberIndex) => {
    const angle = fiberIndex / FIBER_COUNT * Math.PI * 2;
    return centers.map((center, pathIndex): [number, number, number] => {
      const { u, v } = frames[pathIndex];
      const fiberRadius = radiusMm * 1.012;
      return toTuple(
        add3(
          center,
          add3(
            scale3(u, Math.cos(angle) * fiberRadius),
            scale3(v, Math.sin(angle) * fiberRadius),
          ),
        ),
      );
    });
  });

  for (let pathIndex = 0; pathIndex < pathSegments; pathIndex += 1) {
    const currentRing = pathIndex * RADIAL_SEGMENTS;
    const nextRing = (pathIndex + 1) * RADIAL_SEGMENTS;
    for (let radialIndex = 0; radialIndex < RADIAL_SEGMENTS; radialIndex += 1) {
      const next = (radialIndex + 1) % RADIAL_SEGMENTS;
      faces.push(
        [currentRing + radialIndex, currentRing + next, nextRing + next],
        [currentRing + radialIndex, nextRing + next, nextRing + radialIndex],
      );
    }
  }

  const lastRing = pathSegments * RADIAL_SEGMENTS;
  const startCenterIndex = vertices.length;
  vertices.push(toTuple(centers[0]));
  const endCenterIndex = vertices.length;
  vertices.push(toTuple(centers[pathSegments]));
  if (!surfaceMeshes.length) {
    for (let radialIndex = 0; radialIndex < RADIAL_SEGMENTS; radialIndex += 1) {
      const next = (radialIndex + 1) % RADIAL_SEGMENTS;
      faces.push(
        [startCenterIndex, next, radialIndex],
        [endCenterIndex, lastRing + radialIndex, lastRing + next],
      );
    }
  }

  // The final centerline was already accepted by
  // surfaceTubeCandidateValid(). For a constant-radius tube, the nearest
  // center-to-surface distance bounds the whole circular cross-section by the
  // triangle inequality. Re-testing every generated ring vertex and face
  // centroid was mathematically redundant and made each small drag take
  // several seconds on the patient mesh.
  const result = {
    vertices,
    faces,
    midpoint: toTuple(route.labelPoint),
    fiberPaths,
    unavailableReason: null,
  };
  if (meshCacheKey) {
    if (surfaceLigamentMeshCache.size >= SURFACE_ROUTE_CACHE_LIMIT) {
      const oldest = surfaceLigamentMeshCache.keys().next().value as string | undefined;
      if (oldest) surfaceLigamentMeshCache.delete(oldest);
    }
    surfaceLigamentMeshCache.set(meshCacheKey, result);
  }
  return result;
}

/**
 * Builds a presentation-only reconstructed-graft layer from explicit paired
 * surface attachments. The channel apertures remain the editable source of
 * truth; these meshes are deterministic derivatives and are not used for
 * collision or clinical safety analysis.
 */
export function buildReconstructedLigamentPayloads(options: {
  channels: readonly ChannelPlan[];
  procedureById: Readonly<Record<string, ProcedureIdentity>>;
  anatomyMeshes: readonly ViewerMeshPayload[];
  selectedChannelId: string | null;
  /** Omit for legacy render-all behavior; an explicit set makes solving lazy. */
  visibleGraftVisibilityKeys?: ReadonlySet<string>;
}): ReconstructedLigamentPayloads {
  const endpointsByProcedure = new Map<string, AttachedEndpoint[]>();
  const centroidByMeshId = new Map<string, Vec3 | null>();
  for (const channel of options.channels) {
    const procedure = options.procedureById[channel.procedureId];
    if (!procedure) continue;
    const endpoint = attachedEndpoint(channel, options.anatomyMeshes, centroidByMeshId);
    if (!endpoint) continue;
    const endpoints = endpointsByProcedure.get(channel.procedureId) ?? [];
    endpoints.push(endpoint);
    endpointsByProcedure.set(channel.procedureId, endpoints);
  }

  const spans = [...endpointsByProcedure.entries()]
    .flatMap(([procedureId, endpoints]) => {
      const procedure = options.procedureById[procedureId];
      return procedure ? spansForProcedure(procedureId, procedure, endpoints) : [];
    })
    .sort((left, right) =>
      left.procedureId.localeCompare(right.procedureId) || left.bundleKey.localeCompare(right.bundleKey),
    );

  const meshes: ViewerMeshPayload[] = [];
  const labels: ViewerLabelPayload[] = [];
  const grafts: ReconstructedLigamentDescriptor[] = [];
  spans.forEach((span) => {
    const id = `reconstructed-graft:${span.procedureId}:${span.bundleKey}`;
    const visibilityKey = [
      span.procedure,
      span.bundleKey,
      span.proximal.channel.semanticKey ?? span.proximal.channel.label,
      span.distal.channel.semanticKey ?? span.distal.channel.label,
    ].join(":");
    if (
      options.visibleGraftVisibilityKeys &&
      !options.visibleGraftVisibilityKeys.has(visibilityKey)
    ) {
      // Preserve a cheap descriptor so the per-graft toggle remains present,
      // but do not run the patient-surface solver until the clinician asks to
      // see this preview.
      grafts.push({
        id,
        visibilityKey,
        procedureId: span.procedureId,
        procedure: span.procedure,
        bundleKey: span.bundleKey,
        bundleRole: resolvedSpanBundleRole(span),
        label: span.label,
        channelIds: [span.proximal.channel.id, span.distal.channel.id],
        rendered: false,
        unavailableReason: null,
      });
      return;
    }
    const mesh = ligamentMesh(span, options.anatomyMeshes);
    const rendered = mesh.vertices.length > 0 && mesh.faces.length > 0;
    grafts.push({
      id,
      visibilityKey,
      procedureId: span.procedureId,
      procedure: span.procedure,
      bundleKey: span.bundleKey,
      bundleRole: resolvedSpanBundleRole(span),
      label: span.label,
      channelIds: [span.proximal.channel.id, span.distal.channel.id],
      rendered,
      unavailableReason: rendered ? null : mesh.unavailableReason,
    });
    // Extra-articular previews fail closed when a smooth constant-radius route
    // cannot be solved without more than the display-only overlap tolerance.
    if (!rendered) return;
    const selected = options.selectedChannelId === span.proximal.channel.id ||
      options.selectedChannelId === span.distal.channel.id;
    const channelId = selected && options.selectedChannelId
      ? options.selectedChannelId
      : span.proximal.channel.id;
    const color = GRAFT_COLORS[stableHash(id) % GRAFT_COLORS.length];
    meshes.push({
      id,
      name: `${span.label} · planning preview`,
      vertices: mesh.vertices,
      faces: mesh.faces,
      color,
      opacity: selected ? 0.76 : 0.68,
      layer: "grafts",
      channelId,
      analysisCategory: "reconstructed_ligament_preview",
      materialStyle: "biologic_graft",
      fiberPaths: mesh.fiberPaths,
    });
    labels.push({
      id: `${id}:label`,
      text: span.label,
      position: [mesh.midpoint[0], mesh.midpoint[1], mesh.midpoint[2] + 3],
      color,
      opacity: selected ? 0.9 : 0.72,
      sizeMm: selected ? 4.8 : 4.2,
      layer: "grafts",
      channelId,
    });
  });
  return { meshes, labels, grafts };
}
