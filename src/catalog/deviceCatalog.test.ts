import { describe, expect, it } from "vitest";
import {
  CATALOG_CHECKED_AT,
  CATALOG_SOURCES,
  CATALOG_VERSION,
  DEVICE_CATALOG,
  DEVICE_CATALOG_VERSION,
  FLIPCUTTER_III_CUTTER_SIZES_MM,
  GEOMETRY_RECIPES,
  INFINITY_RETRO_SIZES_MM,
  MANUFACTURERS,
  PRECISION_FLEXIBLE_SIZES_MM,
  PRODUCT_FAMILIES,
  PRODUCT_VARIANTS,
  REGION_AVAILABILITY,
  SWITCHCUT_SIZES_MM,
  TRUNAV_SOCKET_SIZES_MM,
  TWISTR_SIZES_MM,
  VERSITOMIC_FLEXIBLE_SIZES_MM,
  getProductFamilies,
  getProductVariants,
} from "./deviceCatalog";

describe("versioned device seed catalog", () => {
  it("freezes version 1.0.0 metadata with source status and checked date", () => {
    expect(DEVICE_CATALOG_VERSION).toBe("1.0.0");
    expect(CATALOG_VERSION.version).toBe("1.0.0");
    expect(CATALOG_VERSION.immutable).toBe(true);
    expect(CATALOG_SOURCES.length).toBeGreaterThan(20);
    expect(CATALOG_SOURCES.every(({ checkedAt, status, marketOrRegion }) =>
      checkedAt === CATALOG_CHECKED_AT && Boolean(status) && /IFU/i.test(marketOrRegion)
    )).toBe(true);
    expect(DEVICE_CATALOG.version.id).toBe("catalog-multilig-1.0.0");
  });

  it("covers all seven documented manufacturers plus safe generic/local records", () => {
    const names = MANUFACTURERS.map(({ name }) => name);
    expect(names).toEqual(expect.arrayContaining([
      "Arthrex",
      "Smith+Nephew",
      "Stryker",
      "Zimmer Biomet",
      "DePuy Synthes / Mitek",
      "CONMED",
      "Medacta SportsMed",
      "Generic Parametric",
      "Institution Defined",
    ]));
    for (const manufacturer of MANUFACTURERS) {
      expect(getProductFamilies(manufacturer.id).length).toBeGreaterThan(0);
    }
    expect(MANUFACTURERS.find(({ name }) => name === "CONMED")?.aliases.join(" ")).toContain("Linvatec");
    expect(names.join(" ")).not.toContain("Anika/Parcus");
    expect(names.join(" ")).not.toContain("Cayenne");
  });

  it("contains every required named instrument/fixation family", () => {
    const familyNames = PRODUCT_FAMILIES.map(({ name }) => name).join(" | ").toLowerCase();
    [
      "flipcutter", "retroconstruction", "trunav", "pinpoint", "versitomic", "switchcut", "precision",
      "twistr", "cruciate+", "infinity", "sentinel", "graftmax", "badger", "m-ars", "mecta",
      "root", "button", "anchor", "post", "washer", "staple", "coring", "dilator",
    ].forEach((required) => expect(familyNames).toContain(required));
    expect(PRODUCT_FAMILIES.some(({ category }) => category === "interference_fixation")).toBe(true);
    expect(familyNames).not.toContain("twister");
  });

  it("preserves exact documented cutter matrices without inventing FlipCutter 6.5", () => {
    expect(FLIPCUTTER_III_CUTTER_SIZES_MM).toEqual([6, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12]);
    expect(FLIPCUTTER_III_CUTTER_SIZES_MM).not.toContain(6.5);
    expect(TRUNAV_SOCKET_SIZES_MM).toEqual([5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12]);
    expect(VERSITOMIC_FLEXIBLE_SIZES_MM.at(0)).toBe(4.5);
    expect(VERSITOMIC_FLEXIBLE_SIZES_MM.at(-1)).toBe(12);
    expect(SWITCHCUT_SIZES_MM).toHaveLength(13);
    expect(PRECISION_FLEXIBLE_SIZES_MM).toHaveLength(16);
    expect(TWISTR_SIZES_MM).toHaveLength(13);
    expect(INFINITY_RETRO_SIZES_MM).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 11, 12]);
  });

  it("keeps VersiTomic RR cutter/shaft pairings explicit", () => {
    const rr = getProductVariants("fam-stryker-versitomic-rr");
    expect(rr.find(({ dimensionsMm }) => dimensionsMm.cutterDiameterMm === 10)?.dimensionsMm.shaftDiameterMm).toBe(4.5);
    expect(rr.find(({ dimensionsMm }) => dimensionsMm.cutterDiameterMm === 11)?.dimensionsMm.shaftDiameterMm).toBe(6);
    expect(rr.find(({ dimensionsMm }) => dimensionsMm.cutterDiameterMm === 12)?.dimensionsMm.shaftDiameterMm).toBe(6);
  });

  it("stores M-ARS as overlapping-hole-plus-dilator geometry", () => {
    const mars = PRODUCT_VARIANTS.find(({ id }) => id === "var-medacta-mars");
    expect(mars?.dimensionsMm.kWireDiameterMm).toBe(2.4);
    expect(mars?.dimensionsMm.overdrillDiameterMm).toBe(4.5);
    expect(mars?.settings.overlappingHoleCount).toBe(3);
    expect(mars?.settings.tibialProfile).toMatch(/C-shaped\/ribbon/);
    expect(mars?.geometryRecipeId).toBe("recipe-overlap-dilator");
  });

  it("uses null rather than invented exact dimensions", () => {
    for (const item of PRODUCT_VARIANTS) {
      for (const value of Object.values(item.dimensionsMm)) {
        expect(value === null || (typeof value === "number" && Number.isFinite(value))).toBe(true);
      }
    }
    const unknownFixation = PRODUCT_VARIANTS.find(({ id }) => id === "var-conmed-tibial-button-14");
    expect(unknownFixation?.dimensionsMm.widthMm).toBeNull();
    expect(unknownFixation?.dimensionsMm.thicknessMm).toBeNull();
    const approximateRootSpacing = PRODUCT_VARIANTS.find(({ id }) => id === "var-smith-root-double");
    expect(approximateRootSpacing?.dimensionsMm.exactSeparationMm).toBeNull();
  });

  it("keeps recipes, sources, and regional availability referentially valid and non-reassuring", () => {
    const manufacturerIds = new Set(MANUFACTURERS.map(({ id }) => id));
    const familyIds = new Set(PRODUCT_FAMILIES.map(({ id }) => id));
    const sourceIds = new Set(CATALOG_SOURCES.map(({ id }) => id));
    const recipeIds = new Set(GEOMETRY_RECIPES.map(({ id }) => id));

    PRODUCT_FAMILIES.forEach((item) => {
      expect(manufacturerIds.has(item.manufacturerId)).toBe(true);
      item.sourceIds.forEach((id) => expect(sourceIds.has(id)).toBe(true));
      item.geometryRecipeIds.forEach((id) => expect(recipeIds.has(id)).toBe(true));
    });
    PRODUCT_VARIANTS.forEach((item) => {
      expect(familyIds.has(item.familyId)).toBe(true);
      if (item.geometryRecipeId) expect(recipeIds.has(item.geometryRecipeId)).toBe(true);
      item.sourceIds.forEach((id) => expect(sourceIds.has(id)).toBe(true));
    });
    expect(REGION_AVAILABILITY.every(({ status }) => status === "unverified")).toBe(true);
  });
});
