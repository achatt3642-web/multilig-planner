import { describe, expect, it } from "vitest";
import type { CollisionGeometry } from "../geometry/collision";
import { instantiateTechniquePreset } from "../presets/techniquePresets";
import { channelToGeometry } from "./channelGeometry";
import { requireClinicianSelectedDimensions } from "./channelAnalysis";

const ids = (): (() => string) => {
  let index = 0;
  return () => `anchor-analysis-${++index}`;
};

describe("generic visual-template analysis gate", () => {
  it("renders numeric anchor geometry but keeps it dimension-incomplete until clinician confirmation", () => {
    const channel = instantiateTechniquePreset("all-anchor-onlay", { createId: ids() }).channels[0];
    const rendered = channelToGeometry(channel);
    const available: CollisionGeometry = {
      ...rendered,
      complete: true,
      missingDimensions: [],
    };

    expect(channel.depthMm).toBeTypeOf("number");
    expect(channel.diameterMm).toBeTypeOf("number");
    expect(channel.verificationState).toBe("needs_dimensions");
    expect(requireClinicianSelectedDimensions(available, channel)).toMatchObject({
      complete: false,
      missingDimensions: ["clinician-selected planning dimensions"],
    });

    channel.verificationState = "needs_instrument_chain";
    expect(requireClinicianSelectedDimensions(available, channel)).toBe(available);
  });
});
