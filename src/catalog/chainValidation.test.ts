import { describe, expect, it } from "vitest";
import { createIncompleteInstrumentChain } from "../presets/techniquePresets";
import { assessCatalogChain, exactSizeMmForChain, instrumentChainSelectionHash } from "./chainValidation";

describe("catalog-backed exact chain validation", () => {
  it("rejects a stale size retained from another or undocumented variant setting", () => {
    const chain = createIncompleteInstrumentChain("chain-1");
    Object.assign(chain, {
      manufacturerId: "mfr-arthrex",
      productFamilyId: "fam-arthrex-flipcutter-iii",
      productVariantId: "var-arthrex-flipcutter-iii",
      exactSizeOrProfileId: "var-arthrex-flipcutter-iii:size:6.5",
    });
    expect(exactSizeMmForChain(chain)).toBe(6.5);
    expect(assessCatalogChain(chain).incompatibleReasons.join(" ")).toMatch(/not a documented setting/i);
  });

  it("rejects a cross-manufacturer instrument while retaining it visibly", () => {
    const chain = createIncompleteInstrumentChain("chain-2");
    Object.assign(chain, {
      manufacturerId: "mfr-arthrex",
      productFamilyId: "fam-arthrex-flipcutter-iii",
      productVariantId: "var-arthrex-flipcutter-iii",
      pinInstrumentId: "inst-smith-trunav-pin",
    });
    expect(assessCatalogChain(chain).incompatibleReasons.join(" ")).toMatch(/different manufacturer/i);
  });

  it("collects source provenance and hashes every verified selection", () => {
    const chain = createIncompleteInstrumentChain("chain-3");
    Object.assign(chain, {
      manufacturerId: "mfr-smith-nephew",
      productFamilyId: "fam-smith-trunav",
      productVariantId: "var-smith-trunav",
      pinInstrumentId: "inst-smith-trunav-pin",
      cutterInstrumentId: "inst-smith-trunav",
      exactSizeOrProfileId: "var-smith-trunav:size:9",
    });
    const assessment = assessCatalogChain(chain);
    expect(assessment.sourceIds).toContain("src-smith-trunav");
    const before = instrumentChainSelectionHash(chain);
    chain.depthOrFullTunnelSetting = { mode: "depth", depthMm: 30 };
    expect(instrumentChainSelectionHash(chain)).not.toBe(before);
  });

  it("fails closed when the referenced frozen catalog snapshot is not installed", () => {
    const chain = createIncompleteInstrumentChain("chain-old-catalog");
    chain.catalogVersion = "0.9.0";
    expect(assessCatalogChain(chain).incompatibleReasons.join(" ")).toMatch(/not installed/i);
  });
});
