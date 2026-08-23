import type {
  ChannelPlan,
  GeometryType,
  TrajectoryControlMode,
  Vector3,
} from "../domain/types";
import { resolvedChannelAxis } from "./resolvedChannelGeometry";

/** A compact exterior manipulation reach derived from MAT Planner's anchor control. */
export const ANCHOR_TRAJECTORY_ROD_LENGTH_MM = 28;

export type ChannelStartPointSource =
  | "outer_cortex_surface_attachment"
  | "blind_socket_tip"
  | "anchor_aperture_surface_attachment";

export interface ResolvedChannelStartPoint {
  pointPatientRasMm: Vector3;
  source: ChannelStartPointSource;
}

export interface ResolveChannelStartPointOptions {
  /**
   * When supplied by the Viewer, an outer-cortex attachment is accepted only
   * if its source surface is still present in the rendered anatomy.
   */
  eligibleSurfaceMeshIds?: ReadonlySet<string>;
}

const SURFACE_ATTACHMENT_APERTURE_TOLERANCE_MM = 0.1;

const GUIDE_PIN_SOCKET_GEOMETRY_TYPES = new Set<GeometryType>([
  "antegrade_blind_socket",
  "retrograde_socket",
  "flexible_reamed_socket",
  "stepped_button_tunnel",
]);

export function isGuidePinSocketGeometry(
  channelOrGeometryType: ChannelPlan | GeometryType,
): boolean {
  const geometryType = typeof channelOrGeometryType === "string"
    ? channelOrGeometryType
    : channelOrGeometryType.geometryType;
  return GUIDE_PIN_SOCKET_GEOMETRY_TYPES.has(geometryType);
}

export function defaultTrajectoryControlMode(channel: ChannelPlan): TrajectoryControlMode {
  if (channel.geometryType === "anchor_pilot") return "exterior_rod";
  if (channel.noLargeTunnel || channel.geometryType === "onlay_no_large_tunnel") return "none";
  return "outer_cortex_surface";
}

export function resolvedTrajectoryControlMode(channel: ChannelPlan): TrajectoryControlMode {
  if (channel.geometryType === "anchor_pilot") return "exterior_rod";
  if (channel.noLargeTunnel || channel.geometryType === "onlay_no_large_tunnel") return "none";
  if (channel.geometryType === "rigid_pin" && channel.trajectoryControlMode === "exterior_rod") {
    return "exterior_rod";
  }
  if (channel.trajectoryControlMode === "blind_socket_tip" && isGuidePinSocketGeometry(channel)) {
    return "blind_socket_tip";
  }
  if (channel.trajectoryControlMode === "outer_cortex_surface") return "outer_cortex_surface";
  return defaultTrajectoryControlMode(channel);
}

/** The analytic deep endpoint of a blind socket; never promoted to a bone-surface observation. */
export function blindSocketTipPatientRas(channel: ChannelPlan): Vector3 | null {
  if (resolvedTrajectoryControlMode(channel) !== "blind_socket_tip") return null;
  const axis = resolvedChannelAxis(channel);
  return axis ? [axis.end.x, axis.end.y, axis.end.z] : null;
}

/**
 * Exterior-controlled channel vectors point inward from the bony Start point.
 * The exterior endpoint of the coaxial manipulation rod is a trajectory
 * control, not a Start point.
 */
export function anchorTrajectoryRodEnd(
  channel: ChannelPlan,
  lengthMm = ANCHOR_TRAJECTORY_ROD_LENGTH_MM,
): Vector3 | null {
  if (resolvedTrajectoryControlMode(channel) !== "exterior_rod" || !channel.aperture.every(Number.isFinite)) return null;
  const magnitude = Math.hypot(channel.vector[0], channel.vector[1], channel.vector[2]);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9 || !Number.isFinite(lengthMm) || lengthMm <= 0) {
    return null;
  }
  return [
    channel.aperture[0] - channel.vector[0] / magnitude * lengthMm,
    channel.aperture[1] - channel.vector[1] / magnitude * lengthMm,
    channel.aperture[2] - channel.vector[2] / magnitude * lengthMm,
  ];
}

/**
 * Resolve the exact patient-RAS coordinate used by Viewer v2 for its handle
 * labelled `Start point - …`. Exterior-controlled anchor and guide-pin starts
 * resolve from the persisted bony aperture attachment; their exterior
 * trajectory control is deliberately not a Start point. Channels without a
 * rendered Start fail closed.
 */
export function resolveChannelStartPointPatientRas(
  channel: ChannelPlan,
  options: ResolveChannelStartPointOptions = {},
): ResolvedChannelStartPoint | null {
  const mode = resolvedTrajectoryControlMode(channel);
  if (mode === "exterior_rod") {
    const attachment = channel.apertureSurfaceAttachment;
    const validAnchorSurfaceTarget = attachment?.targetKind === "whole_bone_surface" ||
      attachment?.targetKind === "tibial_superior_envelope" ||
      (attachment?.targetKind === "tibial_plateau_region" &&
        Boolean(attachment.targetRegionId) && attachment.reviewState === "approved");
    if (
      !attachment ||
      attachment.coordinateSpace !== "patient_ras" ||
      attachment.units !== "mm" ||
      attachment.bone !== channel.bone ||
      !validAnchorSurfaceTarget ||
      !channel.aperture.every(Number.isFinite) ||
      !attachment.attachedPointPatientRasMm.every(Number.isFinite) ||
      Math.hypot(
        attachment.attachedPointPatientRasMm[0] - channel.aperture[0],
        attachment.attachedPointPatientRasMm[1] - channel.aperture[1],
        attachment.attachedPointPatientRasMm[2] - channel.aperture[2],
      ) > SURFACE_ATTACHMENT_APERTURE_TOLERANCE_MM ||
      (options.eligibleSurfaceMeshIds && !options.eligibleSurfaceMeshIds.has(attachment.meshId))
    ) return null;
    return {
      // The analytic aperture is the socket origin. The attachment proves it
      // is current and on-surface; the tolerance above prevents stale drift.
      pointPatientRasMm: [...channel.aperture],
      source: "anchor_aperture_surface_attachment",
    };
  }
  if (mode === "blind_socket_tip") {
    const pointPatientRasMm = blindSocketTipPatientRas(channel);
    return pointPatientRasMm
      ? { pointPatientRasMm, source: "blind_socket_tip" }
      : null;
  }
  if (mode !== "outer_cortex_surface") return null;

  const attachment = channel.endpointSurfaceAttachment;
  if (
    !attachment ||
    attachment.coordinateSpace !== "patient_ras" ||
    attachment.units !== "mm" ||
    attachment.bone !== channel.bone ||
    attachment.targetKind !== "whole_bone_surface" ||
    !attachment.attachedPointPatientRasMm.every(Number.isFinite) ||
    (options.eligibleSurfaceMeshIds && !options.eligibleSurfaceMeshIds.has(attachment.meshId))
  ) return null;

  return {
    pointPatientRasMm: [...attachment.attachedPointPatientRasMm],
    source: "outer_cortex_surface_attachment",
  };
}
