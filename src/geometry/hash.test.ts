import { describe, expect, it } from "vitest";
import { stableHash, stableStringify } from "./hash";

describe("stable structural hashing", () => {
  it("is independent of object key insertion order", () => {
    const first = { channel: "acl", geometry: { diameterMm: 9, depthMm: 25 } };
    const second = { geometry: { depthMm: 25, diameterMm: 9 }, channel: "acl" };
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(stableHash(first)).toBe(stableHash(second));
  });

  it("changes when a geometry-critical value changes", () => {
    expect(stableHash({ diameterMm: 9, depthMm: 25 })).not.toBe(
      stableHash({ diameterMm: 9, depthMm: 26 }),
    );
  });

  it("rejects non-finite and circular values", () => {
    expect(() => stableHash({ diameterMm: Number.NaN })).toThrow(/non-finite/);
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => stableHash(circular)).toThrow(/circular/);
  });
});
