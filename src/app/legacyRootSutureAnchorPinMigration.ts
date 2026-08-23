import type { ChannelPlan, PlanCase, ProcedureInstance } from "../domain/types";

const ROOT_STRUCTURES = new Set<ProcedureInstance["structure"]>([
  "MEDIAL_ROOT",
  "LATERAL_ROOT",
]);

const SIMPLIFIED_TECHNIQUE_NOTE_PREFIXES = [
  "multilig:simplified-technique:v1:",
  "multilig:simplified-technique:v2:",
] as const;

const LEGACY_POINT_ONLY_WARNING_PREFIX = "Point-only fixation location";

export const LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM = 3.5;
export const LEGACY_ROOT_SUTURE_ANCHOR_PIN_DEPTH_MM = 20;
export const LEGACY_ROOT_SUTURE_ANCHOR_PIN_WARNING =
  "The displayed 3.5 mm guide pin and 20 mm drill depth are editable generic parametric visual seeds, not a selected device, recommendation, or verified catalog dimension.";

interface SimplifiedRootTechniqueNote {
  procedure?: unknown;
  tibia?: {
    preparation?: unknown;
  } | null;
}

function parsedSimplifiedRootTechnique(
  procedure: ProcedureInstance,
): SimplifiedRootTechniqueNote | null {
  if (!ROOT_STRUCTURES.has(procedure.structure) || !procedure.notes) return null;
  const prefix = SIMPLIFIED_TECHNIQUE_NOTE_PREFIXES.find((candidate) =>
    procedure.notes!.startsWith(candidate));
  if (!prefix) return null;

  try {
    const parsed = JSON.parse(procedure.notes.slice(prefix.length)) as SimplifiedRootTechniqueNote;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      parsed.procedure !== procedure.structure ||
      parsed.tibia?.preparation !== "suture_anchor_location"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isLegacyPointOnlyRootAnchor(channel: ChannelPlan): boolean {
  if (channel.geometryType !== "onlay_no_large_tunnel") return false;
  return channel.preparationMode === "none" || (
    channel.noLargeTunnel &&
    channel.depthMm === null
  );
}

function migrateChannel(channel: ChannelPlan): ChannelPlan {
  return {
    ...channel,
    geometryType: "rigid_pin",
    crossSection: {
      kind: "circle",
      diameterMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM,
    },
    diameterMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DIAMETER_MM,
    depthMm: LEGACY_ROOT_SUTURE_ANCHOR_PIN_DEPTH_MM,
    // This channel is the guide pin itself; `guidePin` is reserved for a
    // separate coaxial pin associated with socket/tunnel geometry.
    guidePin: null,
    trajectoryControlMode: "exterior_rod",
    preparationMode: "cut",
    fullThickness: false,
    noLargeTunnel: false,
    tipOvershootMm: null,
    layers: channel.layers.map((layer) => ({
      ...layer,
      missingParameters: ["aperture", "vector", "exact dimensions", "instrument chain"],
    })),
    warnings: [
      ...channel.warnings.filter((warning) =>
        !warning.startsWith(LEGACY_POINT_ONLY_WARNING_PREFIX) &&
        warning !== LEGACY_ROOT_SUTURE_ANCHOR_PIN_WARNING),
      LEGACY_ROOT_SUTURE_ANCHOR_PIN_WARNING,
    ],
  };
}

/**
 * Upgrades the historic simplified root "suture anchor location" placeholder
 * into a finite, editable guide-pin trajectory without creating a socket.
 *
 * The migration is intentionally narrow: the root procedure note must explicitly
 * select a suture-anchor location and the channel must still have the historic
 * point-only representation. Unrelated entities retain both value and reference
 * identity, and an already-migrated plan is returned unchanged.
 */
export function migrateLegacyRootSutureAnchorPins(plan: PlanCase): PlanCase {
  const eligibleProcedureIds = new Set(plan.procedures
    .filter((procedure) => parsedSimplifiedRootTechnique(procedure) !== null)
    .map((procedure) => procedure.id));
  if (eligibleProcedureIds.size === 0) return plan;

  let changed = false;
  const variants = plan.variants.map((variant) => {
    let variantChanged = false;
    const channels = variant.channels.map((channel) => {
      if (
        !eligibleProcedureIds.has(channel.procedureId) ||
        !isLegacyPointOnlyRootAnchor(channel)
      ) return channel;
      changed = true;
      variantChanged = true;
      return migrateChannel(channel);
    });
    return variantChanged ? { ...variant, channels } : variant;
  });

  return changed ? { ...plan, variants } : plan;
}
