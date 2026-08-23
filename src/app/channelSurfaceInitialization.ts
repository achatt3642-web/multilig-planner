import type {
  Bone,
  CenterlineDefinition,
  ChannelPlan,
  ChannelSurfaceAttachment,
  InstrumentChain,
  PlanCase,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import {
  projectPatientRasPointToMesh,
  projectPatientRasPointToTibialSuperiorEnvelope,
  type SurfaceProjection,
} from "../geometry/surfaceTether";
import type { ViewerMeshPayload } from "../viewer/types";
import {
  ANATOMY_DERIVED_SURFACE_SEED_WARNING,
  anatomicChannelSurfaceSeed,
  createAnatomicChannelSeedContext,
  type AnatomicChannelSeedContext,
} from "./anatomicChannelSurfaceSeed";
import { classifyChannelEntryTether } from "./channelEntryTether";
import { withTibialSuperiorEnvelopeWarnings } from "./channelHandleEdit";
import { resolvedTrajectoryControlMode } from "./channelTrajectorySemantics";

const GEOMETRY_EPSILON_MM = 1e-6;

export const UNREGISTERED_DEFAULT_TRAJECTORY_WARNING =
  "The unregistered preset trajectory did not traverse the loaded bone from its surface Entry, so the generic display seed was redirected toward the centroid of that same display mesh to create an on-surface Start. This is not a surgical recommendation; clinician repositioning and verification are required.";
export const GENERIC_ANCHOR_TRAJECTORY_WARNING =
  "The generic anchor socket trajectory is initially directed from its surface Start toward the centroid of the same display mesh. This only keeps the visual template intraosseous; it is not an anatomic target or surgical recommendation.";
export const GENERIC_GUIDE_PIN_TRAJECTORY_WARNING =
  "The generic guide-pin trajectory is initially directed from its surface Start toward the centroid of the same display mesh. This only keeps the visual template intraosseous; it is not an anatomic target or surgical recommendation.";
export const GENERIC_IPSILATERAL_SOCKET_TRAJECTORY_WARNING =
  "The generic ipsilateral socket and coaxial guide-pin trajectory is initially directed from its surface Entry toward the centroid of the same display mesh. The deep Start is the analytic socket tip, not a contralateral cortex target or surgical recommendation.";

interface ProjectedSurfacePoint {
  point: Vector3;
  attachment: ChannelSurfaceAttachment;
}

function vector3(point: readonly number[]): Vector3 {
  return [point[0], point[1], point[2]];
}

function isFiniteVector3(point: readonly number[]): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function add(point: Vector3, delta: Vector3): Vector3 {
  return [point[0] + delta[0], point[1] + delta[1], point[2] + delta[2]];
}

function attachmentFromProjection(
  projection: SurfaceProjection,
  bone: Bone,
  requestedPoint: Vector3,
): ChannelSurfaceAttachment {
  const vertexIndices = projection.triangle.vertexIndices;
  const isSuperiorEnvelope = projection.constraint.kind === "tibial_superior_envelope";
  return {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone,
    targetKind: isSuperiorEnvelope ? "tibial_superior_envelope" : "whole_bone_surface",
    targetRegionId: null,
    meshId: projection.meshId,
    requestedPointPatientRasMm: requestedPoint,
    attachedPointPatientRasMm: vector3(projection.closestPointPatientRasMm),
    distanceFromRequestedPointMm: projection.distanceMm,
    triangleStableId: projection.triangle.stableId,
    faceStableId: projection.triangle.stableId,
    faceIndex: projection.triangle.faceIndex,
    vertexIndices,
    vertexStableIds: [
      `${projection.meshId}:vertex:${vertexIndices[0]}`,
      `${projection.meshId}:vertex:${vertexIndices[1]}`,
      `${projection.meshId}:vertex:${vertexIndices[2]}`,
    ],
    barycentric: projection.barycentric,
    surfaceNormalPatientRas: vector3(projection.surfaceNormalPatientRas),
    reviewState: isSuperiorEnvelope
      ? "user_defined_not_clinician_approved"
      : "surface_review_not_evaluated",
    ...(projection.constraint.kind === "tibial_superior_envelope"
      ? {
          constraintProvenance: {
            rule: projection.constraint.definition,
            ruleVersion: projection.constraint.ruleVersion,
            sourceGeometryRole: "viewer_display_surface" as const,
            resolution: projection.constraint.resolution,
            xyFallbackDistanceMm: projection.constraint.xyDistanceMm,
          },
        }
      : {}),
  };
}

function projectToNearestDeclaredBone(
  requestedPoint: Vector3,
  bone: Bone,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ProjectedSurfacePoint | null {
  let best: { projection: SurfaceProjection; meshId: string } | null = null;
  for (const mesh of anatomyMeshes) {
    if (mesh.anatomyBone !== bone) continue;
    const projection = projectPatientRasPointToMesh(requestedPoint, mesh);
    if (projection.status !== "projected") continue;
    if (
      best === null ||
      projection.squaredDistanceMm2 < best.projection.squaredDistanceMm2 ||
      (
        projection.squaredDistanceMm2 === best.projection.squaredDistanceMm2 &&
        `${mesh.id}:${projection.triangle.faceIndex}`.localeCompare(
          `${best.meshId}:${best.projection.triangle.faceIndex}`,
        ) < 0
      )
    ) {
      best = { projection, meshId: mesh.id };
    }
  }
  if (best === null) return null;
  return {
    point: vector3(best.projection.closestPointPatientRasMm),
    attachment: attachmentFromProjection(best.projection, bone, requestedPoint),
  };
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/** First forward surface hit after the aperture; entry-face hits are excluded. */
function projectToForwardDeclaredBoneExit(
  aperture: Vector3,
  direction: Vector3,
  requestedEndpoint: Vector3,
  bone: Bone,
  anatomyMeshes: readonly ViewerMeshPayload[],
  selection: "nearest" | "farthest" = "nearest",
): ProjectedSurfacePoint | null {
  let best: { distanceAlongRayMm: number; projection: SurfaceProjection; stableKey: string } | null = null;
  for (const mesh of anatomyMeshes) {
    if (mesh.anatomyBone !== bone) continue;
    for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex += 1) {
      const face = mesh.faces[faceIndex];
      if (!face || face.length !== 3) continue;
      const vertices = face.map((index) => mesh.vertices[index]);
      if (vertices.some((vertex) => !vertex || vertex.length !== 3 || !vertex.every(Number.isFinite))) continue;
      const a = vector3(vertices[0]);
      const b = vector3(vertices[1]);
      const c = vector3(vertices[2]);
      const edge1 = subtract(b, a);
      const edge2 = subtract(c, a);
      const p = cross(direction, edge2);
      const determinant = dot(edge1, p);
      if (Math.abs(determinant) <= GEOMETRY_EPSILON_MM) continue;
      const inverseDeterminant = 1 / determinant;
      const fromA = subtract(aperture, a);
      const u = dot(fromA, p) * inverseDeterminant;
      if (u < -GEOMETRY_EPSILON_MM || u > 1 + GEOMETRY_EPSILON_MM) continue;
      const q = cross(fromA, edge1);
      const v = dot(direction, q) * inverseDeterminant;
      if (v < -GEOMETRY_EPSILON_MM || u + v > 1 + GEOMETRY_EPSILON_MM) continue;
      const distanceAlongRayMm = dot(edge2, q) * inverseDeterminant;
      // Exclude the entry triangle and its numerical neighbors at t≈0.
      if (!Number.isFinite(distanceAlongRayMm) || distanceAlongRayMm <= 0.05) continue;
      const point: Vector3 = [
        aperture[0] + direction[0] * distanceAlongRayMm,
        aperture[1] + direction[1] * distanceAlongRayMm,
        aperture[2] + direction[2] * distanceAlongRayMm,
      ];
      const normalVector = cross(edge1, edge2);
      const normalMagnitude = Math.hypot(normalVector[0], normalVector[1], normalVector[2]);
      if (normalMagnitude <= GEOMETRY_EPSILON_MM) continue;
      const delta = subtract(requestedEndpoint, point);
      const squaredDistanceMm2 = dot(delta, delta);
      const vertexIndices: [number, number, number] = [face[0], face[1], face[2]];
      const projection: SurfaceProjection = {
        status: "projected",
        coordinateSpace: "patient_ras",
        units: "mm",
        meshId: mesh.id,
        sourcePointPatientRasMm: requestedEndpoint,
        closestPointPatientRasMm: point,
        distanceMm: Math.sqrt(squaredDistanceMm2),
        squaredDistanceMm2,
        triangle: {
          meshId: mesh.id,
          faceIndex,
          vertexIndices,
          stableId: `${mesh.id}:face:${faceIndex}`,
        },
        barycentric: [1 - u - v, u, v],
        surfaceNormalPatientRas: [
          normalVector[0] / normalMagnitude,
          normalVector[1] / normalMagnitude,
          normalVector[2] / normalMagnitude,
        ],
        constraint: { kind: "whole_mesh" },
      };
      const stableKey = `${mesh.id}:${faceIndex}`;
      if (
        best === null ||
        (selection === "nearest"
          ? distanceAlongRayMm < best.distanceAlongRayMm
          : distanceAlongRayMm > best.distanceAlongRayMm) ||
        (distanceAlongRayMm === best.distanceAlongRayMm && stableKey.localeCompare(best.stableKey) < 0)
      ) {
        best = { distanceAlongRayMm, projection, stableKey };
      }
    }
  }
  if (!best) return null;
  return {
    point: vector3(best.projection.closestPointPatientRasMm),
    attachment: attachmentFromProjection(best.projection, bone, requestedEndpoint),
  };
}

function projectToTibialSuperiorEnvelope(
  requestedPoint: Vector3,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ProjectedSurfacePoint | null {
  let best: {
    projection: SurfaceProjection;
    resolutionRank: number;
    xyDistanceMm: number;
    meshId: string;
  } | null = null;

  for (const mesh of anatomyMeshes) {
    if (mesh.anatomyBone !== "tibia") continue;
    const projection = projectPatientRasPointToTibialSuperiorEnvelope(requestedPoint, mesh);
    if (projection.status !== "projected" || projection.constraint.kind !== "tibial_superior_envelope") {
      continue;
    }
    const resolutionRank = projection.constraint.resolution === "vertical_intersection" ? 0 : 1;
    const xyDistanceMm = projection.constraint.xyDistanceMm;
    const z = projection.closestPointPatientRasMm[2];
    const bestZ = best?.projection.closestPointPatientRasMm[2] ?? -Infinity;
    const stableKey = `${mesh.id}:${projection.triangle.faceIndex}`;
    const bestStableKey = best === null ? "" : `${best.meshId}:${best.projection.triangle.faceIndex}`;
    if (
      best === null ||
      resolutionRank < best.resolutionRank ||
      (resolutionRank === best.resolutionRank && xyDistanceMm < best.xyDistanceMm) ||
      (resolutionRank === best.resolutionRank && xyDistanceMm === best.xyDistanceMm && z > bestZ) ||
      (
        resolutionRank === best.resolutionRank &&
        xyDistanceMm === best.xyDistanceMm &&
        z === bestZ &&
        stableKey.localeCompare(bestStableKey) < 0
      )
    ) {
      best = { projection, resolutionRank, xyDistanceMm, meshId: mesh.id };
    }
  }

  if (best === null) return null;
  return {
    point: vector3(best.projection.closestPointPatientRasMm),
    attachment: attachmentFromProjection(best.projection, "tibia", requestedPoint),
  };
}

function translateCenterline(centerline: CenterlineDefinition, delta: Vector3): CenterlineDefinition {
  switch (centerline.kind) {
    case "rigid":
      return {
        ...centerline,
        aperturePatientRasMm: add(centerline.aperturePatientRasMm, delta),
      };
    case "flexible":
      return {
        ...centerline,
        aperturePatientRasMm: add(centerline.aperturePatientRasMm, delta),
        accessControlPointsPatientRasMm: centerline.accessControlPointsPatientRasMm.map((point) =>
          add(point, delta)),
      };
    case "polyline":
      return {
        ...centerline,
        pointsPatientRasMm: centerline.pointsPatientRasMm.map((point) => add(point, delta)),
      };
  }
}

function effectiveDepthMm(channel: ChannelPlan): number | null {
  const selectedDepth = channel.instrumentChain.depthOrFullTunnelSetting.mode === "depth"
    ? channel.instrumentChain.depthOrFullTunnelSetting.depthMm
    : channel.depthMm;
  return selectedDepth !== null && Number.isFinite(selectedDepth) && selectedDepth > 0
    ? selectedDepth
    : null;
}

function normalized(direction: Vector3): Vector3 | null {
  const magnitude = Math.hypot(direction[0], direction[1], direction[2]);
  if (!Number.isFinite(magnitude) || magnitude <= GEOMETRY_EPSILON_MM) return null;
  return [direction[0] / magnitude, direction[1] / magnitude, direction[2] / magnitude];
}

function analyticEndpoint(channel: ChannelPlan): Vector3 | null {
  if (channel.centerline.kind === "polyline") {
    const last = channel.centerline.pointsPatientRasMm.at(-1);
    if (channel.centerline.pointsPatientRasMm.length >= 2 && last && isFiniteVector3(last)) {
      return vector3(last);
    }
  }
  const direction = normalized(channel.vector);
  const depthMm = effectiveDepthMm(channel);
  if (!direction || depthMm === null || !isFiniteVector3(channel.aperture)) return null;
  return [
    channel.aperture[0] + direction[0] * depthMm,
    channel.aperture[1] + direction[1] * depthMm,
    channel.aperture[2] + direction[2] * depthMm,
  ];
}

function centerlineWithFullTunnelEndpoint(
  centerline: CenterlineDefinition,
  aperture: Vector3,
  endpoint: Vector3,
  direction: Vector3,
): CenterlineDefinition {
  switch (centerline.kind) {
    case "rigid":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        directionPatientRas: direction,
      };
    case "flexible":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        intraosseousDirectionPatientRas: direction,
        accessControlPointsPatientRasMm: centerline.accessControlPointsPatientRasMm.map(
          (point, index, points) => index === points.length - 1 && points.length > 1 ? endpoint : point,
        ),
      };
    case "polyline":
      return {
        ...centerline,
        pointsPatientRasMm: centerline.pointsPatientRasMm.length < 2
          ? [aperture, endpoint]
          : centerline.pointsPatientRasMm.map((point, index, points) => {
              if (index === 0) return aperture;
              if (index === points.length - 1) return endpoint;
              return point;
            }),
      };
  }
}

function centerlineWithDefaultDirection(
  centerline: CenterlineDefinition,
  aperture: Vector3,
  direction: Vector3,
  depthMm: number | null,
): CenterlineDefinition {
  const displayLengthMm = depthMm !== null && Number.isFinite(depthMm) && depthMm > 0
    ? depthMm
    : 1;
  const endpoint: Vector3 = [
    aperture[0] + direction[0] * displayLengthMm,
    aperture[1] + direction[1] * displayLengthMm,
    aperture[2] + direction[2] * displayLengthMm,
  ];
  switch (centerline.kind) {
    case "rigid":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        directionPatientRas: direction,
      };
    case "flexible":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        intraosseousDirectionPatientRas: direction,
      };
    case "polyline":
      return {
        ...centerline,
        pointsPatientRasMm: centerline.pointsPatientRasMm.length < 2
          ? [aperture, endpoint]
          : centerline.pointsPatientRasMm.map((point, index, points) => {
              if (index === 0) return aperture;
              if (index === points.length - 1) return endpoint;
              return point;
            }),
      };
  }
}

function inwardDefaultDirections(
  channel: ChannelPlan,
  anatomyMeshes: readonly ViewerMeshPayload[],
): Vector3[] {
  if (
    channel.surfacePlacement?.state !== "default_applied" ||
    channel.instrumentChain.userVerified ||
    !channel.apertureSurfaceAttachment
  ) return [];
  const entryMesh = anatomyMeshes.find((mesh) =>
    mesh.id === channel.apertureSurfaceAttachment?.meshId &&
    mesh.anatomyBone === channel.bone,
  );
  if (!entryMesh) return [];
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const vertex of entryMesh.vertices) {
    if (!isFiniteVector3(vertex)) continue;
    x += vertex[0];
    y += vertex[1];
    z += vertex[2];
    count += 1;
  }
  if (!count) return [];
  const centroidDirection = normalized([
    x / count - channel.aperture[0],
    y / count - channel.aperture[1],
    z / count - channel.aperture[2],
  ]);
  const authoredDirection = normalized(channel.vector);
  if (!centroidDirection || !authoredDirection) return [];
  const candidates: Vector3[] = [];
  // Use the smallest deterministic correction toward the mesh interior that
  // actually produces a second cortical hit; the full centroid ray is last.
  for (let step = 1; step <= 10; step += 1) {
    const weight = step / 10;
    const candidate = normalized([
      authoredDirection[0] * (1 - weight) + centroidDirection[0] * weight,
      authoredDirection[1] * (1 - weight) + centroidDirection[1] * weight,
      authoredDirection[2] * (1 - weight) + centroidDirection[2] * weight,
    ]);
    if (!candidate) continue;
    if (candidates.some((prior) => Math.hypot(
      prior[0] - candidate[0],
      prior[1] - candidate[1],
      prior[2] - candidate[2],
    ) <= GEOMETRY_EPSILON_MM)) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function instrumentChainWithDepth(chain: InstrumentChain, depthMm: number): InstrumentChain {
  if (chain.depthOrFullTunnelSetting.mode !== "depth") return chain;
  return {
    ...chain,
    depthOrFullTunnelSetting: {
      ...chain.depthOrFullTunnelSetting,
      depthMm,
    },
    userVerified: false,
    verification: null,
    completionState: chain.completionState === "complete" ? "warning" : chain.completionState,
  };
}

function uniqueMeshIds(...meshIds: Array<string | null | undefined>): string[] {
  return meshIds.filter(
    (meshId, index, values): meshId is string =>
      Boolean(meshId) && values.indexOf(meshId) === index,
  );
}

function hasExplicitDepthSelection(channel: ChannelPlan): boolean {
  return channel.instrumentChain.userVerified || (
    channel.instrumentChain.depthOrFullTunnelSetting.mode === "depth" &&
    channel.instrumentChain.depthOrFullTunnelSetting.depthMm !== null
  ) || (
    channel.surfacePlacement?.state === "clinician_edited" &&
    channel.depthMm !== null
  );
}

/**
 * Adds the outer-cortex Start tether along the authored Entry/vector ray.
 *
 * The Start is a trajectory control, not the analytic end of a blind socket,
 * so socket depth (including null/unselected depth) is never used to find it
 * and is never changed here. Full-tunnel seed geometry may adopt the measured
 * cortical chord only while no explicit instrument depth has been selected.
 */
export function attachMissingForwardSurfaceStart(
  channel: ChannelPlan,
  anatomyMeshes: readonly ViewerMeshPayload[],
  options: { forwardSurfaceSelection?: "nearest" | "farthest" } = {},
): ChannelPlan {
  const trajectoryControlMode = resolvedTrajectoryControlMode(channel);
  if (trajectoryControlMode === "exterior_rod") {
    // MAT-style anchors and guide-pin-only root preparations use a free-space
    // exterior trajectory rod. A historic opposite-cortex Start tether would
    // invert that interaction, so remove it once the surface Start is available
    // and derive the rod from vector only.
    if (!channel.apertureSurfaceAttachment) return channel;
    if (
      channel.endpointSurfaceAttachment === null &&
      channel.surfacePlacement?.endpointMethod === "preserved_depth"
    ) return channel;
    return {
      ...channel,
      endpointSurfaceAttachment: null,
      surfacePlacement: {
        state: channel.surfacePlacement?.state ?? "default_applied",
        method: channel.surfacePlacement?.method ?? "migration_pending",
        meshIds: uniqueMeshIds(
          ...(channel.surfacePlacement?.meshIds ?? []),
          channel.apertureSurfaceAttachment.meshId,
        ),
        endpointMethod: "preserved_depth",
      },
    };
  }
  if (trajectoryControlMode === "blind_socket_tip") {
    if (
      channel.endpointSurfaceAttachment === null &&
      channel.surfacePlacement?.endpointMethod === "blind_socket_tip"
    ) return channel;
    return {
      ...channel,
      endpointSurfaceAttachment: null,
      surfacePlacement: {
        state: channel.surfacePlacement?.state ?? "default_applied",
        method: channel.surfacePlacement?.method ?? "migration_pending",
        meshIds: uniqueMeshIds(
          ...(channel.surfacePlacement?.meshIds ?? []),
          channel.apertureSurfaceAttachment?.meshId,
        ),
        endpointMethod: "blind_socket_tip",
      },
    };
  }
  if (trajectoryControlMode === "none") {
    return {
      ...channel,
      endpointSurfaceAttachment: null,
      surfacePlacement: channel.surfacePlacement
        ? { ...channel.surfacePlacement, endpointMethod: "not_available" }
        : channel.surfacePlacement,
    };
  }
  if (channel.endpointSurfaceAttachment || !channel.apertureSurfaceAttachment) return channel;
  const entryAttachment = channel.apertureSurfaceAttachment;
  let working = channel;
  const rayDirection = normalized(working.vector);
  if (!rayDirection || !isFiniteVector3(channel.aperture)) return channel;

  const requestedStart = analyticEndpoint(working) ?? add(working.aperture, rayDirection);
  let startProjection = projectToForwardDeclaredBoneExit(
    working.aperture,
    rayDirection,
    requestedStart,
    working.bone,
    anatomyMeshes,
    options.forwardSurfaceSelection,
  );
  if (!startProjection) {
    const requiredSocketRunMm = working.fullThickness ? null : effectiveDepthMm(working);
    for (const inwardDirection of inwardDefaultDirections(working, anatomyMeshes)) {
      const candidateWorking: ChannelPlan = {
        ...working,
        vector: inwardDirection,
        centerline: centerlineWithDefaultDirection(
          working.centerline,
          working.aperture,
          inwardDirection,
          effectiveDepthMm(working),
        ),
      };
      const candidateRequestedStart = analyticEndpoint(candidateWorking)
        ?? add(candidateWorking.aperture, inwardDirection);
      const candidateProjection = projectToForwardDeclaredBoneExit(
        candidateWorking.aperture,
        inwardDirection,
        candidateRequestedStart,
        candidateWorking.bone,
        anatomyMeshes,
        options.forwardSurfaceSelection,
      );
      if (!candidateProjection) continue;
      const surfaceRunMm = Math.hypot(
        candidateProjection.point[0] - candidateWorking.aperture[0],
        candidateProjection.point[1] - candidateWorking.aperture[1],
        candidateProjection.point[2] - candidateWorking.aperture[2],
      );
      // A default cortical Start must not make an explicitly sized socket
      // extend through air beyond that surface. If no candidate satisfies this
      // geometric condition, leave Start not evaluated.
      if (
        requiredSocketRunMm !== null &&
        surfaceRunMm + GEOMETRY_EPSILON_MM < requiredSocketRunMm
      ) continue;
      working = {
        ...candidateWorking,
        warnings: candidateWorking.warnings.includes(UNREGISTERED_DEFAULT_TRAJECTORY_WARNING)
          ? candidateWorking.warnings
          : [...candidateWorking.warnings, UNREGISTERED_DEFAULT_TRAJECTORY_WARNING],
      };
      startProjection = candidateProjection;
      break;
    }
  }
  // A nearest-point fallback would create a plausible-looking, off-axis Start.
  // Fail closed until the authored ray has a real forward surface intersection.
  if (!startProjection) return channel;

  const surfacePlacement = working.surfacePlacement ?? {
    state: "default_applied" as const,
    method: "migration_pending" as const,
    meshIds: [entryAttachment.meshId],
    endpointMethod: "not_available" as const,
  };
  const withAttachment: ChannelPlan = {
    ...working,
    endpointSurfaceAttachment: startProjection.attachment,
    surfacePlacement: {
      ...surfacePlacement,
      meshIds: uniqueMeshIds(
        ...surfacePlacement.meshIds,
        entryAttachment.meshId,
        startProjection.attachment.meshId,
      ),
      endpointMethod: "opposite_surface_intersection",
    },
  };

  if (!working.fullThickness || hasExplicitDepthSelection(working)) {
    return withAttachment;
  }

  const endpointDelta: Vector3 = [
    startProjection.point[0] - working.aperture[0],
    startProjection.point[1] - working.aperture[1],
    startProjection.point[2] - working.aperture[2],
  ];
  const depthMm = Math.hypot(endpointDelta[0], endpointDelta[1], endpointDelta[2]);
  if (!Number.isFinite(depthMm) || depthMm <= GEOMETRY_EPSILON_MM) return withAttachment;
  const recomputedDirection: Vector3 = [
    endpointDelta[0] / depthMm,
    endpointDelta[1] / depthMm,
    endpointDelta[2] / depthMm,
  ];

  return {
    ...withAttachment,
    vector: recomputedDirection,
    depthMm,
    centerline: centerlineWithFullTunnelEndpoint(
      working.centerline,
      working.aperture,
      startProjection.point,
      recomputedDirection,
    ),
    instrumentChain: instrumentChainWithDepth(working.instrumentChain, depthMm),
  };
}

function initializeChannel(
  channel: ChannelPlan,
  procedure: ProcedureIdentity | null,
  anatomyMeshes: readonly ViewerMeshPayload[],
  anatomicSeedContext: AnatomicChannelSeedContext | null,
): ChannelPlan {
  if (channel.surfacePlacement?.state !== "pending_default") {
    // Safe migration/idempotent completion pass: retain every authored value
    // and add only a missing Start tether when Entry is already attached.
    return attachMissingForwardSurfaceStart(channel, anatomyMeshes);
  }
  const anatomicSeed = anatomicSeedContext
    ? anatomicChannelSurfaceSeed(anatomicSeedContext, channel, procedure)
    : null;
  const seededChannel: ChannelPlan = anatomicSeed
    ? {
        ...channel,
        aperture: anatomicSeed.requestedPointPatientRasMm,
        vector: anatomicSeed.preferredDirectionPatientRas,
        centerline: centerlineWithDefaultDirection(
          channel.centerline,
          anatomicSeed.requestedPointPatientRasMm,
          anatomicSeed.preferredDirectionPatientRas,
          effectiveDepthMm(channel),
        ),
      }
    : channel;
  const classification = classifyChannelEntryTether(channel, procedure);
  const apertureProjection = classification.kind === "intra_articular_tibial_plateau"
    ? projectToTibialSuperiorEnvelope(seededChannel.aperture, anatomyMeshes)
    : projectToNearestDeclaredBone(seededChannel.aperture, seededChannel.bone, anatomyMeshes);
  if (!apertureProjection) return channel;

  const apertureDelta: Vector3 = [
    apertureProjection.point[0] - seededChannel.aperture[0],
    apertureProjection.point[1] - seededChannel.aperture[1],
    apertureProjection.point[2] - seededChannel.aperture[2],
  ];
  const translated: ChannelPlan = {
    ...seededChannel,
    aperture: apertureProjection.point,
    apertureSurfaceAttachment: apertureProjection.attachment,
    endpointSurfaceAttachment: null,
    warnings: (() => {
      const surfaceWarnings = classification.kind === "intra_articular_tibial_plateau"
        ? withTibialSuperiorEnvelopeWarnings(seededChannel.warnings, apertureProjection.attachment)
        : seededChannel.warnings;
      return anatomicSeed && !surfaceWarnings.includes(ANATOMY_DERIVED_SURFACE_SEED_WARNING)
        ? [...surfaceWarnings, ANATOMY_DERIVED_SURFACE_SEED_WARNING]
        : surfaceWarnings;
    })(),
    centerline: translateCenterline(seededChannel.centerline, apertureDelta),
    surfacePlacement: {
      state: "default_applied",
      method: classification.kind === "intra_articular_tibial_plateau"
        ? "tibial_superior_envelope"
        : "nearest_bone_surface",
      meshIds: [apertureProjection.attachment.meshId],
      endpointMethod: "not_available",
    },
  };

  const trajectoryControlMode = resolvedTrajectoryControlMode(translated);
  if (trajectoryControlMode === "exterior_rod" || trajectoryControlMode === "blind_socket_tip") {
    const inwardDirection = inwardDefaultDirections(translated, anatomyMeshes).at(-1)
      ?? normalized(translated.vector);
    if (!inwardDirection) return translated;
    return {
      ...translated,
      vector: inwardDirection,
      endpointSurfaceAttachment: null,
      centerline: centerlineWithDefaultDirection(
        translated.centerline,
        translated.aperture,
        inwardDirection,
        effectiveDepthMm(translated),
      ),
      surfacePlacement: {
        ...translated.surfacePlacement!,
        endpointMethod: trajectoryControlMode === "blind_socket_tip"
          ? "blind_socket_tip"
          : "preserved_depth",
      },
      warnings: (() => {
        const warning = trajectoryControlMode === "blind_socket_tip"
          ? GENERIC_IPSILATERAL_SOCKET_TRAJECTORY_WARNING
          : translated.geometryType === "rigid_pin"
            ? GENERIC_GUIDE_PIN_TRAJECTORY_WARNING
            : GENERIC_ANCHOR_TRAJECTORY_WARNING;
        return translated.warnings.includes(warning)
          ? translated.warnings
          : [...translated.warnings, warning];
      })(),
    };
  }

  return attachMissingForwardSurfaceStart(translated, anatomyMeshes, {
    // Anatomy-derived starts operate on the union of segmented pieces. The
    // farthest collinear hit is the exterior cortex; choosing the first hit
    // can stop on an internal overlap between decimated condylar components.
    forwardSurfaceSelection: anatomicSeed ? "farthest" : "nearest",
  });
}

/**
 * Applies patient-anatomy defaults exactly once to unregistered preset seeds.
 * Missing or malformed declared-bone meshes leave their channels pending.
 * Already-applied and clinician-edited channels retain their authored geometry;
 * when they already have Entry provenance, a missing forward cortical Start is
 * added without moving Entry or selecting/changing a socket depth.
 */
export function initializePendingChannelSurfacePlacements(
  plan: PlanCase,
  patientAnatomyMeshes: readonly ViewerMeshPayload[],
  options: { channelIds?: ReadonlySet<string> } = {},
): PlanCase {
  const procedureById = new Map(plan.procedures.map((procedure) => [procedure.id, procedure.structure]));
  const anatomicSeedContext = createAnatomicChannelSeedContext(plan, patientAnatomyMeshes);
  let planChanged = false;
  const variants = plan.variants.map((variant) => {
    let variantChanged = false;
    const channels = variant.channels.map((channel) => {
      if (options.channelIds && !options.channelIds.has(channel.id)) return channel;
      const initialized = initializeChannel(
        channel,
        procedureById.get(channel.procedureId) ?? null,
        patientAnatomyMeshes,
        anatomicSeedContext,
      );
      if (initialized !== channel) variantChanged = true;
      return initialized;
    });
    if (!variantChanged) return variant;
    planChanged = true;
    return { ...variant, channels };
  });
  return planChanged ? { ...plan, variants } : plan;
}
