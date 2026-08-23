import { assessCatalogChain } from "../catalog/chainValidation";
import type { ChannelPlan } from "../domain/types";
import {
  add3,
  normalize3,
  scale3,
  type Vec3,
} from "../geometry/mesh";

export interface ResolvedChannelAxis {
  aperture: Vec3;
  inwardUnit: Vec3;
  end: Vec3;
  depthMm: number;
  boreDiameterMm: number | null;
}

/**
 * Resolves the exact diameter used by deterministic channel generation.
 * Catalog geometry wins only when the clinician has explicitly selected it.
 */
export function resolvedChannelDiameterMm(channel: ChannelPlan): number | null {
  const exactCatalogSize = assessCatalogChain(channel.instrumentChain).exactSizeMm;
  if (exactCatalogSize !== null) return exactCatalogSize;
  if (channel.diameterMm !== undefined) return channel.diameterMm;
  return channel.crossSection.kind === "circle" ? channel.crossSection.diameterMm : null;
}

/** Resolves the exact depth used by deterministic channel generation. */
export function resolvedChannelDepthMm(channel: ChannelPlan): number | null {
  return channel.instrumentChain.depthOrFullTunnelSetting.mode === "depth"
    ? channel.instrumentChain.depthOrFullTunnelSetting.depthMm
    : channel.depthMm;
}

/**
 * Resolves the coaxial guide-pin diameter used by deterministic geometry.
 * A clinician-entered planning value is authoritative after an edit. For an
 * untouched generic visual seed, an explicitly selected catalog pin wins.
 */
export function resolvedChannelGuidePinDiameterMm(channel: ChannelPlan): number | null {
  const local = channel.guidePin?.diameterMm;
  if (
    channel.guidePin?.provenance === "clinician_entered_planning_value" &&
    local !== null && local !== undefined && Number.isFinite(local) && local > 0
  ) return local;

  const catalog = assessCatalogChain(channel.instrumentChain).pinDiameterMm;
  if (catalog !== null && Number.isFinite(catalog) && catalog > 0) return catalog;
  return local !== null && local !== undefined && Number.isFinite(local) && local > 0
    ? local
    : null;
}

/**
 * Returns the analytic aperture-to-intraosseous-end axis shared by rendered
 * bone removal and reconstructed-graft presentation geometry.
 */
export function resolvedChannelAxis(channel: ChannelPlan): ResolvedChannelAxis | null {
  if (!channel.aperture.every(Number.isFinite)) return null;
  const depthMm = resolvedChannelDepthMm(channel);
  if (depthMm === null || !Number.isFinite(depthMm) || depthMm <= 0) return null;
  let inwardUnit: Vec3;
  try {
    inwardUnit = normalize3({
      x: channel.vector[0],
      y: channel.vector[1],
      z: channel.vector[2],
    }, "channel inward direction");
  } catch {
    return null;
  }
  const aperture = {
    x: channel.aperture[0],
    y: channel.aperture[1],
    z: channel.aperture[2],
  };
  return {
    aperture,
    inwardUnit,
    end: add3(aperture, scale3(inwardUnit, depthMm)),
    depthMm,
    boreDiameterMm: resolvedChannelDiameterMm(channel),
  };
}
