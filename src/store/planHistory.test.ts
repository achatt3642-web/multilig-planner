import { describe, expect, it } from "vitest";
import {
  commitPlan,
  createPlanHistory,
  deserializePlan,
  redoPlan,
  serializePlan,
  stablePlanHash,
  undoPlan,
} from "./planHistory";

const initial = {
  schemaVersion: "1.0.0",
  catalogVersion: "1.0.0",
  geometryGeneratorVersion: "1.0.0",
  activeVariantId: "plan-a",
  variants: [{ id: "plan-a", channels: [] as string[] }],
};

describe("immutable plan history", () => {
  it("supports undo and redo without mutating revisions", () => {
    const history = createPlanHistory(initial);
    const changed = commitPlan(
      history,
      (plan) => ({ ...plan, variants: [{ id: "plan-a", channels: ["acl-femoral"] }] }),
      "Added ACL channel",
    );
    expect(history.present.snapshot.variants[0].channels).toEqual([]);
    expect(changed.present.snapshot.variants[0].channels).toEqual(["acl-femoral"]);
    expect(undoPlan(changed).present.geometryHash).toBe(history.present.geometryHash);
    expect(redoPlan(undoPlan(changed)).present.geometryHash).toBe(changed.present.geometryHash);
  });

  it("round-trips a frozen catalog/versioned plan identically", () => {
    const json = serializePlan(initial);
    const restored = deserializePlan<typeof initial>(json);
    expect(restored).toEqual(initial);
    expect(stablePlanHash(restored)).toBe(stablePlanHash(initial));
  });

  it("rejects edited persisted payloads", () => {
    const envelope = JSON.parse(serializePlan(initial));
    envelope.plan.catalogVersion = "changed";
    expect(() => deserializePlan(JSON.stringify(envelope))).toThrow("integrity");
  });
});
