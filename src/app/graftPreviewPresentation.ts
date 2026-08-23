import type { ProcedureIdentity } from "../domain/types";
import type { ReconstructedLigamentBundleRole } from "./reconstructedLigamentGeometry";
import { procedureLabel } from "./planOperations";
import { SIMPLIFIED_PROCEDURES } from "./simplifiedTechniqueFlow";

export function graftPreviewTitle(graft: {
  procedure: ProcedureIdentity;
  bundleRole: ReconstructedLigamentBundleRole | null;
}): string {
  const procedureTitle = SIMPLIFIED_PROCEDURES.find((item) => item.id === graft.procedure)?.label ??
    procedureLabel(graft.procedure);
  return graft.bundleRole ? `${procedureTitle} ${graft.bundleRole}` : procedureTitle;
}
