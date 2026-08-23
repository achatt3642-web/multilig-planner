import type { PlanCase } from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import { initializePendingChannelSurfacePlacements } from "./channelSurfaceInitialization";
import { activeVariant } from "./planOperations";
import {
  readSimplifiedSelection,
  replaceSimplifiedProcedure,
  validateSimplifiedSelection,
  type SimplifiedProcedureIdentity,
  type SimplifiedTechniqueSelection,
} from "./simplifiedTechniqueFlow";

export interface ConfiguredSimplifiedProcedure {
  plan: PlanCase;
  channelIds: string[];
}

const sameBoneChoice = (
  left: SimplifiedTechniqueSelection["femur"],
  right: SimplifiedTechniqueSelection["femur"],
): boolean => left === null
  ? right === null
  : right !== null &&
    left.bundle === right.bundle &&
    left.preparation === right.preparation &&
    left.count === right.count &&
    left.diameterMm === right.diameterMm &&
    left.depthMm === right.depthMm;

export function simplifiedTechniqueSelectionsEqual(
  left: SimplifiedTechniqueSelection | null | undefined,
  right: SimplifiedTechniqueSelection | null | undefined,
): boolean {
  return left?.procedure === right?.procedure &&
    left?.rootLocation === right?.rootLocation &&
    sameBoneChoice(left?.femur ?? null, right?.femur ?? null) &&
    sameBoneChoice(left?.tibia ?? null, right?.tibia ?? null);
}

export function configuredSimplifiedSelection(
  plan: PlanCase,
  procedureIdentity: SimplifiedProcedureIdentity,
): SimplifiedTechniqueSelection | null {
  const activeProcedureIds = new Set(activeVariant(plan).channels.map((channel) => channel.procedureId));
  const procedure = plan.procedures.find((candidate) =>
    candidate.structure === procedureIdentity && activeProcedureIds.has(candidate.id),
  );
  return readSimplifiedSelection(procedure);
}

/**
 * Replaces and initializes one procedure as a single pure transaction.
 * Unrelated channels are deliberately out of scope so a PLC update cannot
 * project, retarget, or otherwise modify an authored MCL trajectory.
 */
export function configureSimplifiedProcedure(
  current: PlanCase,
  selection: SimplifiedTechniqueSelection,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ConfiguredSimplifiedProcedure {
  const replaced = replaceSimplifiedProcedure(current, selection);
  const targetProcedureIds = new Set(
    replaced.procedures
      .filter((procedure) => procedure.structure === selection.procedure)
      .map((procedure) => procedure.id),
  );
  const channelIds = activeVariant(replaced).channels
    .filter((channel) => targetProcedureIds.has(channel.procedureId))
    .map((channel) => channel.id);
  return {
    plan: initializePendingChannelSurfacePlacements(
      replaced,
      anatomyMeshes,
      { channelIds: new Set(channelIds) },
    ),
    channelIds,
  };
}

/**
 * Applies only a complete, meaningfully changed selection. Intermediate
 * choices deliberately leave the last valid geometry in place until the
 * clinician completes the plan for every required bone.
 */
export function autoConfigureSimplifiedProcedure(
  current: PlanCase,
  selection: SimplifiedTechniqueSelection,
  anatomyMeshes: readonly ViewerMeshPayload[],
): ConfiguredSimplifiedProcedure | null {
  if (validateSimplifiedSelection(selection).length > 0) return null;
  if (simplifiedTechniqueSelectionsEqual(
    configuredSimplifiedSelection(current, selection.procedure),
    selection,
  )) return null;
  return configureSimplifiedProcedure(current, selection, anatomyMeshes);
}
