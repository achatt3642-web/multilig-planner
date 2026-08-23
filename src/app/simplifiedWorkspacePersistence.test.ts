import { describe, expect, it } from "vitest";
import { DEFAULT_LAYER_VISIBILITY } from "./channelGeometry";
import { createSyntheticDemoCase } from "./caseFactory";
import { createEmptySimplifiedSelection } from "./simplifiedTechniqueFlow";
import {
  SIMPLIFIED_WORKSPACE_KEY,
  type SimplifiedWorkspaceDefaults,
  createSimplifiedWorkspaceDefaults,
  loadSimplifiedWorkspaceDefaults,
  saveSimplifiedWorkspaceDefaults,
} from "./simplifiedWorkspacePersistence";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe("saved simplified workspace defaults", () => {
  it("round-trips visibility, focus, selection, drafts, layers, and opacity", () => {
    const plan = createSyntheticDemoCase();
    const selectedChannelId = plan.variants[0].channels[0].id;
    const storage = memoryStorage();
    const state: Omit<SimplifiedWorkspaceDefaults, "format" | "version" | "planId" | "savedAt"> = {
      highlightedProcedures: ["ACL", "PCL"],
      focusedProcedure: "PCL" as const,
      selectedChannelId,
      hiddenGraftVisibilityKeys: ["ACL:single:femur:tibia"],
      drafts: { ACL: createEmptySimplifiedSelection("ACL") },
      stepIndex: 1,
      layerVisibility: { ...DEFAULT_LAYER_VISIBILITY, grafts: true, safety: false },
      globalOpacity: 0.65,
    };
    saveSimplifiedWorkspaceDefaults(storage, plan, state);
    const restored = loadSimplifiedWorkspaceDefaults(storage, plan);
    expect(restored).toMatchObject(state);
    expect(storage.values.has(SIMPLIFIED_WORKSPACE_KEY)).toBe(true);
  });

  it("drops stale channels and invalid procedure values without touching the plan", () => {
    const plan = createSyntheticDemoCase();
    const source = structuredClone(plan);
    const defaults = createSimplifiedWorkspaceDefaults(plan, {
      highlightedProcedures: ["ACL", "CUSTOM" as "ACL"],
      focusedProcedure: "CUSTOM" as "ACL",
      selectedChannelId: "missing-channel",
      hiddenGraftVisibilityKeys: ["MCL_POL_PMC:single:femur:tibia", "", "MCL_POL_PMC:single:femur:tibia"],
      drafts: {},
      stepIndex: -2,
      layerVisibility: { ...DEFAULT_LAYER_VISIBILITY },
      globalOpacity: 4,
    });
    expect(defaults.highlightedProcedures).toEqual(["ACL"]);
    expect(defaults.focusedProcedure).toBe("ACL");
    expect(defaults.selectedChannelId).toBeNull();
    expect(defaults.hiddenGraftVisibilityKeys).toEqual(["MCL_POL_PMC:single:femur:tibia"]);
    expect(defaults.stepIndex).toBe(0);
    expect(defaults.globalOpacity).toBe(1);
    expect(plan).toEqual(source);
  });

  it("ignores malformed, foreign-plan, or unsupported defaults", () => {
    const plan = createSyntheticDemoCase();
    const storage = memoryStorage();
    storage.setItem(SIMPLIFIED_WORKSPACE_KEY, "not-json");
    expect(loadSimplifiedWorkspaceDefaults(storage, plan)).toBeNull();
    storage.setItem(SIMPLIFIED_WORKSPACE_KEY, JSON.stringify({
      format: "multilig-simplified-workspace",
      version: 1,
      planId: "another-plan",
      highlightedProcedures: [],
      layerVisibility: DEFAULT_LAYER_VISIBILITY,
    }));
    expect(loadSimplifiedWorkspaceDefaults(storage, plan)).toBeNull();
  });
});
