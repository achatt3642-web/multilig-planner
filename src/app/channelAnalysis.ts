import type { ChannelPlan } from "../domain/types";
import type { CollisionGeometry } from "../geometry/collision";

/**
 * Numeric values may be present solely to render a generic visual template.
 * Until the clinician explicitly changes or confirms them, keep all clearance
 * results dimension-incomplete even though the Viewer can show the volume.
 */
export function requireClinicianSelectedDimensions(
  geometry: CollisionGeometry,
  channel: ChannelPlan | undefined,
): CollisionGeometry {
  if (channel?.verificationState !== "needs_dimensions") return geometry;
  const missingDimensions = [
    ...new Set([...geometry.missingDimensions, "clinician-selected planning dimensions"]),
  ];
  return {
    ...geometry,
    complete: false,
    missingDimensions,
    geometryHash: `${geometry.geometryHash}:dimensions-unconfirmed`,
  };
}
