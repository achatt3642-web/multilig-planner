import type { InstrumentChain } from "../domain/types";
import { stableHash } from "../geometry/hash";
import {
  COMPATIBILITY_EDGES,
  DEVICE_CATALOG_VERSION,
  INSTRUMENTS,
  MANUFACTURERS,
  PRODUCT_FAMILIES,
  PRODUCT_VARIANTS,
  REGION_INSTITUTION_SETS,
} from "./deviceCatalog";

const EXPLICIT_NONCATALOG_IDS = new Set([
  "explicit-no-fixation",
  "explicit-no-preparation",
]);

export interface CatalogChainAssessment {
  incompatibleReasons: string[];
  warningReasons: string[];
  sourceIds: string[];
  exactSizeMm: number | null;
  pinDiameterMm: number | null;
  cutterShaftDiameterMm: number | null;
  selectedVariantDimensionsMm: Record<string, number | null>;
}

function selectedInstrumentIds(chain: InstrumentChain): string[] {
  return [
    chain.guideInstrumentId,
    chain.hookArmOffsetAngle.hookOrArmId,
    chain.sleeveBulletDepthStop.sleeveOrBulletId,
    chain.pinInstrumentId,
    chain.cutterInstrumentId,
    ...chain.fixationPreparationInstrumentIds,
  ].filter((value): value is string => typeof value === "string" && value.length > 0 && !EXPLICIT_NONCATALOG_IDS.has(value));
}

function finitePositive(...values: Array<number | null | undefined>): number | null {
  return values.find((value): value is number => value !== null && value !== undefined && Number.isFinite(value) && value > 0) ?? null;
}

export function exactSizeMmForChain(chain: InstrumentChain): number | null {
  if (!chain.productVariantId || !chain.exactSizeOrProfileId) return null;
  const prefix = `${chain.productVariantId}:size:`;
  if (!chain.exactSizeOrProfileId.startsWith(prefix)) return null;
  const value = Number(chain.exactSizeOrProfileId.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function hasCatalogCompatibility(fromId: string, toId: string): boolean {
  return COMPATIBILITY_EDGES.some((edge) => {
    const direct = edge.fromId === fromId && edge.toId === toId;
    const reverse = edge.fromId === toId && edge.toId === fromId;
    return (direct || reverse) && edge.relationship === "compatible";
  });
}

export function instrumentChainSelectionHash(chain: InstrumentChain): string {
  return stableHash({
    regionInstitutionSetId: chain.regionInstitutionSetId,
    marketOrRegion: chain.marketOrRegion,
    manufacturerId: chain.manufacturerId,
    productFamilyId: chain.productFamilyId,
    productVariantId: chain.productVariantId,
    guideInstrumentId: chain.guideInstrumentId,
    guideSide: chain.guideSide,
    hookArmOffsetAngle: chain.hookArmOffsetAngle,
    sleeveBulletDepthStop: chain.sleeveBulletDepthStop,
    pinInstrumentId: chain.pinInstrumentId,
    cutterInstrumentId: chain.cutterInstrumentId,
    exactSizeOrProfileId: chain.exactSizeOrProfileId,
    depthOrFullTunnelSetting: chain.depthOrFullTunnelSetting,
    graftSelectionId: chain.graftSelectionId,
    fixationImplantIds: chain.fixationImplantIds,
    fixationPreparationInstrumentIds: chain.fixationPreparationInstrumentIds,
    catalogVersion: chain.catalogVersion,
  });
}

export function assessCatalogChain(chain: InstrumentChain): CatalogChainAssessment {
  const incompatibleReasons: string[] = [];
  const warningReasons: string[] = [];
  const sources = new Set<string>();
  const manufacturer = MANUFACTURERS.find((item) => item.id === chain.manufacturerId);
  const family = PRODUCT_FAMILIES.find((item) => item.id === chain.productFamilyId);
  const variant = PRODUCT_VARIANTS.find((item) => item.id === chain.productVariantId);
  const regionSet = REGION_INSTITUTION_SETS.find((item) => item.id === chain.regionInstitutionSetId);

  if (chain.catalogVersion !== DEVICE_CATALOG_VERSION) {
    incompatibleReasons.push(`Catalog snapshot ${chain.catalogVersion} is not installed; current resolver is ${DEVICE_CATALOG_VERSION}`);
  }

  if (chain.regionInstitutionSetId && !regionSet) incompatibleReasons.push(`Unknown region/institution set ${chain.regionInstitutionSetId}`);
  regionSet?.sourceIds.forEach((id) => sources.add(id));
  if (regionSet?.status === "generic_parametric" && chain.manufacturerId && chain.manufacturerId !== "mfr-generic") {
    incompatibleReasons.push("The Generic Parametric set can only resolve Generic Parametric records");
  }
  if (regionSet?.status === "institution_defined" && chain.manufacturerId && chain.manufacturerId !== "mfr-institution") {
    incompatibleReasons.push("The institution-controlled set requires Institution Defined records or a documented institutional override");
  }
  if (chain.manufacturerId && !manufacturer) incompatibleReasons.push(`Unknown manufacturer record ${chain.manufacturerId}`);
  if (chain.productFamilyId && !family) incompatibleReasons.push(`Unknown product family record ${chain.productFamilyId}`);
  if (chain.productVariantId && !variant) incompatibleReasons.push(`Unknown product/model/SKU record ${chain.productVariantId}`);
  if (family) {
    family.sourceIds.forEach((id) => sources.add(id));
    if (chain.manufacturerId && family.manufacturerId !== chain.manufacturerId) {
      incompatibleReasons.push(`${family.name} does not belong to the selected manufacturer`);
    }
  }
  if (variant) {
    variant.sourceIds.forEach((id) => sources.add(id));
    if (chain.productFamilyId && variant.familyId !== chain.productFamilyId) {
      incompatibleReasons.push(`${variant.name} does not belong to the selected product family`);
    }
  }

  const exactSizeMm = exactSizeMmForChain(chain);
  if (chain.exactSizeOrProfileId && variant?.selectableSizesMm?.length) {
    const documented = exactSizeMm !== null && variant.selectableSizesMm.some((size) => Math.abs(size - exactSizeMm) < 1e-8);
    if (!documented) incompatibleReasons.push("The retained exact size/profile is not a documented setting for the selected model");
  } else if (
    chain.exactSizeOrProfileId &&
    manufacturer &&
    manufacturer.id !== "mfr-generic" &&
    manufacturer.id !== "mfr-institution" &&
    !variant?.selectableSizesMm?.length
  ) {
    incompatibleReasons.push("The selected branded model has no verified selectable size/profile record");
  }

  const instruments = selectedInstrumentIds(chain).map((id) => {
    const record = INSTRUMENTS.find((instrument) => instrument.id === id);
    if (!record) incompatibleReasons.push(`Unknown instrument record ${id}`);
    return record;
  }).filter((record): record is (typeof INSTRUMENTS)[number] => Boolean(record));

  for (const instrument of instruments) {
    instrument.sourceIds.forEach((id) => sources.add(id));
    const instrumentFamily = PRODUCT_FAMILIES.find((item) => item.id === instrument.familyId);
    if (!instrumentFamily) {
      incompatibleReasons.push(`Instrument ${instrument.name} has no catalog family`);
      continue;
    }
    if (manufacturer && instrumentFamily.manufacturerId !== manufacturer.id) {
      incompatibleReasons.push(`${instrument.name} belongs to a different manufacturer`);
    }
    if (
      variant &&
      instrument.familyId !== variant.familyId &&
      !hasCatalogCompatibility(instrument.familyId, variant.id) &&
      !hasCatalogCompatibility(instrument.familyId, variant.familyId)
    ) {
      warningReasons.push(`Compatibility between ${instrument.name} and ${variant.name} is not documented by a catalog edge`);
    }
  }

  const guide = INSTRUMENTS.find((instrument) => instrument.id === chain.guideInstrumentId);
  if (guide?.side && guide.side !== "universal" && chain.guideSide && guide.side !== chain.guideSide) {
    incompatibleReasons.push(`${guide.name} is not the selected guide side`);
  }
  if (guide && guide.side === null) warningReasons.push("Guide-side geometry is not documented in the seed record; verify the exact sided component");

  for (const fixationId of chain.fixationImplantIds) {
    if (EXPLICIT_NONCATALOG_IDS.has(fixationId)) continue;
    const fixation = PRODUCT_VARIANTS.find((item) => item.id === fixationId);
    if (!fixation) incompatibleReasons.push(`Unknown fixation record ${fixationId}`);
    fixation?.sourceIds.forEach((id) => sources.add(id));
  }

  if (manufacturer && manufacturer.id !== "mfr-generic" && manufacturer.id !== "mfr-institution") {
    warningReasons.push("Availability, indication, and assembled compatibility require current regional IFU and institutional verification");
  }

  const pin = INSTRUMENTS.find((instrument) => instrument.id === chain.pinInstrumentId);
  const cutter = INSTRUMENTS.find((instrument) => instrument.id === chain.cutterInstrumentId);
  const pinDiameterMm = pin ? finitePositive(
    pin.dimensionsMm.diameterMm,
    pin.dimensionsMm.shaftDiameterMm,
    pin.dimensionsMm.guideWireDiameterMm,
    pin.dimensionsMm.kWireDiameterMm,
  ) : null;
  const cutterShaftDiameterMm = cutter ? finitePositive(
    cutter.dimensionsMm.shaftDiameterMm,
    cutter.dimensionsMm.pinPathwayDiameterMm,
  ) : null;

  return {
    incompatibleReasons: [...new Set(incompatibleReasons)],
    warningReasons: [...new Set(warningReasons)],
    sourceIds: [...sources].sort(),
    exactSizeMm,
    pinDiameterMm,
    cutterShaftDiameterMm,
    selectedVariantDimensionsMm: { ...(variant?.dimensionsMm ?? {}) },
  };
}
