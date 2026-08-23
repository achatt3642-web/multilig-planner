import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_PLAN_KEY, loadInitialPlan } from "../App";
import { BUNDLED_DEMO_PLAN_ID, createBundledDemoPlan } from "../demo/bundledDemo";
import { serializePlan } from "../store/planHistory";
import { createSyntheticDemoCase } from "./caseFactory";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function installStorage(value: string | null): void {
  const values = new Map<string, string>();
  if (value !== null) values.set(LOCAL_PLAN_KEY, value);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, next: string) => values.set(key, next),
    },
  });
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

describe("initial plan selection", () => {
  it("opens the bundled knee plan on a fresh browser origin", () => {
    installStorage(null);
    expect(loadInitialPlan().id).toBe(BUNDLED_DEMO_PLAN_ID);
  });

  it("recovers from corrupt browser storage with the bundled knee plan", () => {
    installStorage("not a plan");
    expect(loadInitialPlan().id).toBe(BUNDLED_DEMO_PLAN_ID);
  });

  it("does not overwrite an explicitly saved synthetic planning state", () => {
    const saved = createSyntheticDemoCase();
    saved.variants[0].channels[0].depthMm = 31;
    installStorage(serializePlan(saved));
    const loaded = loadInitialPlan();
    expect(loaded.id).toBe(saved.id);
    expect(loaded.variants[0].channels[0].depthMm).toBe(31);
  });

  it("continues to honor an explicitly saved non-demo plan", () => {
    const saved = createSyntheticDemoCase();
    saved.id = "saved-user-plan";
    saved.deidentifiedLabel = "Saved user plan";
    installStorage(serializePlan(saved));
    expect(loadInitialPlan()).toMatchObject({ id: "saved-user-plan", deidentifiedLabel: "Saved user plan" });
  });

  it("round-trips a saved bundled demo without replacing its exact geometry", () => {
    const saved = createBundledDemoPlan();
    saved.variants[0].channels[0].depthMm = 31;
    installStorage(serializePlan(saved));
    const loaded = loadInitialPlan();
    expect(loaded.id).toBe(BUNDLED_DEMO_PLAN_ID);
    expect(loaded.variants[0].channels[0].depthMm).toBe(31);
  });
});
