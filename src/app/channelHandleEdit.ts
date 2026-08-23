import type {
  Bone,
  CenterlineDefinition,
  ChannelPlan,
  ChannelSurfaceAttachment,
  InstrumentChain,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import {
  projectPatientRasPointToMesh,
  projectPatientRasPointToTibialSuperiorEnvelope,
  type SurfaceProjection,
} from "../geometry/surfaceTether";
import type { ViewerHandleChange, ViewerMeshPayload } from "../viewer/types";
import { classifyChannelEntryTether } from "./channelEntryTether";
import { resolvedTrajectoryControlMode } from "./channelTrajectorySemantics";

export const TIBIAL_SUPERIOR_ENVELOPE_WARNING =
  "Tibial entry uses the user-defined superior-envelope rule (maximum patient-RAS Z at the requested X/Y) on the currently loaded tibial display surface; this is not a clinician-reviewed plateau or articular annotation.";
const LEGACY_UNREVIEWED_PLATEAU_WARNING =
  "Tibial plateau region is not reviewed: the entry handle is constrained to the imported tibia mask, while plateau-specific placement remains not evaluated.";
const TIBIAL_XY_FALLBACK_WARNING_PREFIX = "Tibial superior-envelope X/Y fallback:";

const HANDLE_DISTANCE_EPSILON_MM = 1e-6;

interface ProjectedBonePoint {
  point: Vector3;
  attachment: ChannelSurfaceAttachment;
}

export function withTibialSuperiorEnvelopeWarnings(
  warnings: readonly string[],
  attachment: ChannelSurfaceAttachment | null | undefined,
): string[] {
  const next = warnings.filter(
    (warning) => warning !== LEGACY_UNREVIEWED_PLATEAU_WARNING && !warning.startsWith(TIBIAL_XY_FALLBACK_WARNING_PREFIX),
  );
  if (!next.includes(TIBIAL_SUPERIOR_ENVELOPE_WARNING)) next.push(TIBIAL_SUPERIOR_ENVELOPE_WARNING);
  const provenance = attachment?.constraintProvenance;
  if (provenance?.resolution === "nearest_xy_fallback") {
    next.push(
      `${TIBIAL_XY_FALLBACK_WARNING_PREFIX} the unregistered requested X/Y was outside the derived tibial surface footprint and moved ${provenance.xyFallbackDistanceMm.toFixed(1)} mm to the nearest supported X/Y before selecting maximum Z. Clinician repositioning is required.`,
    );
  }
  return next;
}

function vector3(point: readonly number[]): Vector3 {
  return [point[0], point[1], point[2]];
}

function isFiniteVector3(point: readonly number[]): boolean {
  return point.length === 3 && point.every(Number.isFinite);
}

function effectiveDepthMm(channel: ChannelPlan): number | null {
  const instrumentSetting = channel.instrumentChain.depthOrFullTunnelSetting;
  const depth = instrumentSetting.mode === "depth"
    ? instrumentSetting.depthMm
    : channel.depthMm;
  return depth !== null && Number.isFinite(depth) && depth > 0 ? depth : null;
}

function attachmentFromProjection(
  projection: SurfaceProjection,
  bone: Bone,
  requestedPoint: Vector3,
  reviewState: ChannelSurfaceAttachment["reviewState"],
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
    reviewState,
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

function projectToTibialSuperiorEnvelope(
  requestedPoint: Vector3,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ProjectedBonePoint | null {
  let best: { projection: SurfaceProjection; meshId: string; resolutionRank: number; xyDistanceMm: number } | null = null;
  for (const mesh of anatomyMeshes) {
    if (mesh.anatomyBone !== "tibia") continue;
    const projection = projectPatientRasPointToTibialSuperiorEnvelope(requestedPoint, mesh);
    if (projection.status !== "projected" || projection.constraint.kind !== "tibial_superior_envelope") continue;
    const resolutionRank = projection.constraint.resolution === "vertical_intersection" ? 0 : 1;
    const xyDistanceMm = projection.constraint.xyDistanceMm;
    const z = projection.closestPointPatientRasMm[2];
    const bestZ = best?.projection.closestPointPatientRasMm[2] ?? -Infinity;
    if (
      best === null ||
      resolutionRank < best.resolutionRank ||
      (resolutionRank === best.resolutionRank && xyDistanceMm < best.xyDistanceMm) ||
      (resolutionRank === best.resolutionRank && xyDistanceMm === best.xyDistanceMm && z > bestZ) ||
      (
        resolutionRank === best.resolutionRank &&
        xyDistanceMm === best.xyDistanceMm &&
        z === bestZ &&
        `${mesh.id}:${projection.triangle.faceIndex}`.localeCompare(`${best.meshId}:${best.projection.triangle.faceIndex}`) < 0
      )
    ) {
      best = { projection, meshId: mesh.id, resolutionRank, xyDistanceMm };
    }
  }
  if (best === null) return null;
  return {
    point: vector3(best.projection.closestPointPatientRasMm),
    attachment: attachmentFromProjection(
      best.projection,
      "tibia",
      requestedPoint,
      "user_defined_not_clinician_approved",
    ),
  };
}

function projectToNearestWholeBoneSurface(
  requestedPoint: Vector3,
  bone: Bone,
  anatomyMeshes: readonly ViewerMeshPayload[],
  reviewState: ChannelSurfaceAttachment["reviewState"],
): ProjectedBonePoint | null {
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
        mesh.id.localeCompare(best.meshId) < 0
      )
    ) {
      best = { projection, meshId: mesh.id };
    }
  }
  if (best === null) return null;
  return {
    point: vector3(best.projection.closestPointPatientRasMm),
    attachment: attachmentFromProjection(best.projection, bone, requestedPoint, reviewState),
  };
}

function centerlineWithAperture(
  centerline: CenterlineDefinition,
  aperture: Vector3,
  direction?: Vector3,
  preservedEndpoint?: Vector3,
): CenterlineDefinition {
  switch (centerline.kind) {
    case "rigid":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        ...(direction ? { directionPatientRas: direction } : {}),
      };
    case "flexible":
      return {
        ...centerline,
        aperturePatientRasMm: aperture,
        ...(direction ? { intraosseousDirectionPatientRas: direction } : {}),
        accessControlPointsPatientRasMm: centerline.accessControlPointsPatientRasMm.map(
          (point, index) => index === 0 ? aperture : point,
        ),
      };
    case "polyline": {
      if (preservedEndpoint && centerline.pointsPatientRasMm.length < 2) {
        return { ...centerline, pointsPatientRasMm: [aperture, preservedEndpoint] };
      }
      return {
        ...centerline,
        pointsPatientRasMm: centerline.pointsPatientRasMm.map(
          (point, index) => index === 0 ? aperture : point,
        ),
      };
    }
  }
}

function centerlineWithEndpoint(
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

function instrumentChainWithDepth(
  chain: InstrumentChain,
  depthMm: number,
): InstrumentChain {
  if (chain.depthOrFullTunnelSetting.mode !== "depth") return chain;
  return {
    ...chain,
    depthOrFullTunnelSetting: {
      ...chain.depthOrFullTunnelSetting,
      depthMm,
    },
    userVerified: false,
    verification: null,
    // A changed depth cannot retain a verified-complete display state.
    completionState: chain.completionState === "complete" ? "warning" : chain.completionState,
  };
}

function withRecomputedEndpoint(
  channel: ChannelPlan,
  endpoint: Vector3,
  endpointSurfaceAttachment: ChannelSurfaceAttachment | null | undefined,
): ChannelPlan {
  const delta: Vector3 = [
    endpoint[0] - channel.aperture[0],
    endpoint[1] - channel.aperture[1],
    endpoint[2] - channel.aperture[2],
  ];
  const depthMm = Math.hypot(delta[0], delta[1], delta[2]);
  if (!Number.isFinite(depthMm) || depthMm <= HANDLE_DISTANCE_EPSILON_MM) return channel;
  const direction: Vector3 = [delta[0] / depthMm, delta[1] / depthMm, delta[2] / depthMm];
  return {
    ...channel,
    vector: direction,
    depthMm,
    endpointSurfaceAttachment,
    centerline: centerlineWithEndpoint(channel.centerline, channel.aperture, endpoint, direction),
    instrumentChain: instrumentChainWithDepth(channel.instrumentChain, depthMm),
  };
}

function withPreservedSocketDepthTrajectory(
  channel: ChannelPlan,
  surfaceStart: Vector3,
  endpointSurfaceAttachment: ChannelSurfaceAttachment,
): ChannelPlan {
  const delta: Vector3 = [
    surfaceStart[0] - channel.aperture[0],
    surfaceStart[1] - channel.aperture[1],
    surfaceStart[2] - channel.aperture[2],
  ];
  const surfaceDistanceMm = Math.hypot(delta[0], delta[1], delta[2]);
  if (!Number.isFinite(surfaceDistanceMm) || surfaceDistanceMm <= HANDLE_DISTANCE_EPSILON_MM) {
    return channel;
  }
  const direction: Vector3 = [
    delta[0] / surfaceDistanceMm,
    delta[1] / surfaceDistanceMm,
    delta[2] / surfaceDistanceMm,
  ];
  const depthMm = effectiveDepthMm(channel);
  const socketEndpoint: Vector3 | null = depthMm === null
    ? null
    : [
        channel.aperture[0] + direction[0] * depthMm,
        channel.aperture[1] + direction[1] * depthMm,
        channel.aperture[2] + direction[2] * depthMm,
      ];
  return {
    ...channel,
    vector: direction,
    endpointSurfaceAttachment,
    centerline: socketEndpoint
      ? centerlineWithEndpoint(channel.centerline, channel.aperture, socketEndpoint, direction)
      : centerlineWithAperture(channel.centerline, channel.aperture, direction),
    // This outer-cortex Start controls only trajectory. The clinician-selected
    // socket depth and its instrument-chain selection remain untouched.
    depthMm: channel.depthMm,
    instrumentChain: channel.instrumentChain,
  };
}

function withExteriorTrajectoryRod(
  channel: ChannelPlan,
  rodEnd: Vector3,
): ChannelPlan {
  // The Viewer Trajectory handle is outside bone, while the analytic channel
  // vector runs inward from the surface Start. Keep the directions opposed.
  const inwardDelta: Vector3 = [
    channel.aperture[0] - rodEnd[0],
    channel.aperture[1] - rodEnd[1],
    channel.aperture[2] - rodEnd[2],
  ];
  const magnitude = Math.hypot(inwardDelta[0], inwardDelta[1], inwardDelta[2]);
  if (!Number.isFinite(magnitude) || magnitude <= HANDLE_DISTANCE_EPSILON_MM) return channel;
  const direction: Vector3 = [
    inwardDelta[0] / magnitude,
    inwardDelta[1] / magnitude,
    inwardDelta[2] / magnitude,
  ];
  return {
    ...channel,
    vector: direction,
    endpointSurfaceAttachment: null,
    centerline: centerlineWithAperture(channel.centerline, channel.aperture, direction),
    surfacePlacement: {
      state: "clinician_edited",
      method: "manual_trajectory_drag",
      meshIds: channel.apertureSurfaceAttachment?.meshId
        ? [channel.apertureSurfaceAttachment.meshId]
        : [],
      endpointMethod: "preserved_depth",
    },
  };
}

function withBlindSocketTipTrajectory(
  channel: ChannelPlan,
  requestedTip: Vector3,
): ChannelPlan {
  const delta: Vector3 = [
    requestedTip[0] - channel.aperture[0],
    requestedTip[1] - channel.aperture[1],
    requestedTip[2] - channel.aperture[2],
  ];
  const magnitude = Math.hypot(delta[0], delta[1], delta[2]);
  const depthMm = effectiveDepthMm(channel);
  if (
    !Number.isFinite(magnitude) || magnitude <= HANDLE_DISTANCE_EPSILON_MM ||
    depthMm === null
  ) return channel;
  const direction: Vector3 = [delta[0] / magnitude, delta[1] / magnitude, delta[2] / magnitude];
  const exactTip: Vector3 = [
    channel.aperture[0] + direction[0] * depthMm,
    channel.aperture[1] + direction[1] * depthMm,
    channel.aperture[2] + direction[2] * depthMm,
  ];
  return {
    ...channel,
    vector: direction,
    endpointSurfaceAttachment: null,
    centerline: centerlineWithEndpoint(channel.centerline, channel.aperture, exactTip, direction),
    surfacePlacement: {
      state: "clinician_edited",
      method: "manual_trajectory_drag",
      meshIds: channel.apertureSurfaceAttachment?.meshId
        ? [channel.apertureSurfaceAttachment.meshId]
        : [],
      endpointMethod: "blind_socket_tip",
    },
  };
}

/**
 * Applies a committed aperture or endpoint Viewer edit without mutating its
 * inputs. Intra-articular tibial entries use the user-defined maximum-Z
 * superior envelope; other surface handles use the exact nearest triangle on
 * the declared bone. The endpoint event represents the outer-cortex Start for
 * ordinary sockets and full tunnels. For an exterior-controlled anchor or
 * guide pin it represents MAT's free-space rod end, so the inward trajectory
 * is the exact opposite direction and depth remains independent. Unresolved
 * surface projections never fall back to a mid-air point.
 */
export function applySurfaceConstrainedHandleCommit(
  channel: ChannelPlan,
  procedure: ProcedureIdentity | null | undefined,
  change: ViewerHandleChange,
  patientAnatomyMeshes: readonly ViewerMeshPayload[] | null | undefined,
): ChannelPlan {
  if (
    change.phase !== "commit" ||
    change.channelId !== channel.id ||
    (change.kind !== "aperture" && change.kind !== "endpoint") ||
    !isFiniteVector3(change.position)
  ) {
    return channel;
  }

  const requestedPoint = vector3(change.position);
  const anatomyMeshes = patientAnatomyMeshes ?? [];
  const tether = classifyChannelEntryTether(channel, procedure);
  const trajectoryControlMode = resolvedTrajectoryControlMode(channel);

  if (change.kind === "endpoint" && trajectoryControlMode === "exterior_rod") {
    return withExteriorTrajectoryRod(channel, requestedPoint);
  }
  if (change.kind === "endpoint" && trajectoryControlMode === "blind_socket_tip") {
    return withBlindSocketTipTrajectory(channel, requestedPoint);
  }

  if (change.kind === "aperture") {
    const usesSuperiorEnvelope = tether.kind === "intra_articular_tibial_plateau";
    const projection = usesSuperiorEnvelope
      ? projectToTibialSuperiorEnvelope(requestedPoint, anatomyMeshes)
      : projectToNearestWholeBoneSurface(
        requestedPoint,
        channel.bone,
        anatomyMeshes,
        "surface_review_not_evaluated",
      );
    if (!projection) return channel;
    const aperture = projection.point;
    const patientTibiaExists = anatomyMeshes.some((mesh) => mesh.anatomyBone === "tibia");
    const warnings = usesSuperiorEnvelope && patientTibiaExists
      ? withTibialSuperiorEnvelopeWarnings(channel.warnings, projection?.attachment)
      : channel.warnings.filter((warning) => warning !== LEGACY_UNREVIEWED_PLATEAU_WARNING);
    const surfacePlacement = {
      state: "clinician_edited" as const,
      method: "manual_surface_drag" as const,
      meshIds: [
        projection.attachment.meshId,
        channel.endpointSurfaceAttachment?.meshId,
      ].filter((meshId, index, values): meshId is string =>
        Boolean(meshId) && values.indexOf(meshId) === index),
      endpointMethod: trajectoryControlMode === "blind_socket_tip"
        ? "blind_socket_tip" as const
        : trajectoryControlMode === "exterior_rod"
          ? "preserved_depth" as const
          : channel.endpointSurfaceAttachment
            ? channel.surfacePlacement?.endpointMethod ?? "nearest_surface_projection" as const
            : "not_available" as const,
    };

    const moved = {
      ...channel,
      aperture,
      apertureSurfaceAttachment: projection.attachment,
      surfacePlacement,
      warnings,
      centerline: centerlineWithAperture(channel.centerline, aperture),
    };
    if (trajectoryControlMode === "exterior_rod" || trajectoryControlMode === "blind_socket_tip") {
      return {
        ...moved,
        endpointSurfaceAttachment: null,
        surfacePlacement: {
          ...surfacePlacement,
          meshIds: [projection.attachment.meshId],
          endpointMethod: trajectoryControlMode === "blind_socket_tip"
            ? "blind_socket_tip"
            : "preserved_depth",
        },
      };
    }
    const priorSurfaceAttachment = channel.endpointSurfaceAttachment;
    const priorSurfaceStart = priorSurfaceAttachment?.attachedPointPatientRasMm;
    if (priorSurfaceAttachment && priorSurfaceStart && isFiniteVector3(priorSurfaceStart)) {
      const start = vector3(priorSurfaceStart);
      if (channel.fullThickness) {
        return {
          ...withRecomputedEndpoint(moved, start, priorSurfaceAttachment),
          surfacePlacement,
        };
      }
      return {
        ...withPreservedSocketDepthTrajectory(
          moved,
          start,
          priorSurfaceAttachment,
        ),
        surfacePlacement,
      };
    }

    return moved;
  }

  const projection = projectToNearestWholeBoneSurface(
    requestedPoint,
    channel.bone,
    anatomyMeshes,
    "surface_review_not_evaluated",
  );
  if (!projection) return channel;
  const recomputed = channel.fullThickness
    ? withRecomputedEndpoint(channel, projection.point, projection.attachment)
    : withPreservedSocketDepthTrajectory(channel, projection.point, projection.attachment);
  return {
    ...recomputed,
    surfacePlacement: {
      state: "clinician_edited",
      method: "manual_surface_drag",
      meshIds: [channel.apertureSurfaceAttachment?.meshId, projection.attachment.meshId]
        .filter((id, index, values): id is string => Boolean(id) && values.indexOf(id) === index),
      endpointMethod: "nearest_surface_projection",
    },
  };
}

/**
 * Applies one numeric patient-RAS aperture/vector component without collapsing
 * a flexible or polyline centerline into a rigid one. Numeric edits are
 * explicit coordinates, so any affected surface attachment is invalidated.
 */
export function applyNumericVectorComponentEdit(
  channel: ChannelPlan,
  field: "aperture" | "vector",
  index: 0 | 1 | 2,
  value: number,
): ChannelPlan {
  if (!Number.isFinite(value)) return channel;
  const tuple: [number, number, number] = [
    channel[field][0],
    channel[field][1],
    channel[field][2],
  ];
  tuple[index] = value;

  let centerline: CenterlineDefinition;
  if (field === "aperture") {
    centerline = centerlineWithAperture(channel.centerline, tuple);
  } else if (channel.centerline.kind === "rigid") {
    centerline = { ...channel.centerline, directionPatientRas: tuple };
  } else if (channel.centerline.kind === "flexible") {
    centerline = { ...channel.centerline, intraosseousDirectionPatientRas: tuple };
  } else {
    // Polyline control points are explicit geometry and are not discarded by
    // editing the analytic direction field.
    centerline = channel.centerline;
  }

  const trajectoryControlMode = resolvedTrajectoryControlMode(channel);
  return {
    ...channel,
    [field]: tuple,
    centerline,
    ...(field === "aperture"
      ? { apertureSurfaceAttachment: null, endpointSurfaceAttachment: null }
      : { endpointSurfaceAttachment: null }),
    surfacePlacement: {
      state: "clinician_edited",
      method: "manual_numeric_edit",
      meshIds: [],
      endpointMethod: trajectoryControlMode === "blind_socket_tip"
        ? "blind_socket_tip"
        : trajectoryControlMode === "exterior_rod"
          ? "preserved_depth"
          : "not_available",
    },
  };
}

/**
 * Numeric socket depth is independent of its outer-cortex trajectory Start.
 * Full-tunnel depth still describes the cortical endpoint and invalidates that
 * attachment when edited directly.
 */
export function applyChannelDepthGeometryEdit(
  channel: ChannelPlan,
  depthMm: number | null,
): ChannelPlan {
  const trajectoryControlMode = resolvedTrajectoryControlMode(channel);
  const preserveSurfaceStart = trajectoryControlMode === "outer_cortex_surface" && !channel.fullThickness;
  const endpointSurfaceAttachment = preserveSurfaceStart
    ? channel.endpointSurfaceAttachment ?? null
    : null;
  return {
    ...channel,
    depthMm,
    endpointSurfaceAttachment,
    surfacePlacement: {
      state: "clinician_edited",
      method: "manual_numeric_edit",
      meshIds: [
        channel.apertureSurfaceAttachment?.meshId,
        endpointSurfaceAttachment?.meshId,
      ].filter((meshId, index, values): meshId is string =>
        Boolean(meshId) && values.indexOf(meshId) === index),
      endpointMethod: trajectoryControlMode === "blind_socket_tip"
        ? "blind_socket_tip"
        : trajectoryControlMode === "exterior_rod"
          ? "preserved_depth"
          : endpointSurfaceAttachment
            ? channel.surfacePlacement?.endpointMethod ?? "nearest_surface_projection"
            : "not_available",
    },
  };
}
