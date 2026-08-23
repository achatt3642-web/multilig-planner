import type {
  Bone,
  ChannelPlan,
  ProcedureIdentity,
} from "../domain/types";

/**
 * Semantic surface classification for an aperture/start handle.
 *
 * This module deliberately returns no coordinates and performs no projection or
 * snapping. A caller may use the result to choose a reviewed surface target,
 * but the clinician-authored channel aperture remains authoritative.
 */
export type ChannelEntryTetherKind =
  | "intra_articular_tibial_plateau"
  | "declared_bone_surface";

export type ChannelEntrySurfaceKey =
  | "tibia:plateau"
  | `bone:${Bone}:surface`;

export interface ChannelEntryTetherClassification {
  kind: ChannelEntryTetherKind;
  bone: Bone;
  surfaceKey: ChannelEntrySurfaceKey;
  entryLabel: string;
  targetLabel: string;
  conciseLabel: string;
}

type ChannelEntryInput = Pick<ChannelPlan, "bone" | "geometryType">;

const BONE_LABELS: Readonly<Record<Bone, string>> = {
  femur: "Femur",
  tibia: "Tibia",
  fibula: "Fibula",
  patella: "Patella",
  custom: "Custom bone",
};

type IntraArticularTibialProcedure =
  | "ACL"
  | "PCL"
  | "MEDIAL_ROOT"
  | "LATERAL_ROOT";

const INTRA_ARTICULAR_TIBIAL_ENTRY_LABELS: Readonly<
  Record<IntraArticularTibialProcedure, string>
> = {
  ACL: "ACL entry",
  PCL: "PCL entry",
  MEDIAL_ROOT: "Medial root entry",
  LATERAL_ROOT: "Lateral root entry",
};

function isIntraArticularTibialEntry(
  channel: ChannelEntryInput,
  procedure: ProcedureIdentity | null | undefined,
): procedure is IntraArticularTibialProcedure {
  if (
    channel.bone !== "tibia" ||
    !procedure ||
    !(procedure in INTRA_ARTICULAR_TIBIAL_ENTRY_LABELS)
  ) {
    return false;
  }

  // A PCL inlay trough is a posterior surface recess, not a tibial-plateau
  // aperture. Keep it tethered to the declared tibial surface.
  return channel.geometryType !== "pcl_inlay_trough";
}

export function classifyChannelEntryTether(
  channel: ChannelEntryInput,
  procedure: ProcedureIdentity | null | undefined,
): ChannelEntryTetherClassification {
  if (isIntraArticularTibialEntry(channel, procedure)) {
    const entryLabel = INTRA_ARTICULAR_TIBIAL_ENTRY_LABELS[procedure];
    const targetLabel = "Tibial plateau";
    return {
      kind: "intra_articular_tibial_plateau",
      bone: "tibia",
      surfaceKey: "tibia:plateau",
      entryLabel,
      targetLabel,
      conciseLabel: `${entryLabel} → ${targetLabel}`,
    };
  }

  const boneLabel = BONE_LABELS[channel.bone];
  const entryLabel = `${boneLabel} start`;
  const targetLabel = `${boneLabel} surface`;
  return {
    kind: "declared_bone_surface",
    bone: channel.bone,
    surfaceKey: `bone:${channel.bone}:surface`,
    entryLabel,
    targetLabel,
    conciseLabel: `${entryLabel} → ${targetLabel}`,
  };
}
