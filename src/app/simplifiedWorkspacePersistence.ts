import type { PlanCase, ProcedureIdentity } from "../domain/types";
import type { ViewerPlanningScene } from "../viewer/types";
import {
  SIMPLIFIED_PROCEDURES,
  decodeSimplifiedTechniqueSelection,
  type SimplifiedProcedureIdentity,
  type SimplifiedTechniqueSelection,
} from "./simplifiedTechniqueFlow";

export const SIMPLIFIED_WORKSPACE_KEY = "multilig-planner:simplified-workspace:v1";

export interface SimplifiedWorkspaceDefaults {
  format: "multilig-simplified-workspace";
  version: 3;
  planId: string;
  savedAt: string;
  highlightedProcedures: SimplifiedProcedureIdentity[];
  focusedProcedure: SimplifiedProcedureIdentity | null;
  selectedChannelId: string | null;
  /** Graft previews are opt-in; absent keys never trigger display-mesh generation. */
  visibleGraftVisibilityKeys: string[];
  drafts: Partial<Record<SimplifiedProcedureIdentity, SimplifiedTechniqueSelection>>;
  stepIndex: number;
  layerVisibility: ViewerPlanningScene["layerVisibility"];
  globalOpacity: number;
}

type WorkspaceStorage = Pick<Storage, "getItem" | "setItem">;

const allowedProcedures = new Set<ProcedureIdentity>(SIMPLIFIED_PROCEDURES.map((item) => item.id));

function isProcedure(value: unknown): value is SimplifiedProcedureIdentity {
  return typeof value === "string" && allowedProcedures.has(value as ProcedureIdentity);
}

function sanitizeDrafts(value: unknown): SimplifiedWorkspaceDefaults["drafts"] {
  if (!value || typeof value !== "object") return {};
  const drafts: SimplifiedWorkspaceDefaults["drafts"] = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isProcedure(key) || !candidate || typeof candidate !== "object") continue;
    const selection = decodeSimplifiedTechniqueSelection(candidate);
    if (!selection || selection.procedure !== key) continue;
    drafts[key] = structuredClone(selection);
  }
  return drafts;
}

function clampOpacity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0.2, value))
    : 1;
}

export function createSimplifiedWorkspaceDefaults(
  plan: PlanCase,
  state: Omit<SimplifiedWorkspaceDefaults, "format" | "version" | "planId" | "savedAt">,
  savedAt = new Date().toISOString(),
): SimplifiedWorkspaceDefaults {
  const highlightedProcedures = [...new Set(state.highlightedProcedures.filter(isProcedure))];
  const focusedProcedure = state.focusedProcedure && highlightedProcedures.includes(state.focusedProcedure)
    ? state.focusedProcedure
    : highlightedProcedures.at(-1) ?? null;
  const activeChannelIds = new Set(
    plan.variants.find((variant) => variant.id === plan.activeVariantId)?.channels.map((channel) => channel.id) ?? [],
  );
  return {
    format: "multilig-simplified-workspace",
    version: 3,
    planId: plan.id,
    savedAt,
    highlightedProcedures,
    focusedProcedure,
    selectedChannelId: state.selectedChannelId && activeChannelIds.has(state.selectedChannelId)
      ? state.selectedChannelId
      : null,
    visibleGraftVisibilityKeys: [...new Set(
      state.visibleGraftVisibilityKeys.filter((value) => typeof value === "string" && value.length > 0),
    )],
    drafts: sanitizeDrafts(state.drafts),
    stepIndex: Number.isInteger(state.stepIndex) && state.stepIndex >= 0 ? state.stepIndex : 0,
    layerVisibility: structuredClone(state.layerVisibility),
    globalOpacity: clampOpacity(state.globalOpacity),
  };
}

export function saveSimplifiedWorkspaceDefaults(
  storage: WorkspaceStorage,
  plan: PlanCase,
  state: Omit<SimplifiedWorkspaceDefaults, "format" | "version" | "planId" | "savedAt">,
): SimplifiedWorkspaceDefaults {
  const defaults = createSimplifiedWorkspaceDefaults(plan, state);
  storage.setItem(SIMPLIFIED_WORKSPACE_KEY, JSON.stringify(defaults));
  return defaults;
}

export function loadSimplifiedWorkspaceDefaults(
  storage: WorkspaceStorage,
  plan: PlanCase,
): SimplifiedWorkspaceDefaults | null {
  const json = storage.getItem(SIMPLIFIED_WORKSPACE_KEY);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<Omit<SimplifiedWorkspaceDefaults, "version">> & { version?: number };
    if (
      parsed.format !== "multilig-simplified-workspace" ||
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) ||
      parsed.planId !== plan.id ||
      !Array.isArray(parsed.highlightedProcedures) ||
      !parsed.layerVisibility ||
      typeof parsed.layerVisibility !== "object"
    ) return null;
    const legacyWorkspace = parsed.version === 1 || parsed.version === 2;
    return createSimplifiedWorkspaceDefaults(plan, {
      highlightedProcedures: parsed.highlightedProcedures.filter(isProcedure),
      focusedProcedure: isProcedure(parsed.focusedProcedure) ? parsed.focusedProcedure : null,
      selectedChannelId: typeof parsed.selectedChannelId === "string" ? parsed.selectedChannelId : null,
      // Versions 1 and 2 stored an inverse hidden-list, which made an empty
      // list mean "render every graft". Migrating those sessions to an empty
      // opt-in list prevents an old browser session from unexpectedly enabling
      // expensive previews on startup.
      visibleGraftVisibilityKeys: !legacyWorkspace && Array.isArray(parsed.visibleGraftVisibilityKeys)
        ? parsed.visibleGraftVisibilityKeys.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [],
      drafts: sanitizeDrafts(parsed.drafts),
      stepIndex: typeof parsed.stepIndex === "number" ? parsed.stepIndex : 0,
      layerVisibility: parsed.layerVisibility as ViewerPlanningScene["layerVisibility"],
      globalOpacity: clampOpacity(parsed.globalOpacity),
    }, typeof parsed.savedAt === "string" ? parsed.savedAt : new Date().toISOString());
  } catch {
    return null;
  }
}
