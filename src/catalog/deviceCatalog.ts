import type {
  CatalogSource,
  CatalogStatus,
  CatalogVersion,
  CompatibilityEdge,
  GeometryRecipe,
  InstitutionOverride,
  Instrument,
  Manufacturer,
  ProductFamily,
  ProductFamilyCategory,
  ProductVariant,
  RegionAvailability,
  RegionInstitutionSet,
} from "../domain/types";

/**
 * Curated seed data transcribed from
 * Multilig_Planner_Device_Catalog_and_Codex_Prompt.md.  The application never
 * parses that Markdown at runtime.  Unknown dimensions remain null.
 */

export const DEVICE_CATALOG_VERSION = "1.0.0" as const;
export const CATALOG_CHECKED_AT = "2026-08-02" as const;

const source = (
  id: string,
  title: string,
  publisher: string,
  url: string,
  status: CatalogStatus = "manufacturer_documented",
): CatalogSource => ({
  id,
  title,
  publisher,
  url,
  checkedAt: CATALOG_CHECKED_AT,
  marketOrRegion: "Global source; current regional IFU and local availability not verified",
  status,
});

export const CATALOG_SOURCES: readonly CatalogSource[] = [
  source("src-arthrex-flipcutter", "FlipCutter III Drill", "Arthrex", "https://www.arthrex.com/knee/flipcutter-iii-drill"),
  source("src-arthrex-retroconstruction", "RetroConstruction Drill Guide System", "Arthrex", "https://www.arthrex.com/knee/retroconstruction-drill-guide-system-instrument-set"),
  source("src-arthrex-flexible", "Flexible Reamer System", "Arthrex", "https://www.arthrex.com/knee/flexible-reamer"),
  source("src-arthrex-coring", "Disposable Coring Reamers", "Arthrex", "https://www.arthrex.com/knee/disposable-coring-reamers"),
  source("src-arthrex-catalog", "Knee: Next Generation in Repair and Reconstruction", "Arthrex", "https://www.arthrex.com/resources/LB1-0115-en-US/knee-next-generation-in-repair-and-reconstruction"),
  source("src-arthrex-root", "Meniscal Root Repair", "Arthrex", "https://www.arthrex.com/knee/meniscal-root-repair"),
  source("src-arthrex-fixation", "Interference Screws", "Arthrex", "https://www.arthrex.com/knee/interference-screws-1"),
  source("src-arthrex-fibertak", "Knee FiberTak Anchor", "Arthrex", "https://www.arthrex.com/knee/knee-fibertak-anchor"),
  source("src-arthrex-tightrope", "FiberTag TightRope II", "Arthrex", "https://www.arthrex.com/knee/fibertag-tightrope-ii-implant"),
  source("src-arthrex-collateral-fixation", "Collateral Ligament Graft Fixation", "Arthrex", "https://www.arthrex.com/knee/collateral-ligament-graft-fixation"),

  source("src-smith-trunav", "ACUFEX TRUNAV Retrograde Drill", "Smith+Nephew", "https://www.smith-nephew.com/en/health-care-professionals/products/sports-medicine/acufex-trunav-retrograde-drill"),
  source("src-smith-pinpoint", "ACUFEX PINPOINT Anatomic ACL Guide", "Smith+Nephew", "https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/acufex-pinpoint-anatomic-acl-guide-system-ppl"),
  source("src-smith-root", "Meniscal Root Repair System", "Smith+Nephew", "https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/meniscal-root-repair-system"),
  source("src-smith-ultrabutton", "ULTRABUTTON Adjustable Fixation Device", "Smith+Nephew", "https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/ultrabutton-adjustable-fixation-device"),
  source("src-smith-qfix", "Q-FIX All-Suture Anchor for Knee", "Smith+Nephew", "https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/q-fix-all-suture-anchor-knee"),
  source("src-smith-biosure", "BIOSURE REGENESORB Interference Screw", "Smith+Nephew", "https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/biosure-regenesorb-interference-screw"),
  source("src-smith-director", "Modified Lemaire technique guide", "Smith+Nephew", "https://smith-nephew.stylelabs.cloud/api/public/content/09026-V3-Lemaire-BIOSURE-REGENESORB-Technique-Guide?download=true", "region_ifu_check_required"),

  source("src-stryker-flexible", "VersiTomic Flexible Reaming System", "Stryker", "https://www.stryker.com/us/en/sports-medicine/products/versitomic-flexible-reaming-system.html"),
  source("src-stryker-rr", "VersiTomic RR All-Inside Technique", "Stryker", "https://www.stryker.com/content/dam/stryker/sports-medicine/procedures/acl-reconstruction/Versitomic%20RR%20all-inside%20ACL%20reconstruction%20technique%20guide.pdf"),
  source("src-stryker-isi", "VersiTomic ISI", "Stryker", "https://www.stryker.com/us/en/sports-medicine/products/versitomic-isi.html"),
  source("src-stryker-procinch", "ProCinch Adjustable Suspensory Fixation", "Stryker", "https://www.stryker.com/us/en/sports-medicine/products/ProCinch-adjustable-suspensory-fixation-system.html"),
  source("src-stryker-iconix", "Iconix All-Suture Anchor", "Stryker", "https://www.stryker.com/us/en/sports-medicine/products/iconix-all-suture-anchor.html"),
  source("src-stryker-acl-portfolio", "ACL Reconstruction Portfolio", "Stryker", "https://www.stryker.com/us/en/sports-medicine/procedures/ACL-reconstruction.html"),

  source("src-zimmer-switchcut", "SwitchCut Reaming System", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/switchcut-reaming-system.html"),
  source("src-zimmer-precision", "Precision Flexible Reaming System", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/precision-flexible-instrumentation.html"),
  source("src-zimmer-trays", "Precision ACL Tray Systems", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/precision-acl-tray-systems.html"),
  source("src-zimmer-toggleloc", "ToggleLoc with ZipLoop", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/toggleloc-device-with-ziploop-technology.html"),
  source("src-zimmer-aperfix", "AperFix II Tibial Sheath and Screw", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/aperfix-ii-tibial-sheath-and-screw-system.html"),
  source("src-zimmer-portfolio", "Sports Medicine Portfolio", "Zimmer Biomet", "https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine.html"),

  source("src-depuy-twistr", "TWISTR Retrograde Reamer and Cruciate System", "DePuy Synthes / Mitek", "https://www.jnjmedtech.com/en-US/product/twistr-retrograde-reamer-and-cruciate-system"),
  source("src-depuy-rigidloop", "RIGIDLOOP Adjustable Cortical Fixation", "DePuy Synthes / Mitek", "https://www.jnjmedtech.com/en-US/product/rigidloop-adjustable-cortical-fixation-system"),
  source("src-depuy-intrafix", "INTRAFIX ADVANCE", "DePuy Synthes / Mitek", "https://www.jnjmedtech.com/en-US/product/intrafix-advance-tibial-fastener-system"),
  source("src-depuy-milagro", "MILAGRO ADVANCE", "DePuy Synthes / Mitek", "https://www.jnjmedtech.com/en-US/product/milagro-advance-interference-screw"),

  source("src-conmed-infinity", "Infinity Retro-Reamers", "CONMED", "https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/infinity-retro-reamers"),
  source("src-conmed-guides", "Infinity Modular Guide System", "CONMED", "https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/infinity-guides"),
  source("src-conmed-reamers", "Constant Diameter, Sentinel, GraftMax Flex and Badger Reamers", "CONMED", "https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/constant-diameter-and-sentinel-reamers"),
  source("src-conmed-buttons", "Infinity Femoral Adjustable Loop Button", "CONMED", "https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/infinity-femoral-adjustable-loop-button"),
  source("src-conmed-tibial-button", "Infinity Tibial Button and Loop", "CONMED", "https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/infinity-tibial-button-and-loop"),
  source("src-conmed-genesys", "GENESYS Matryx Interference Screw", "CONMED", "https://www.conmed.com/en/products/implants-and-suture-anchors/interference-screws/genesys-matryx-interference-screw"),
  source("src-conmed-anchor", "Y-Knot PRO Flex All-Suture Anchor", "CONMED", "https://www.conmed.com/en/products/implants-and-suture-anchors/knot-tying-suture-anchors/y-knot-flex-all-suture-anchor"),

  source("src-medacta-mars", "M-ARS ACL Set", "Medacta SportsMed", "https://www.medacta.com/EN/m-ars-acl-set"),
  source("src-medacta-mecta-acl", "Mecta ACL SB", "Medacta SportsMed", "https://www.medacta.com/EN/mecta-acl-sb"),
  source("src-medacta-mecta-pcl", "Mecta PCL", "Medacta SportsMed", "https://www.medacta.com/EN/mecta-pcl?lang=EN"),
  source("src-medacta-fixation", "FairFix", "Medacta SportsMed", "https://www.medacta.com/EN/fairfix-global"),
  source("src-medacta-screws", "MectaScrew", "Medacta SportsMed", "https://www.medacta.com/handler/content/3579/EN"),
  source("src-medacta-peripheral", "Peripheral Ligament Portfolio", "Medacta SportsMed", "https://www.medacta.com/EN/peripheral-ligament"),
] as const;

const manufacturer = (
  id: string,
  name: string,
  aliases: string[],
  sourceIds: string[],
  status: CatalogStatus = "manufacturer_documented",
): Manufacturer => ({ id, name, aliases, sourceIds, status });

export const MANUFACTURERS: readonly Manufacturer[] = [
  manufacturer("mfr-arthrex", "Arthrex", [], ["src-arthrex-catalog"]),
  manufacturer("mfr-smith-nephew", "Smith+Nephew", ["Smith & Nephew"], ["src-smith-trunav"]),
  manufacturer("mfr-stryker", "Stryker", [], ["src-stryker-flexible"]),
  manufacturer("mfr-zimmer-biomet", "Zimmer Biomet", [], ["src-zimmer-trays"]),
  manufacturer("mfr-depuy-mitek", "DePuy Synthes / Mitek", ["DePuy Mitek"], ["src-depuy-twistr"]),
  manufacturer("mfr-conmed", "CONMED", ["Linvatec (legacy alias)"], ["src-conmed-infinity"]),
  manufacturer("mfr-medacta", "Medacta SportsMed", ["Medacta"], ["src-medacta-mars"]),
  manufacturer("mfr-generic", "Generic Parametric", [], [], "generic_parametric"),
  manufacturer("mfr-institution", "Institution Defined", [], [], "institution_defined"),
] as const;

const family = (
  id: string,
  manufacturerId: string,
  name: string,
  category: ProductFamilyCategory,
  description: string,
  sourceIds: string[],
  geometryRecipeIds: string[],
  status: CatalogStatus = "manufacturer_documented",
): ProductFamily => ({ id, manufacturerId, name, category, description, status, sourceIds, geometryRecipeIds });

export const PRODUCT_FAMILIES: readonly ProductFamily[] = [
  family("fam-arthrex-flipcutter-iii", "mfr-arthrex", "FlipCutter III", "retrograde_cutter", "Adjustable inside-out socket cutter with retained cortex.", ["src-arthrex-flipcutter"], ["recipe-adjustable-retro"]),
  family("fam-arthrex-retroconstruction", "mfr-arthrex", "RetroConstruction Guide System", "guide_system", "C-ring guides, marking hooks, sleeves, and depth stops.", ["src-arthrex-retroconstruction"], ["recipe-guide-access"]),
  family("fam-arthrex-flexible", "mfr-arthrex", "Flexible Reamer System", "flexible_cutter", "Flexible femoral reaming and curved access.", ["src-arthrex-flexible"], ["recipe-flexible-reamer"]),
  family("fam-arthrex-rigid-reamers", "mfr-arthrex", "Cannulated / Headed / Low-Profile Reamers", "rigid_cutter", "Rigid full-thickness, headed, and low-profile cutter families.", ["src-arthrex-catalog"], ["recipe-full-tunnel", "recipe-headed-reamer"]),
  family("fam-arthrex-coring", "mfr-arthrex", "Disposable Coring Reamers", "coring_cutter", "Annular kerf with separable bone core.", ["src-arthrex-coring"], ["recipe-coring"]),
  family("fam-arthrex-dilators", "mfr-arthrex", "Tunnel Dilators", "dilator_compactor", "Sequential tunnel compaction/dilation.", ["src-arthrex-catalog"], ["recipe-dilator"]),
  family("fam-arthrex-root", "mfr-arthrex", "Meniscal Root Repair / FlipCutter II Root Kit", "root_system", "Current root-specific fixed 6 mm cutter plus guide system.", ["src-arthrex-root"], ["recipe-fixed-retro", "recipe-full-tunnel"]),
  family("fam-arthrex-buttons", "mfr-arthrex", "TightRope II / TightRope SB", "cortical_fixation", "Cortical suspension families; exact plate dimensions are SKU data.", ["src-arthrex-tightrope"], ["recipe-button"]),
  family("fam-arthrex-interference", "mfr-arthrex", "FastThread / GraftBolt", "interference_fixation", "Interference screw and sheath-and-screw fixation.", ["src-arthrex-fixation"], ["recipe-interference"]),
  family("fam-arthrex-anchors", "mfr-arthrex", "SwiveLock / Knee FiberTak", "anchor", "Anchor pilot and retained anchor geometry.", ["src-arthrex-collateral-fixation", "src-arthrex-fibertak"], ["recipe-anchor"]),
  family("fam-arthrex-surface", "mfr-arthrex", "Posts / Washers / Staples", "post_washer_staple", "Surface hardware requiring local exact part selection.", ["src-arthrex-catalog"], ["recipe-post-washer-staple"], "region_ifu_check_required"),

  family("fam-smith-trunav", "mfr-smith-nephew", "ACUFEX TRUNAV Retrograde Drill", "retrograde_cutter", "Pin-guided concentric antegrade/retrograde socket cutter.", ["src-smith-trunav"], ["recipe-antegrade-retro-hybrid"]),
  family("fam-smith-pinpoint", "mfr-smith-nephew", "ACUFEX PINPOINT Anatomic ACL Guide", "guide_system", "Pivoting guide paired with TRUNAV.", ["src-smith-pinpoint"], ["recipe-guide-access"]),
  family("fam-smith-root", "mfr-smith-nephew", "Meniscal Root Repair System", "root_system", "Single- and double-tunnel root guide system.", ["src-smith-root"], ["recipe-full-tunnel"]),
  family("fam-smith-director", "mfr-smith-nephew", "ACUFEX DIRECTOR ELITE", "guide_system", "Technique-documented rigid guide; component availability requires local confirmation.", ["src-smith-director"], ["recipe-guide-access"], "region_ifu_check_required"),
  family("fam-smith-buttons", "mfr-smith-nephew", "ULTRABUTTON / ENDOBUTTON / XTENDOBUTTON", "cortical_fixation", "Adjustable/fixed-loop button and extension families.", ["src-smith-ultrabutton"], ["recipe-button"]),
  family("fam-smith-biosure", "mfr-smith-nephew", "BIOSURE", "interference_fixation", "Interference screw family; exact dimensions require regional SKU data.", ["src-smith-biosure"], ["recipe-interference"]),
  family("fam-smith-qfix", "mfr-smith-nephew", "Q-FIX", "anchor", "Straight/curved all-suture anchor family.", ["src-smith-qfix"], ["recipe-anchor"]),

  family("fam-stryker-versitomic-flex", "mfr-stryker", "VersiTomic Flexible", "flexible_cutter", "Flexible reaming with side-specific offset guides.", ["src-stryker-flexible"], ["recipe-flexible-reamer"]),
  family("fam-stryker-versitomic-rr", "mfr-stryker", "VersiTomic RR", "retrograde_cutter", "Fixed retro cutter family with shaft/cutter pairing.", ["src-stryker-rr"], ["recipe-fixed-retro"]),
  family("fam-stryker-versitomic-guides", "mfr-stryker", "VersiTomic RR Guide System / Root System", "guide_system", "ACL, PCL, and root-specific arms with stepped bullets.", ["src-stryker-rr"], ["recipe-guide-access"]),
  family("fam-stryker-rigid-isi", "mfr-stryker", "VersiTomic Rigid / ISI", "rigid_cutter", "Rigid reaming plus screw access, tap, and notch instruments.", ["src-stryker-isi"], ["recipe-full-tunnel", "recipe-chamfer"]),
  family("fam-stryker-buttons", "mfr-stryker", "ProCinch / G-Lok", "cortical_fixation", "Adjustable/fixed cortical fixation.", ["src-stryker-procinch"], ["recipe-button"]),
  family("fam-stryker-biosteon", "mfr-stryker", "Biosteon", "interference_fixation", "Interference fixation; exact sizes require local SKU data.", ["src-stryker-acl-portfolio"], ["recipe-interference"]),
  family("fam-stryker-anchors", "mfr-stryker", "Omega / Iconix", "anchor", "Root and peripheral small-anchor families.", ["src-stryker-rr", "src-stryker-iconix"], ["recipe-anchor"]),

  family("fam-zimmer-switchcut", "mfr-zimmer-biomet", "SwitchCut", "retrograde_cutter", "Self-flipping outside-in retro reamer.", ["src-zimmer-switchcut"], ["recipe-adjustable-retro"]),
  family("fam-zimmer-precision-flex", "mfr-zimmer-biomet", "Precision Flexible", "flexible_cutter", "Two-plane flexible reaming.", ["src-zimmer-precision"], ["recipe-flexible-reamer"]),
  family("fam-zimmer-precision-trays", "mfr-zimmer-biomet", "Precision ACL Modular Trays", "tray_system", "Rigid, flexible, retro, and dilation caddies.", ["src-zimmer-trays"], ["recipe-full-tunnel", "recipe-headed-reamer", "recipe-dilator"]),
  family("fam-zimmer-toggleloc", "mfr-zimmer-biomet", "ToggleLoc / AFX", "cortical_fixation", "Cortical and expanding femoral fixation families.", ["src-zimmer-toggleloc"], ["recipe-button"]),
  family("fam-zimmer-aperfix", "mfr-zimmer-biomet", "AperFix II", "interference_fixation", "Tibial sheath-and-screw system.", ["src-zimmer-aperfix"], ["recipe-interference"]),
  family("fam-zimmer-compositcp", "mfr-zimmer-biomet", "ComposiTCP", "interference_fixation", "Interference screw family with taps.", ["src-zimmer-trays"], ["recipe-interference"]),
  family("fam-zimmer-anchors", "mfr-zimmer-biomet", "JuggerKnot / SureLock", "anchor", "Anchor placeholders requiring exact knee SKU/IFU geometry.", ["src-zimmer-portfolio"], ["recipe-anchor"], "region_ifu_check_required"),
  family("fam-zimmer-washerloc", "mfr-zimmer-biomet", "WasherLoc / Surface Fixation", "post_washer_staple", "Washer/post tray family requiring exact local geometry.", ["src-zimmer-trays"], ["recipe-post-washer-staple"], "region_ifu_check_required"),

  family("fam-depuy-twistr", "mfr-depuy-mitek", "TWISTR", "retrograde_cutter", "Adjustable outside-in retrograde reamer (canonical spelling).", ["src-depuy-twistr"], ["recipe-adjustable-retro"]),
  family("fam-depuy-cruciate-plus", "mfr-depuy-mitek", "Cruciate+", "guide_system", "Point-to-point/capture guides, bullet, insert, and pin.", ["src-depuy-twistr"], ["recipe-guide-access"]),
  family("fam-depuy-rigidloop", "mfr-depuy-mitek", "RIGIDLOOP", "cortical_fixation", "Adjustable, fixed, and BTB cortical fixation.", ["src-depuy-rigidloop"], ["recipe-button"]),
  family("fam-depuy-intrafix", "mfr-depuy-mitek", "INTRAFIX ADVANCE", "interference_fixation", "Tibial sheath-and-screw fastener.", ["src-depuy-intrafix"], ["recipe-interference"]),
  family("fam-depuy-milagro", "mfr-depuy-mitek", "MILAGRO ADVANCE", "interference_fixation", "Interference screw family.", ["src-depuy-milagro"], ["recipe-interference"]),

  family("fam-conmed-infinity", "mfr-conmed", "Infinity Retro-Reamers", "retrograde_cutter", "Fixed-size outside-in retro reamer family.", ["src-conmed-infinity"], ["recipe-fixed-retro"]),
  family("fam-conmed-infinity-guides", "mfr-conmed", "Infinity Modular Guides / Pins / Dilator", "guide_system", "ACL/PCL guides, stepped pin, and button-channel dilator.", ["src-conmed-guides"], ["recipe-guide-access", "recipe-stepped-button"]),
  family("fam-conmed-constant", "mfr-conmed", "Constant Diameter Reamers", "rigid_cutter", "Fully fluted rigid reamer family.", ["src-conmed-reamers"], ["recipe-full-tunnel"]),
  family("fam-conmed-sentinel", "mfr-conmed", "Sentinel / GraftMax Flex Sentinel", "flexible_cutter", "Single-flute protected rigid/flexible reamers.", ["src-conmed-reamers"], ["recipe-flexible-reamer", "recipe-headed-reamer"]),
  family("fam-conmed-badger", "mfr-conmed", "Badger Reamer", "rigid_cutter", "Front-cutting head with smooth protective shaft.", ["src-conmed-reamers"], ["recipe-headed-reamer"]),
  family("fam-conmed-buttons", "mfr-conmed", "Infinity / GraftMax / XO Buttons", "cortical_fixation", "Adjustable and fixed-loop cortical fixation.", ["src-conmed-buttons"], ["recipe-button"]),
  family("fam-conmed-genesys", "mfr-conmed", "GENESYS Matryx", "interference_fixation", "Interference screw family.", ["src-conmed-genesys"], ["recipe-interference"]),
  family("fam-conmed-y-knot", "mfr-conmed", "Y-Knot PRO Flex", "anchor", "Flexible-delivery all-suture anchor.", ["src-conmed-anchor"], ["recipe-anchor"]),

  family("fam-medacta-mars", "mfr-medacta", "M-ARS", "dilator_compactor", "Three overlapping holes followed by rectangular femoral or C/ribbon tibial dilator.", ["src-medacta-mars"], ["recipe-overlap-dilator"]),
  family("fam-medacta-mecta-acl", "mfr-medacta", "Mecta ACL SB", "tray_system", "AM/transtibial circular or oval tunnel system.", ["src-medacta-mecta-acl"], ["recipe-full-tunnel", "recipe-dilator"]),
  family("fam-medacta-mecta-pcl", "mfr-medacta", "Mecta PCL", "tray_system", "Transtibial PCL set with protective instrumentation.", ["src-medacta-mecta-pcl"], ["recipe-full-tunnel", "recipe-guide-access"]),
  family("fam-medacta-reamers", "mfr-medacta", "Medacta Reamer Trays", "rigid_cutter", "Cannulated, acorn, and low-profile families.", ["src-medacta-mecta-acl"], ["recipe-full-tunnel", "recipe-headed-reamer"]),
  family("fam-medacta-buttons", "mfr-medacta", "FairFix / MBlock / MectaLoop", "cortical_fixation", "Adjustable and fixed-loop cortical fixation.", ["src-medacta-fixation"], ["recipe-button"]),
  family("fam-medacta-screws", "mfr-medacta", "MectaScrew / PEEK-CF / Titanium", "interference_fixation", "Interference screw families.", ["src-medacta-screws"], ["recipe-interference"]),
  family("fam-medacta-anchors", "mfr-medacta", "Draw Tight / Peripheral Anchors", "anchor", "Peripheral repair/onlay anchors requiring exact model geometry.", ["src-medacta-peripheral"], ["recipe-anchor"], "region_ifu_check_required"),

  family("fam-generic-parametric", "mfr-generic", "Generic Parametric Instruments and Fixation", "parametric", "Editable geometry-only records with no manufacturer claim.", [], [
    "recipe-rigid-pin", "recipe-flexible-pin", "recipe-full-tunnel", "recipe-headed-reamer", "recipe-flexible-reamer",
    "recipe-adjustable-retro", "recipe-fixed-retro", "recipe-stepped-button", "recipe-dilator", "recipe-coring",
    "recipe-overlap-dilator", "recipe-shape-specific", "recipe-anchor", "recipe-interference", "recipe-button",
    "recipe-post-washer-staple", "recipe-trough", "recipe-chamfer", "recipe-onlay",
  ], "generic_parametric"),
  family("fam-institution-defined", "mfr-institution", "Institution Defined Instruments and Fixation", "parametric", "Locally verified records with attachments, owner, and retirement state.", [], [], "institution_defined"),
] as const;

const recipe = (
  id: string,
  recipeClass: GeometryRecipe["class"],
  requiredParameters: string[],
  generators: Partial<Pick<GeometryRecipe, "boneVolumeGenerator" | "pinVolumeGenerator" | "accessEnvelopeGenerator" | "deploymentEnvelopeGenerator" | "implantVolumeGenerator">>,
): GeometryRecipe => ({
  id,
  version: 1,
  class: recipeClass,
  requiredParameters,
  ...generators,
  sourceIds: [],
  status: "generic_parametric",
});

export const GEOMETRY_RECIPES: readonly GeometryRecipe[] = [
  recipe("recipe-rigid-pin", "rigid_pin", ["pinDiameterMm", "lengthMm", "tipOvershootMm"], { pinVolumeGenerator: "rigidPin" }),
  recipe("recipe-flexible-pin", "flexible_pin", ["pinDiameterMm", "minimumBendRadiusMm", "tipOvershootMm"], { pinVolumeGenerator: "flexiblePin", accessEnvelopeGenerator: "curvedAccess" }),
  recipe("recipe-full-tunnel", "full_thickness_cutter", ["diameterMm", "lengthMm"], { boneVolumeGenerator: "fullTunnel", accessEnvelopeGenerator: "rigidAccess" }),
  recipe("recipe-headed-reamer", "headed_reamer", ["headDiameterMm", "shaftDiameterMm", "depthMm"], { boneVolumeGenerator: "blindSocket", accessEnvelopeGenerator: "headedAccess" }),
  recipe("recipe-flexible-reamer", "flexible_reamer", ["diameterMm", "depthMm", "minimumBendRadiusMm"], { boneVolumeGenerator: "blindSocket", accessEnvelopeGenerator: "curvedAccess" }),
  recipe("recipe-adjustable-retro", "adjustable_retrograde_reamer", ["pilotDiameterMm", "cutterDiameterMm", "socketDepthMm"], { boneVolumeGenerator: "retroSocket", pinVolumeGenerator: "rigidPin", deploymentEnvelopeGenerator: "retroBladeSweep" }),
  recipe("recipe-fixed-retro", "fixed_retrograde_reamer", ["shaftDiameterMm", "cutterDiameterMm", "socketDepthMm"], { boneVolumeGenerator: "retroSocket", deploymentEnvelopeGenerator: "retroBladeSweep" }),
  recipe("recipe-antegrade-retro-hybrid", "antegrade_retrograde_hybrid", ["antegradeDiameterMm", "retrogradeDiameterMm", "socketDepthMm"], { boneVolumeGenerator: "hybridRetroSocket", deploymentEnvelopeGenerator: "retroBladeSweep" }),
  recipe("recipe-stepped-button", "stepped_button_tunnel", ["socketDiameterMm", "corticalChannelDiameterMm", "socketDepthMm"], { boneVolumeGenerator: "steppedButtonTunnel", deploymentEnvelopeGenerator: "buttonFlip" }),
  recipe("recipe-dilator", "sequential_dilator", ["profileSequence", "depthMm"], { boneVolumeGenerator: "compactedTunnel", accessEnvelopeGenerator: "dilatorAccess" }),
  recipe("recipe-coring", "coring_trephine", ["innerDiameterMm", "outerDiameterMm", "depthMm", "coreState"], { boneVolumeGenerator: "coringAnnulus", accessEnvelopeGenerator: "trephineAccess" }),
  recipe("recipe-overlap-dilator", "overlapping_drills_dilator", ["holeCentersMm", "holeDiametersMm", "finalProfile", "orientationDeg"], { boneVolumeGenerator: "overlappingHolesDilator" }),
  recipe("recipe-shape-specific", "shape_specific_tunnel", ["crossSection", "depthMm", "orientationDeg"], { boneVolumeGenerator: "sweptProfile" }),
  recipe("recipe-anchor", "anchor_pilot", ["pilotDiameterMm", "depthMm", "anchorEnvelope"], { boneVolumeGenerator: "anchorPilot", implantVolumeGenerator: "retainedAnchor" }),
  recipe("recipe-interference", "interference_screw_sheath", ["outerDiameterMm", "lengthMm", "graftOffsetMm"], { implantVolumeGenerator: "interferenceFixation" }),
  recipe("recipe-button", "cortical_button_plate", ["plateDimensionsMm", "passingChannelDiameterMm"], { boneVolumeGenerator: "passingChannel", deploymentEnvelopeGenerator: "buttonFlip", implantVolumeGenerator: "corticalPlate" }),
  recipe("recipe-post-washer-staple", "post_washer_staple", ["pilotGeometry", "surfaceHardwareEnvelope"], { boneVolumeGenerator: "surfaceHardwarePilots", implantVolumeGenerator: "surfaceHardware" }),
  recipe("recipe-trough", "pcl_inlay_trough", ["outline", "depthMm", "wallSlopeDeg"], { boneVolumeGenerator: "inlayTrough", accessEnvelopeGenerator: "troughAccess" }),
  recipe("recipe-chamfer", "chamfer_notch", ["apertureId", "notchProfile"], { boneVolumeGenerator: "apertureNotch", accessEnvelopeGenerator: "notchAccess" }),
  recipe("recipe-onlay", "no_bone_removal_onlay", ["noLargeTunnel"], { implantVolumeGenerator: "surfaceFixation" }),
  recipe("recipe-guide-access", "rigid_pin", ["guidePose", "sleeveGeometry"], { accessEnvelopeGenerator: "guideAccess" }),
] as const;

const halfSteps = (start: number, end: number): number[] => {
  const values: number[] = [];
  for (let value = start; value <= end + 1e-9; value += 0.5) values.push(Number(value.toFixed(1)));
  return values;
};

export const FLIPCUTTER_III_CUTTER_SIZES_MM = [6, ...halfSteps(7, 12)] as const;
export const TRUNAV_SOCKET_SIZES_MM = halfSteps(5.5, 12);
export const VERSITOMIC_FLEXIBLE_SIZES_MM = halfSteps(4.5, 12);
export const SWITCHCUT_SIZES_MM = halfSteps(6, 12);
export const PRECISION_FLEXIBLE_SIZES_MM = halfSteps(4.5, 12);
export const TWISTR_SIZES_MM = halfSteps(6, 12);
export const INFINITY_RETRO_SIZES_MM = [...halfSteps(6, 10), 11, 12];

const variant = (
  id: string,
  familyId: string,
  name: string,
  sku: string | null,
  dimensionsMm: Record<string, number | null>,
  selectableSizesMm: number[] | null,
  sourceIds: string[],
  geometryRecipeId: string | null,
  settings: Record<string, string | number | boolean | null> = {},
  status: CatalogStatus = "manufacturer_documented",
): ProductVariant => ({ id, familyId, name, sku, status, dimensionsMm, selectableSizesMm, settings, sourceIds, geometryRecipeId });

export const PRODUCT_VARIANTS: readonly ProductVariant[] = [
  variant("var-arthrex-flipcutter-iii", "fam-arthrex-flipcutter-iii", "FlipCutter III Drill", "AR-1204FF", { pinPathwayDiameterMm: 3.5, cutterDiameterMm: null, lengthMm: null }, [...FLIPCUTTER_III_CUTTER_SIZES_MM], ["src-arthrex-flipcutter"], "recipe-adjustable-retro"),
  variant("var-arthrex-retroconstruction", "fam-arthrex-retroconstruction", "RetroConstruction Guide Set", "AR-1510S", { sleeveDiameterMm: null }, null, ["src-arthrex-retroconstruction"], "recipe-guide-access"),
  variant("var-arthrex-retroconstruction-hr", "fam-arthrex-retroconstruction", "RetroConstruction Guide Set HR", "AR-1510HR", { sleeveDiameterMm: null }, null, ["src-arthrex-retroconstruction"], "recipe-guide-access"),
  variant("var-arthrex-root-flipcutter-ii", "fam-arthrex-root", "Root-kit FlipCutter II", null, { cutterDiameterMm: 6 }, [6], ["src-arthrex-root"], "recipe-fixed-retro"),
  variant("var-arthrex-sutureloc", "fam-arthrex-root", "SutureLoc Root Implant", "AR-4551", { drillPinDiameterMm: 2.4, anchorDiameterMm: null, anchorLengthMm: null }, null, ["src-arthrex-root"], "recipe-anchor"),
  variant("var-arthrex-tightrope-ii", "fam-arthrex-buttons", "TightRope II", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-arthrex-tightrope"], "recipe-button"),
  variant("var-arthrex-tightrope-sb", "fam-arthrex-buttons", "TightRope SB", null, { passingChannelDiameterMm: null }, null, ["src-arthrex-tightrope"], "recipe-button", { metalButton: false }),
  variant("var-arthrex-fastthread-6x20", "fam-arthrex-interference", "FastThread 6 x 20 mm", null, { outerDiameterMm: 6, lengthMm: 20 }, [6], ["src-arthrex-fixation"], "recipe-interference"),
  variant("var-arthrex-graftbolt", "fam-arthrex-interference", "GraftBolt", null, { sheathDiameterMm: null, screwDiameterMm: null, lengthMm: null }, [7, 8, 9, 10], ["src-arthrex-fixation"], "recipe-interference"),
  variant("var-arthrex-swivelock", "fam-arthrex-anchors", "SwiveLock Tenodesis", null, { pilotDiameterMm: null, anchorDiameterMm: null, anchorLengthMm: null }, null, ["src-arthrex-collateral-fixation"], "recipe-anchor"),
  variant("var-arthrex-knee-fibertak", "fam-arthrex-anchors", "Knee FiberTak", null, { standardPilotDiameterMm: 2.6, anchorLengthMm: null }, [2.6], ["src-arthrex-fibertak"], "recipe-anchor"),

  variant("var-smith-trunav", "fam-smith-trunav", "ACUFEX TRUNAV Retrograde Drill", null, { guideWireDiameterMm: 2.4, antegradeChannelDiameterMm: 4.9, cutterDiameterMm: null }, [...TRUNAV_SOCKET_SIZES_MM], ["src-smith-trunav"], "recipe-antegrade-retro-hybrid"),
  variant("var-smith-pinpoint", "fam-smith-pinpoint", "ACUFEX PINPOINT Anatomic ACL Guide", null, {}, null, ["src-smith-pinpoint"], "recipe-guide-access", { pivotAngleDeg: null }),
  variant("var-smith-root-single", "fam-smith-root", "Single-tunnel Root Repair Set", null, { pinDiameterMm: 2.4, overdrillDiameterMm: 4.5 }, [4.5], ["src-smith-root"], "recipe-full-tunnel"),
  variant("var-smith-root-double", "fam-smith-root", "Double-tunnel Root Repair Set", null, { drillDiameterMm: 2.8, exactSeparationMm: null }, [2.8], ["src-smith-root"], "recipe-full-tunnel", { sourceNote: "Published technique describes approximately 5 mm separation; this is not stored as an exact dimension." }),
  variant("var-smith-ultrabutton", "fam-smith-buttons", "ULTRABUTTON Adjustable Fixation Device", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-smith-ultrabutton"], "recipe-button"),
  variant("var-smith-biosure", "fam-smith-biosure", "BIOSURE Interference Screw", null, { outerDiameterMm: null, lengthMm: null }, null, ["src-smith-biosure"], "recipe-interference", {}, "region_ifu_check_required"),
  variant("var-smith-qfix-1-8", "fam-smith-qfix", "Q-FIX 1.8 mm family", null, { anchorDiameterMm: 1.8, pilotDepthMm: null }, [1.8], ["src-smith-qfix"], "recipe-anchor"),
  variant("var-smith-qfix-2-8", "fam-smith-qfix", "Q-FIX 2.8 mm family", null, { anchorDiameterMm: 2.8, pilotDepthMm: null }, [2.8], ["src-smith-qfix"], "recipe-anchor"),

  variant("var-stryker-versitomic-flex", "fam-stryker-versitomic-flex", "VersiTomic Flexible Reamers", null, { cutterDiameterMm: null, shaftDiameterMm: null, minimumBendRadiusMm: null }, [...VERSITOMIC_FLEXIBLE_SIZES_MM], ["src-stryker-flexible"], "recipe-flexible-reamer"),
  ...halfSteps(6, 10).map((diameter) => variant(`var-stryker-rr-${diameter}`, "fam-stryker-versitomic-rr", `VersiTomic RR ${diameter} mm`, null, { shaftDiameterMm: 4.5, cutterDiameterMm: diameter }, [diameter], ["src-stryker-rr"], "recipe-fixed-retro")),
  variant("var-stryker-rr-11", "fam-stryker-versitomic-rr", "VersiTomic RR 11 mm", null, { shaftDiameterMm: 6, cutterDiameterMm: 11 }, [11], ["src-stryker-rr"], "recipe-fixed-retro"),
  variant("var-stryker-rr-12", "fam-stryker-versitomic-rr", "VersiTomic RR 12 mm", null, { shaftDiameterMm: 6, cutterDiameterMm: 12 }, [12], ["src-stryker-rr"], "recipe-fixed-retro"),
  variant("var-stryker-rr-root", "fam-stryker-versitomic-guides", "VersiTomic RR Root Reamer", null, { shaftDiameterMm: 4.5, cutterDiameterMm: 6 }, [6], ["src-stryker-rr"], "recipe-fixed-retro"),
  variant("var-stryker-procinch", "fam-stryker-buttons", "ProCinch Adjustable Fixation", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-stryker-procinch"], "recipe-button"),
  variant("var-stryker-biosteon", "fam-stryker-biosteon", "Biosteon Interference Screw", null, { outerDiameterMm: null, lengthMm: null }, null, ["src-stryker-acl-portfolio"], "recipe-interference", {}, "region_ifu_check_required"),
  variant("var-stryker-iconix", "fam-stryker-anchors", "Iconix All-Suture Anchor", null, { pilotDiameterMm: null, anchorLengthMm: null }, [1.4, 2.3], ["src-stryker-iconix"], "recipe-anchor", {}, "region_ifu_check_required"),

  variant("var-zimmer-switchcut", "fam-zimmer-switchcut", "SwitchCut Reaming System", null, { cutterDiameterMm: null, pilotDiameterMm: null }, [...SWITCHCUT_SIZES_MM], ["src-zimmer-switchcut"], "recipe-adjustable-retro"),
  variant("var-zimmer-precision-flex", "fam-zimmer-precision-flex", "Precision Flexible Reamers", null, { cutterDiameterMm: null, minimumBendRadiusMm: null }, [...PRECISION_FLEXIBLE_SIZES_MM], ["src-zimmer-precision"], "recipe-flexible-reamer"),
  variant("var-zimmer-toggleloc", "fam-zimmer-toggleloc", "ToggleLoc with ZipLoop", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: 4.5 }, [4.5], ["src-zimmer-toggleloc"], "recipe-button"),
  ...[8, 9, 10, 11].map((diameter) => variant(`var-zimmer-aperfix-${diameter}x30`, "fam-zimmer-aperfix", `AperFix II ${diameter} x 30 mm`, null, { outerDiameterMm: diameter, lengthMm: 30 }, [diameter], ["src-zimmer-aperfix"], "recipe-interference")),

  variant("var-depuy-twistr", "fam-depuy-twistr", "TWISTR Retrograde Reamer", null, { cutterDiameterMm: null, pilotDiameterMm: null }, [...TWISTR_SIZES_MM], ["src-depuy-twistr"], "recipe-adjustable-retro"),
  variant("var-depuy-cruciate-plus", "fam-depuy-cruciate-plus", "Cruciate+ Instruments", null, { reamerBulletDiameterMm: 4.8, insertDiameterMm: 2.4 }, null, ["src-depuy-twistr"], "recipe-guide-access"),
  variant("var-depuy-rigidloop", "fam-depuy-rigidloop", "RIGIDLOOP Adjustable", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-depuy-rigidloop"], "recipe-button"),
  variant("var-depuy-intrafix", "fam-depuy-intrafix", "INTRAFIX ADVANCE", null, { sheathDiameterMm: null, screwDiameterMm: null, lengthMm: null }, null, ["src-depuy-intrafix"], "recipe-interference"),
  variant("var-depuy-milagro", "fam-depuy-milagro", "MILAGRO ADVANCE", null, { outerDiameterMm: null, lengthMm: null }, null, ["src-depuy-milagro"], "recipe-interference"),

  variant("var-conmed-infinity", "fam-conmed-infinity", "Infinity Retro-Reamers", null, { cutterDiameterMm: null, shaftDiameterMm: null }, [...INFINITY_RETRO_SIZES_MM], ["src-conmed-infinity"], "recipe-fixed-retro"),
  variant("var-conmed-spade-pin", "fam-conmed-infinity-guides", "Infinity Spade Tip Guide Pin", null, { spadeTipDiameterMm: 3.5, shaftDiameterMm: 2.4 }, null, ["src-conmed-guides"], "recipe-stepped-button"),
  variant("var-conmed-tibial-button-14", "fam-conmed-buttons", "Infinity Tibial Button 14 mm", null, { lengthMm: 14, widthMm: null, thicknessMm: null }, [14], ["src-conmed-tibial-button"], "recipe-button"),
  variant("var-conmed-tibial-button-17", "fam-conmed-buttons", "Infinity Tibial Button 17 mm", null, { lengthMm: 17, widthMm: null, thicknessMm: null }, [17], ["src-conmed-tibial-button"], "recipe-button"),
  variant("var-conmed-graftmax", "fam-conmed-buttons", "GraftMax Adjustable Button", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-conmed-buttons"], "recipe-button"),
  variant("var-conmed-genesys", "fam-conmed-genesys", "GENESYS Matryx", null, { outerDiameterMm: null, lengthMm: null }, null, ["src-conmed-genesys"], "recipe-interference"),
  variant("var-conmed-y-knot", "fam-conmed-y-knot", "Y-Knot PRO Flex", null, { pilotDiameterMm: null, anchorLengthMm: null }, null, ["src-conmed-anchor"], "recipe-anchor"),

  variant("var-medacta-mars", "fam-medacta-mars", "M-ARS ACL System", null, { kWireDiameterMm: 2.4, overdrillDiameterMm: 4.5, profileWidthMm: null, profileHeightMm: null }, null, ["src-medacta-mars"], "recipe-overlap-dilator", { overlappingHoleCount: 3, femoralAimerAnglesDeg: "35,50", femoralProfile: "flat/chamfered rectangular", tibialProfile: "C-shaped/ribbon" }),
  variant("var-medacta-mecta-acl-round", "fam-medacta-mecta-acl", "Mecta ACL SB Circular Reaming", null, { cutterDiameterMm: null }, halfSteps(4.5, 12), ["src-medacta-mecta-acl"], "recipe-full-tunnel"),
  variant("var-medacta-mecta-acl-oval", "fam-medacta-mecta-acl", "Mecta ACL SB Oval Dilators", null, { majorDiameterMm: null, minorDiameterMm: null }, halfSteps(6, 12), ["src-medacta-mecta-acl"], "recipe-dilator"),
  variant("var-medacta-fairfix", "fam-medacta-buttons", "FairFix", null, { plateLengthMm: null, plateWidthMm: null, passingChannelDiameterMm: null }, null, ["src-medacta-fixation"], "recipe-button"),
  variant("var-medacta-mectascrew", "fam-medacta-screws", "MectaScrew", null, { outerDiameterMm: null, lengthMm: null }, null, ["src-medacta-screws"], "recipe-interference"),
  variant("var-medacta-draw-tight", "fam-medacta-anchors", "Draw Tight Peripheral Anchor", null, { pilotDiameterMm: null, anchorLengthMm: null }, null, ["src-medacta-peripheral"], "recipe-anchor", {}, "region_ifu_check_required"),

  variant("var-generic", "fam-generic-parametric", "Generic Parametric Geometry", null, { diameterMm: null, depthMm: null, lengthMm: null }, null, [], null, { manufacturerClaim: false }, "generic_parametric"),
  variant("var-institution", "fam-institution-defined", "Institution Defined (requires local verification)", null, { diameterMm: null, depthMm: null, lengthMm: null }, null, [], null, { requiresVerificationOwner: true }, "institution_defined"),
] as const;

const instrument = (
  id: string,
  familyId: string,
  name: string,
  kind: Instrument["kind"],
  sku: string | null,
  dimensionsMm: Record<string, number | null>,
  selectableSizesMm: number[] | null,
  sourceIds: string[],
  geometryRecipeId: string | null,
  status: CatalogStatus = "manufacturer_documented",
  settings: Record<string, string | number | boolean | null> = {},
): Instrument => ({ id, familyId, name, kind, sku, side: null, dimensionsMm, selectableSizesMm, settings, status, sourceIds, geometryRecipeId });

export const INSTRUMENTS: readonly Instrument[] = [
  instrument("inst-arthrex-flipcutter", "fam-arthrex-flipcutter-iii", "FlipCutter III", "cutter", "AR-1204FF", { pinPathwayDiameterMm: 3.5, cutterDiameterMm: null }, [...FLIPCUTTER_III_CUTTER_SIZES_MM], ["src-arthrex-flipcutter"], "recipe-adjustable-retro"),
  instrument("inst-arthrex-retro-guide", "fam-arthrex-retroconstruction", "RetroConstruction Guide Set", "guide", "AR-1510S", { offsetMm: null }, null, ["src-arthrex-retroconstruction"], "recipe-guide-access", "manufacturer_documented", { angleDeg: null }),
  instrument("inst-arthrex-retro-hook", "fam-arthrex-retroconstruction", "RetroConstruction Procedure-Specific Marking Hook", "hook_arm", null, { offsetMm: null }, null, ["src-arthrex-retroconstruction"], "recipe-guide-access"),
  instrument("inst-arthrex-retro-sleeve-2-4", "fam-arthrex-retroconstruction", "2.4 mm Antegrade Sleeve", "sleeve_bullet", null, { innerDiameterMm: 2.4 }, [2.4], ["src-arthrex-retroconstruction"], "recipe-guide-access"),
  instrument("inst-arthrex-retro-sleeve-3-5", "fam-arthrex-retroconstruction", "3.5 mm FlipCutter Sleeve", "sleeve_bullet", null, { innerDiameterMm: 3.5 }, [3.5], ["src-arthrex-retroconstruction"], "recipe-guide-access"),
  instrument("inst-arthrex-coring", "fam-arthrex-coring", "Disposable Coring Reamers", "trephine", null, { outerDiameterMm: null, innerDiameterMm: null }, Array.from({ length: 8 }, (_, index) => index + 7), ["src-arthrex-coring"], "recipe-coring"),
  instrument("inst-arthrex-dilators", "fam-arthrex-dilators", "Tunnel Dilators", "dilator", null, { diameterMm: null }, halfSteps(5.5, 12), ["src-arthrex-catalog"], "recipe-dilator"),
  instrument("inst-smith-trunav-pin", "fam-smith-trunav", "TRUNAV Guide Wire", "pin", null, { diameterMm: 2.4 }, [2.4], ["src-smith-trunav"], "recipe-rigid-pin"),
  instrument("inst-smith-trunav", "fam-smith-trunav", "TRUNAV Retrograde Drill", "cutter", null, { antegradeDiameterMm: 4.9, cutterDiameterMm: null }, [...TRUNAV_SOCKET_SIZES_MM], ["src-smith-trunav"], "recipe-antegrade-retro-hybrid"),
  instrument("inst-smith-pinpoint", "fam-smith-pinpoint", "ACUFEX PINPOINT Anatomic ACL Guide", "guide", null, { offsetMm: null }, null, ["src-smith-pinpoint"], "recipe-guide-access", "manufacturer_documented", { pivotAngleDeg: null }),
  instrument("inst-smith-root-aimer", "fam-smith-root", "Meniscal Root Aimer", "hook_arm", null, { offsetMm: null }, [5, 6, 7, 8], ["src-smith-root"], "recipe-guide-access"),
  instrument("inst-stryker-flex", "fam-stryker-versitomic-flex", "VersiTomic Flexible Reamer", "reamer", null, { diameterMm: null, minimumBendRadiusMm: null }, [...VERSITOMIC_FLEXIBLE_SIZES_MM], ["src-stryker-flexible"], "recipe-flexible-reamer"),
  instrument("inst-stryker-rr-guide", "fam-stryker-versitomic-guides", "VersiTomic RR Guide Body", "guide", null, {}, null, ["src-stryker-rr"], "recipe-guide-access", "manufacturer_documented", { angleDeg: null }),
  instrument("inst-stryker-rr-root-arm", "fam-stryker-versitomic-guides", "VersiTomic RR Meniscal Root Arm / Hook", "hook_arm", null, { offsetMm: null }, null, ["src-stryker-rr"], "recipe-guide-access"),
  instrument("inst-stryker-isi-notcher", "fam-stryker-rigid-isi", "VersiTomic ISI Tunnel Notcher", "saw_burr_osteotome", null, { widthMm: 2.3 }, [2.3], ["src-stryker-isi"], "recipe-chamfer"),
  instrument("inst-zimmer-switchcut", "fam-zimmer-switchcut", "SwitchCut Reamer", "cutter", null, { diameterMm: null, pilotDiameterMm: null }, [...SWITCHCUT_SIZES_MM], ["src-zimmer-switchcut"], "recipe-adjustable-retro"),
  instrument("inst-zimmer-switchcut-guide", "fam-zimmer-switchcut", "SwitchCut Femoral / Point-to-Point Guide", "guide", null, { offsetMm: null }, null, ["src-zimmer-switchcut"], "recipe-guide-access", "manufacturer_documented", { angleDeg: null }),
  instrument("inst-zimmer-precision-flex", "fam-zimmer-precision-flex", "Precision Flexible Reamer", "reamer", null, { diameterMm: null, minimumBendRadiusMm: null }, [...PRECISION_FLEXIBLE_SIZES_MM], ["src-zimmer-precision"], "recipe-flexible-reamer"),
  instrument("inst-depuy-twistr", "fam-depuy-twistr", "TWISTR Retrograde Reamer", "cutter", null, { diameterMm: null, pilotDiameterMm: null }, [...TWISTR_SIZES_MM], ["src-depuy-twistr"], "recipe-adjustable-retro"),
  instrument("inst-depuy-cruciate-guide", "fam-depuy-cruciate-plus", "Cruciate+ Point-to-Point / Capture Aimer", "guide", null, { offsetMm: null }, null, ["src-depuy-twistr"], "recipe-guide-access", "manufacturer_documented", { angleDeg: null }),
  instrument("inst-depuy-cruciate-bullet", "fam-depuy-cruciate-plus", "Cruciate+ Reamer Bullet", "sleeve_bullet", null, { innerDiameterMm: 4.8 }, [4.8], ["src-depuy-twistr"], "recipe-guide-access"),
  instrument("inst-depuy-cruciate-insert", "fam-depuy-cruciate-plus", "Cruciate+ Insert", "sleeve_bullet", null, { innerDiameterMm: 2.4 }, [2.4], ["src-depuy-twistr"], "recipe-guide-access"),
  instrument("inst-conmed-infinity", "fam-conmed-infinity", "Infinity Retro-Reamer", "cutter", null, { cutterDiameterMm: null, shaftDiameterMm: null }, [...INFINITY_RETRO_SIZES_MM], ["src-conmed-infinity"], "recipe-fixed-retro"),
  instrument("inst-conmed-infinity-guide", "fam-conmed-infinity-guides", "Infinity Modular Guide", "guide", null, { footprintOffsetMm: null }, null, ["src-conmed-guides"], "recipe-guide-access", "manufacturer_documented", { angleDeg: null }),
  instrument("inst-conmed-sentinel", "fam-conmed-sentinel", "Sentinel / GraftMax Flex Sentinel", "reamer", null, { diameterMm: null }, null, ["src-conmed-reamers"], "recipe-flexible-reamer", "manufacturer_documented", { protectedArcDeg: 270 }),
  instrument("inst-conmed-badger", "fam-conmed-badger", "Badger Reamer", "reamer", null, { headDiameterMm: null, shaftDiameterMm: null }, null, ["src-conmed-reamers"], "recipe-headed-reamer"),
  instrument("inst-medacta-mars-pin", "fam-medacta-mars", "M-ARS K-wire", "pin", null, { diameterMm: 2.4 }, [2.4], ["src-medacta-mars"], "recipe-rigid-pin"),
  instrument("inst-medacta-mars-guide-35", "fam-medacta-mars", "M-ARS Femoral Aimer 35°", "guide", null, {}, null, ["src-medacta-mars"], "recipe-guide-access", "manufacturer_documented", { angleDeg: 35 }),
  instrument("inst-medacta-mars-guide-50", "fam-medacta-mars", "M-ARS Femoral Aimer 50°", "guide", null, {}, null, ["src-medacta-mars"], "recipe-guide-access", "manufacturer_documented", { angleDeg: 50 }),
  instrument("inst-medacta-mars-overdrill", "fam-medacta-mars", "M-ARS Overdrill", "drill", null, { diameterMm: 4.5 }, [4.5], ["src-medacta-mars"], "recipe-overlap-dilator"),
  instrument("inst-generic-pin", "fam-generic-parametric", "Generic Beath / Eyelet / Spade Pin", "pin", null, { diameterMm: null, lengthMm: null }, null, [], "recipe-rigid-pin", "generic_parametric"),
  instrument("inst-generic-guide", "fam-generic-parametric", "Generic Drill Guide", "guide", null, { offsetMm: null, sleeveDiameterMm: null }, null, [], "recipe-guide-access", "generic_parametric", { angleDeg: null }),
  instrument("inst-generic-hook-arm", "fam-generic-parametric", "Generic Hook / Arm", "hook_arm", null, { offsetMm: null }, null, [], "recipe-guide-access", "generic_parametric", { angleDeg: null }),
  instrument("inst-generic-sleeve", "fam-generic-parametric", "Generic Sleeve / Bullet / Depth Stop", "sleeve_bullet", null, { innerDiameterMm: null, outerDiameterMm: null }, null, [], "recipe-guide-access", "generic_parametric"),
  instrument("inst-generic-reamer", "fam-generic-parametric", "Generic Straight / Headed / Low-Profile Reamer", "reamer", null, { diameterMm: null, shaftDiameterMm: null }, null, [], "recipe-full-tunnel", "generic_parametric"),
  instrument("inst-generic-flex", "fam-generic-parametric", "Generic Flexible Reamer and Curved Guide", "reamer", null, { diameterMm: null, minimumBendRadiusMm: null }, null, [], "recipe-flexible-reamer", "generic_parametric"),
  instrument("inst-generic-retro", "fam-generic-parametric", "Generic Adjustable / Fixed Retrograde Reamer", "cutter", null, { pilotDiameterMm: null, cutterDiameterMm: null }, null, [], "recipe-adjustable-retro", "generic_parametric"),
  instrument("inst-generic-coring", "fam-generic-parametric", "Generic Coring Trephine", "trephine", null, { innerDiameterMm: null, outerDiameterMm: null }, null, [], "recipe-coring", "generic_parametric"),
  instrument("inst-generic-dilator", "fam-generic-parametric", "Generic Sequential Dilator / Compactor", "dilator", null, { profileWidthMm: null, profileHeightMm: null }, null, [], "recipe-dilator", "generic_parametric"),
  instrument("inst-generic-anchor", "fam-generic-parametric", "Generic Anchor Drill / Punch / Tap", "punch", null, { pilotDiameterMm: null, depthMm: null }, null, [], "recipe-anchor", "generic_parametric"),
  instrument("inst-generic-trough", "fam-generic-parametric", "Generic Burr / Saw / Osteotome / Trough Template", "saw_burr_osteotome", null, { widthMm: null, depthMm: null }, null, [], "recipe-trough", "generic_parametric"),
] as const;

export const COMPATIBILITY_EDGES: readonly CompatibilityEdge[] = [
  { id: "edge-retroconstruction-flipcutter", fromId: "fam-arthrex-retroconstruction", toId: "var-arthrex-flipcutter-iii", relationship: "compatible", rationale: "Documented 3.5 mm FlipCutter sleeve interface; exact assembled chain still requires user verification.", sourceIds: ["src-arthrex-retroconstruction"], marketOrRegion: "Global source; verify regional IFU" },
  { id: "edge-pinpoint-trunav", fromId: "fam-smith-pinpoint", toId: "var-smith-trunav", relationship: "compatible", rationale: "PINPOINT is documented as paired with TRUNAV; exact local components remain explicit selections.", sourceIds: ["src-smith-pinpoint", "src-smith-trunav"], marketOrRegion: "Global source; verify regional IFU" },
  { id: "edge-cruciate-twistr", fromId: "var-depuy-cruciate-plus", toId: "var-depuy-twistr", relationship: "compatible", rationale: "Documented as one system; guide, side, insert, pin, and size remain separately selected.", sourceIds: ["src-depuy-twistr"], marketOrRegion: "Global source; verify regional IFU" },
] as const;

export const REGION_AVAILABILITY: readonly RegionAvailability[] = PRODUCT_FAMILIES
  .filter(({ status }) => status === "manufacturer_documented" || status === "region_ifu_check_required")
  .map(({ id, sourceIds }) => ({
    id: `region-${id}`,
    catalogItemId: id,
    marketOrRegion: "Unspecified",
    status: "unverified",
    checkedAt: CATALOG_CHECKED_AT,
    sourceIds,
  }));

export const REGION_INSTITUTION_SETS: readonly RegionInstitutionSet[] = [
  { id: "north-america-unverified", label: "North America", marketOrRegion: "North America · unverified", status: "region_ifu_check_required", checkedAt: CATALOG_CHECKED_AT, sourceIds: [] },
  { id: "institution-local", label: "Institution-controlled local set", marketOrRegion: "Institution controlled", status: "institution_defined", checkedAt: CATALOG_CHECKED_AT, sourceIds: [] },
  { id: "generic-set", label: "Generic Parametric set", marketOrRegion: "Not manufacturer-specific", status: "generic_parametric", checkedAt: CATALOG_CHECKED_AT, sourceIds: [] },
] as const;

export const INSTITUTION_OVERRIDES: readonly InstitutionOverride[] = [];

export const CATALOG_VERSION: CatalogVersion = {
  id: "catalog-multilig-1.0.0",
  version: DEVICE_CATALOG_VERSION,
  createdAt: "2026-08-02T00:00:00.000Z",
  checkedAt: CATALOG_CHECKED_AT,
  marketOrRegion: "Seed catalog; regional IFU and institutional verification required",
  sourceIds: CATALOG_SOURCES.map(({ id }) => id),
  manufacturerIds: MANUFACTURERS.map(({ id }) => id),
  immutable: true,
};

export interface DeviceCatalogSnapshot {
  version: CatalogVersion;
  sources: readonly CatalogSource[];
  manufacturers: readonly Manufacturer[];
  families: readonly ProductFamily[];
  variants: readonly ProductVariant[];
  instruments: readonly Instrument[];
  geometryRecipes: readonly GeometryRecipe[];
  compatibilityEdges: readonly CompatibilityEdge[];
  regionAvailability: readonly RegionAvailability[];
  regionInstitutionSets: readonly RegionInstitutionSet[];
  institutionOverrides: readonly InstitutionOverride[];
}

export const DEVICE_CATALOG: DeviceCatalogSnapshot = {
  version: CATALOG_VERSION,
  sources: CATALOG_SOURCES,
  manufacturers: MANUFACTURERS,
  families: PRODUCT_FAMILIES,
  variants: PRODUCT_VARIANTS,
  instruments: INSTRUMENTS,
  geometryRecipes: GEOMETRY_RECIPES,
  compatibilityEdges: COMPATIBILITY_EDGES,
  regionAvailability: REGION_AVAILABILITY,
  regionInstitutionSets: REGION_INSTITUTION_SETS,
  institutionOverrides: INSTITUTION_OVERRIDES,
};

export function getManufacturer(id: string): Manufacturer | undefined {
  return MANUFACTURERS.find((item) => item.id === id);
}

export function getProductFamilies(manufacturerId: string): ProductFamily[] {
  return PRODUCT_FAMILIES.filter((item) => item.manufacturerId === manufacturerId);
}

export function getProductVariants(familyId: string): ProductVariant[] {
  return PRODUCT_VARIANTS.filter((item) => item.familyId === familyId);
}

export function getFamilyInstruments(familyId: string): Instrument[] {
  return INSTRUMENTS.filter((item) => item.familyId === familyId);
}

export function getCatalogSources(sourceIds: readonly string[]): CatalogSource[] {
  const ids = new Set(sourceIds);
  return CATALOG_SOURCES.filter((item) => ids.has(item.id));
}
