import type { AnalysisResult, ChannelPlan, PlanCase, Vector3 } from "../domain/types";
import type { AnalysisResult as EngineAnalysisResult } from "../geometry/collision";
import type { ViewerMeshPayload } from "../viewer/types";
import { stablePlanHash } from "../store/planHistory";
import {
  CATALOG_SOURCES,
  CATALOG_VERSION,
  COMPATIBILITY_EDGES,
  GEOMETRY_RECIPES,
  INSTRUMENTS,
  INSTITUTION_OVERRIDES,
  MANUFACTURERS,
  PRODUCT_FAMILIES,
  PRODUCT_VARIANTS,
  REGION_AVAILABILITY,
  REGION_INSTITUTION_SETS,
} from "../catalog/deviceCatalog";
import { assessCatalogChain, instrumentChainSelectionHash } from "../catalog/chainValidation";
import { missingChainSelections } from "../app/planOperations";

export const PLANNING_NOTICE =
  "Clinician-directed planning only — not for autonomous navigation and not a patient-specific surgical guide.";

const IDENTIFYING_KEYS = new Set([
  "patientname",
  "patientid",
  "medicalrecordnumber",
  "mrn",
  "dateofbirth",
  "dob",
  "accessionnumber",
]);

const REDACTED_FREE_TEXT_KEYS = new Set(["notes", "note", "rationale", "author", "reviewer", "verifiedby"]);

function deidentify(value: unknown, keyName = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => deidentify(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !IDENTIFYING_KEYS.has(key.toLowerCase().replaceAll("_", "")))
        .filter(([key]) => key.toLowerCase() !== "filename")
        .map(([key, entry]) => [key, deidentify(entry, key)]),
    );
  }
  const normalizedKey = keyName.toLowerCase().replaceAll("_", "");
  if (REDACTED_FREE_TEXT_KEYS.has(normalizedKey) && typeof value === "string" && value.length) {
    return "[redacted from de-identified export]";
  }
  if (normalizedKey === "actorid" && typeof value === "string") return "clinician-role";
  return value;
}

export interface PlanExportEnvelope {
  format: "multilig-planner-json";
  exportVersion: "1.0.0";
  exportedAt: string;
  deidentified: true;
  notice: string;
  sourcePlanHash: string;
  plan: unknown;
  catalogReferences: {
    version: string;
    resolvedAgainstInstalledCatalog: boolean;
    manufacturers: unknown[];
    families: unknown[];
    variants: unknown[];
    instruments: unknown[];
    sources: unknown[];
    regionAvailability: unknown[];
    regionInstitutionSets: unknown[];
    geometryRecipes: unknown[];
    compatibilityEdges: unknown[];
    institutionOverrides: unknown[];
  };
  disclosures: {
    incompleteInstrumentChainChannelIds: string[];
    notEvaluatedAnalysisIds: string[];
    missingSafetyAnatomy: string[];
    userVerificationRequired: true;
  };
}

function activeChannels(plan: PlanCase): ChannelPlan[] {
  return plan.variants.find((variant) => variant.id === plan.activeVariantId)?.channels ?? [];
}

function activeAnalysis(plan: PlanCase): AnalysisResult[] {
  return plan.variants.find((variant) => variant.id === plan.activeVariantId)?.analysis ?? [];
}

function recomputedChannelStatus(plan: PlanCase, channel: ChannelPlan) {
  const chain = channel.instrumentChain;
  const missing = missingChainSelections(chain);
  const catalog = assessCatalogChain(chain);
  const verificationCurrent = Boolean(
    chain.userVerified &&
    chain.verification &&
    chain.verification.selectionHash === instrumentChainSelectionHash(chain) &&
    chain.verification.catalogVersion === plan.catalogVersion &&
    channel.graft?.verifiedByUser &&
    (channel.fixation.length === 0 || channel.fixation.every((fixation) => fixation.verifiedByUser)),
  );
  const status = catalog.incompatibleReasons.length
    ? "incompatible"
    : missing.length
      ? "incomplete"
      : verificationCurrent
        ? "complete"
        : "warning";
  return { status, missing, catalog, verificationCurrent };
}

function asVector3(point: { x: number; y: number; z: number }): Vector3 {
  return [point.x, point.y, point.z];
}

export function withComputedAnalysis(
  plan: PlanCase,
  results: readonly EngineAnalysisResult[],
  evaluatedAt = new Date().toISOString(),
): PlanCase {
  const currentAnalysis = new Map(activeAnalysis(plan).map((result) => [result.id, result]));
  const analysis: AnalysisResult[] = results.map((result) => {
    const geometryHashes: [string, string] = [result.geometryHashA, result.geometryHashB];
    const existing = currentAnalysis.get(result.id);
    const unchanged = existing &&
      existing.thresholdMm === result.thresholdMm &&
      existing.thresholdSource === result.thresholdSource &&
      existing.geometryHashes[0] === geometryHashes[0] &&
      existing.geometryHashes[1] === geometryHashes[1] &&
      existing.state === result.status &&
      existing.evaluationState === result.evaluationState;
    return {
      id: result.id,
      planVariantId: plan.activeVariantId,
      objectAId: result.objectAId,
      objectBId: result.objectBId,
      signedClearanceMm: result.signedClearanceMm,
      state: result.status,
      ...(result.closestPoints ? {
        closestPointA: asVector3(result.closestPoints.pointA),
        closestPointB: asVector3(result.closestPoints.pointB),
      } : {}),
      thresholdMm: result.thresholdMm,
      thresholdSource: result.thresholdSource,
      evaluationState: result.evaluationState,
      missingRequirements: [...result.missingRequirements],
      nearestLayerAId: result.nearestLayerAId,
      nearestLayerBId: result.nearestLayerBId,
      conservative: result.conservative,
      explanation: result.message,
      geometryHashes,
      evaluatedAt: unchanged ? existing.evaluatedAt : evaluatedAt,
    };
  });
  return {
    ...plan,
    variants: plan.variants.map((variant) => variant.id === plan.activeVariantId ? { ...variant, analysis } : { ...variant, analysis: [] }),
  };
}

function selectedCatalogReferences(plan: PlanCase) {
  if (plan.catalogVersion !== CATALOG_VERSION.version) {
    return {
      version: plan.catalogVersion,
      resolvedAgainstInstalledCatalog: false,
      manufacturers: [],
      families: [],
      variants: [],
      instruments: [],
      sources: [],
      regionAvailability: [],
      regionInstitutionSets: [],
      geometryRecipes: [],
      compatibilityEdges: [],
      institutionOverrides: [],
    };
  }
  const channels = plan.variants.flatMap((variant) => variant.channels);
  const manufacturerIds = new Set(channels.flatMap((channel) => channel.instrumentChain.manufacturerId ? [channel.instrumentChain.manufacturerId] : []));
  const familyIds = new Set(channels.flatMap((channel) => channel.instrumentChain.productFamilyId ? [channel.instrumentChain.productFamilyId] : []));
  const variantIds = new Set(channels.flatMap((channel) => [
    ...(channel.instrumentChain.productVariantId ? [channel.instrumentChain.productVariantId] : []),
    ...channel.instrumentChain.fixationImplantIds,
  ]));
  const instrumentIds = new Set(channels.flatMap((channel) => [
    channel.instrumentChain.guideInstrumentId,
    channel.instrumentChain.hookArmOffsetAngle.hookOrArmId,
    channel.instrumentChain.sleeveBulletDepthStop.sleeveOrBulletId,
    channel.instrumentChain.pinInstrumentId,
    channel.instrumentChain.cutterInstrumentId,
    ...channel.instrumentChain.fixationPreparationInstrumentIds,
  ].filter((id): id is string => Boolean(id))));
  PRODUCT_VARIANTS.filter((item) => variantIds.has(item.id)).forEach((item) => familyIds.add(item.familyId));
  INSTRUMENTS.filter((item) => instrumentIds.has(item.id)).forEach((item) => familyIds.add(item.familyId));
  PRODUCT_FAMILIES.filter((item) => familyIds.has(item.id)).forEach((item) => manufacturerIds.add(item.manufacturerId));
  const resolvedFamilies = PRODUCT_FAMILIES.filter((item) => familyIds.has(item.id));
  const resolvedVariants = PRODUCT_VARIANTS.filter((item) => variantIds.has(item.id));
  const resolvedInstruments = INSTRUMENTS.filter((item) => instrumentIds.has(item.id));
  const sourceIds = new Set(channels.flatMap((channel) => channel.instrumentChain.sourceIds));
  [...resolvedFamilies, ...resolvedVariants, ...resolvedInstruments].forEach((item) => item.sourceIds.forEach((id) => sourceIds.add(id)));
  const recipeIds = new Set<string>();
  resolvedFamilies.forEach((item) => item.geometryRecipeIds.forEach((id) => recipeIds.add(id)));
  [...resolvedVariants, ...resolvedInstruments].forEach((item) => { if (item.geometryRecipeId) recipeIds.add(item.geometryRecipeId); });
  const selectedItemIds = new Set([...manufacturerIds, ...familyIds, ...variantIds, ...instrumentIds]);
  return {
    version: plan.catalogVersion,
    resolvedAgainstInstalledCatalog: true,
    manufacturers: MANUFACTURERS.filter((item) => manufacturerIds.has(item.id)),
    families: resolvedFamilies,
    variants: resolvedVariants,
    instruments: resolvedInstruments,
    sources: CATALOG_SOURCES.filter((item) => sourceIds.has(item.id)),
    regionAvailability: REGION_AVAILABILITY.filter((item) => familyIds.has(item.catalogItemId) || variantIds.has(item.catalogItemId) || instrumentIds.has(item.catalogItemId)),
    regionInstitutionSets: REGION_INSTITUTION_SETS.filter((item) => channels.some((channel) => channel.instrumentChain.regionInstitutionSetId === item.id)),
    geometryRecipes: GEOMETRY_RECIPES.filter((item) => recipeIds.has(item.id)),
    compatibilityEdges: COMPATIBILITY_EDGES.filter((edge) => selectedItemIds.has(edge.fromId) || selectedItemIds.has(edge.toId)),
    institutionOverrides: INSTITUTION_OVERRIDES.filter((override) => selectedItemIds.has(override.catalogItemId)),
  };
}

export function createPlanExport(plan: PlanCase): PlanExportEnvelope {
  const channels = plan.variants.flatMap((variant) => variant.channels);
  const analysis = plan.variants.flatMap((variant) => variant.analysis);
  const missingSafetyAnatomy: string[] = [];
  const anatomyKinds = new Set(plan.anatomy
    .filter((object) => object.reviewStatus === "approved" && analysis.some((result) =>
      result.evaluationState === "evaluated" && (result.objectAId === object.id || result.objectBId === object.id)))
    .map((object) => object.kind));
  if (!anatomyKinds.has("danger_region")) missingSafetyAnatomy.push("posterior neurovascular and user danger regions");
  if (!anatomyKinds.has("femur") || !anatomyKinds.has("tibia") || !anatomyKinds.has("fibula")) missingSafetyAnatomy.push("reviewed femur, tibia, and fibula cortex meshes");
  if (!anatomyKinds.has("cartilage")) missingSafetyAnatomy.push("registered articular cartilage/surface anatomy");
  if (!anatomyKinds.has("physis")) missingSafetyAnatomy.push("physis");
  if (!anatomyKinds.has("previous_tunnel")) missingSafetyAnatomy.push("previous tunnels");
  if (!anatomyKinds.has("previous_hardware")) missingSafetyAnatomy.push("previous hardware");
  if (!anatomyKinds.has("osteotomy_hardware")) missingSafetyAnatomy.push("osteotomy hardware");

  const safePlan = structuredClone(plan);
  safePlan.deidentifiedLabel = `Case ${stablePlanHash(plan.id).slice(-8)}`;
  return {
    format: "multilig-planner-json",
    exportVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    deidentified: true,
    notice: PLANNING_NOTICE,
    sourcePlanHash: stablePlanHash(plan),
    plan: deidentify(safePlan),
    catalogReferences: selectedCatalogReferences(plan),
    disclosures: {
      incompleteInstrumentChainChannelIds: channels
        .filter((channel) => recomputedChannelStatus(plan, channel).status !== "complete")
        .map((channel) => channel.id),
      notEvaluatedAnalysisIds: analysis
        .filter((result) => result.state === "not_evaluated")
        .map((result) => result.id),
      missingSafetyAnatomy,
      userVerificationRequired: true,
    },
  };
}

export function planToJson(plan: PlanCase): string {
  return JSON.stringify(createPlanExport(plan), null, 2);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function channelsToCsv(plan: PlanCase): string {
  const header = [
    "variant_id",
    "variant_name",
    "procedure_id",
    "procedure_identity",
    "channel_id",
    "label",
    "bone",
    "geometry_type",
    "profile",
    "cross_section_json",
    "explicit_geometry_dimensions_json",
    "diameter_mm",
    "depth_mm",
    "guide_pin_diameter_mm",
    "guide_pin_provenance",
    "trajectory_control_mode",
    "aperture_x_ras_mm",
    "aperture_y_ras_mm",
    "aperture_z_ras_mm",
    "vector_x",
    "vector_y",
    "vector_z",
    "orientation_deg",
    "region_institution_set_id",
    "market_region",
    "manufacturer_id",
    "manufacturer_name",
    "product_family_id",
    "product_family_name",
    "product_variant_id",
    "product_model",
    "product_sku",
    "guide_id",
    "guide_side",
    "hook_arm_id",
    "hook_offset_mm",
    "hook_angle_deg",
    "sleeve_bullet_id",
    "depth_stop_mm",
    "pin_id",
    "cutter_id",
    "exact_size_profile_id",
    "depth_full_tunnel_mode",
    "instrument_depth_mm",
    "graft_id",
    "fixation_ids",
    "fixation_preparation_ids",
    "catalog_source_ids",
    "chain_status",
    "user_verified",
    "verified_at",
    "missing_chain_selections",
    "warnings",
    "schema_version",
    "geometry_generator_version",
    "catalog_version",
    "analysis_summary",
    "analysis_geometry_hashes",
  ];
  const active = plan.variants.find((variant) => variant.id === plan.activeVariantId);
  const analysis = active?.analysis ?? [];
  const rows = (active?.channels ?? []).map((channel) => {
    const chain = channel.instrumentChain;
    const procedure = plan.procedures.find((item) => item.id === channel.procedureId);
    const manufacturer = MANUFACTURERS.find((item) => item.id === chain.manufacturerId);
    const family = PRODUCT_FAMILIES.find((item) => item.id === chain.productFamilyId);
    const variant = PRODUCT_VARIANTS.find((item) => item.id === chain.productVariantId);
    const assessed = recomputedChannelStatus(plan, channel);
    const channelAnalysis = analysis.filter((result) => result.objectAId === channel.id || result.objectBId === channel.id);
    return [
      active?.id,
      active?.name,
      channel.procedureId,
      procedure?.structure,
      channel.id,
      channel.label,
      channel.bone,
      channel.geometryType,
      channel.crossSection.kind,
      JSON.stringify(channel.crossSection),
      JSON.stringify(channel.dimensionsMm ?? {}),
      channel.diameterMm ?? null,
      channel.depthMm,
      channel.guidePin?.diameterMm ?? null,
      channel.guidePin?.provenance ?? null,
      channel.trajectoryControlMode ?? null,
      ...channel.aperture,
      ...channel.vector,
      channel.orientationDeg,
      chain.regionInstitutionSetId,
      chain.marketOrRegion,
      chain.manufacturerId,
      manufacturer?.name,
      chain.productFamilyId,
      family?.name,
      chain.productVariantId,
      variant?.name,
      variant?.sku,
      chain.guideInstrumentId,
      chain.guideSide,
      chain.hookArmOffsetAngle.hookOrArmId,
      chain.hookArmOffsetAngle.offsetMm,
      chain.hookArmOffsetAngle.angleDeg,
      chain.sleeveBulletDepthStop.sleeveOrBulletId,
      chain.sleeveBulletDepthStop.depthStopMm,
      chain.pinInstrumentId,
      chain.cutterInstrumentId,
      chain.exactSizeOrProfileId,
      chain.depthOrFullTunnelSetting.mode,
      chain.depthOrFullTunnelSetting.depthMm,
      chain.graftSelectionId,
      chain.fixationImplantIds.join("|"),
      chain.fixationPreparationInstrumentIds.join("|"),
      chain.sourceIds.join("|"),
      assessed.status,
      assessed.verificationCurrent,
      chain.verification?.verifiedAt,
      assessed.missing.join(" | "),
      [...channel.warnings, ...assessed.catalog.incompatibleReasons, ...assessed.catalog.warningReasons].join(" | "),
      plan.schemaVersion,
      plan.geometryGeneratorVersion,
      plan.catalogVersion,
      channelAnalysis.map((result) => `${result.objectAId}<->${result.objectBId}:${result.state}:${result.signedClearanceMm ?? "N/E"}`).join(" | "),
      [...new Set(channelAnalysis.flatMap((result) => result.geometryHashes))].join("|"),
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function createHumanReadableReport(plan: PlanCase): string {
  const channels = activeChannels(plan);
  const analysis = activeAnalysis(plan);
  const report: string[] = [
    "# Multilig Planner — De-identified plan report",
    "",
    PLANNING_NOTICE,
    "",
    `Case: Case ${stablePlanHash(plan.id).slice(-8)}`,
    `Laterality: ${plan.laterality} (${plan.lateralityVerified ? "clinician verified" : "UNVERIFIED"})`,
    `Scale: ${plan.scaleVerified ? "verified" : "UNVERIFIED"}`,
    `Plan schema: ${plan.schemaVersion}`,
    `Geometry generator: ${plan.geometryGeneratorVersion}`,
    `Frozen catalog: ${plan.catalogVersion}`,
    `Informational clearance threshold: ${plan.analysisSettings.informationalClearanceThresholdMm} mm (${plan.analysisSettings.thresholdSource})`,
    "",
    "## Imaging and segmentation provenance",
    "",
    `- Immutable source records: ${plan.imaging.sources.length}`,
    `- Immutable derived imaging assets: ${plan.imaging.derivedAssets.length}`,
    `- Segmentation runs: ${plan.imaging.segmentationRuns.length}`,
    `- Segmentation adapter: ${plan.imaging.segmentationAdapterId} (${plan.imaging.segmentationValidationState})`,
    `- Orientation / transform review: ${plan.imaging.review.orientationVerified ? "verified" : "UNVERIFIED"}`,
    `- Separate bone identities: ${plan.imaging.review.boneIdentitiesVerified ? "verified" : "UNVERIFIED"}`,
    `- Manual correction records: ${plan.imaging.review.corrections.length}; mesh-quality records: ${Object.keys(plan.imaging.review.meshQuality).length}`,
    ...plan.imaging.segmentationRuns.flatMap((run) => [
      `- Run ${run.id}: ${run.algorithm.name} / ${run.algorithm.modelId}; model SHA-256 ${run.algorithm.modelSha256}; ${run.validationState}`,
      `  - Pipeline: ${run.algorithm.pipelineName}; nnUNetv2 ${run.algorithm.nnunetv2Version ?? "version unavailable"}; MAT revision ${run.algorithm.matPlannerRevision}`,
      `  - Registry SHA-256: ${run.algorithm.registrySha256}; algorithm source SHA-256: ${run.algorithm.algorithmSourceSha256}`,
      `  - Model chain: ${run.algorithm.modelDataset} / ${run.algorithm.modelTrainer} / ${run.algorithm.modelPlans} / ${run.algorithm.modelConfiguration}; folds ${run.algorithm.modelFolds.join(", ")}`,
      `  - Checkpoints: ${run.algorithm.checkpoints.map((checkpoint) => `fold ${checkpoint.fold} ${checkpoint.checkpointName} ${checkpoint.sha256} (${checkpoint.byteLength} bytes)`).join("; ")}`,
      `  - Model configuration artifacts: ${run.algorithm.configurationArtifacts.map((artifact) => `${artifact.name} ${artifact.sha256} (${artifact.byteLength} bytes)`).join("; ")}`,
      `  - Labels: femur ${run.labelStatus.femur}; tibia ${run.labelStatus.tibia}; fibula ${run.labelStatus.fibula}`,
      `  - Warnings: ${run.warningCodes.join(", ") || "none recorded"}`,
      `  - Not evaluated: ${run.notEvaluatedCodes.join(", ") || "none recorded"}`,
    ]),
    "",
    "## Planned channels",
    "",
  ];
  for (const channel of channels) {
    const chain = channel.instrumentChain;
    const manufacturer = MANUFACTURERS.find((item) => item.id === chain.manufacturerId);
    const family = PRODUCT_FAMILIES.find((item) => item.id === chain.productFamilyId);
    const variant = PRODUCT_VARIANTS.find((item) => item.id === chain.productVariantId);
    const assessed = recomputedChannelStatus(plan, channel);
    report.push(
      `### ${channel.label}`,
      "",
      `- Bone / geometry: ${channel.bone} / ${channel.geometryType}`,
      `- Cross-section: ${channel.crossSection.kind}; depth ${channel.depthMm ?? "not entered"} mm`,
      `- Guide pin: ${channel.guidePin?.diameterMm ?? "not entered"} mm; provenance ${channel.guidePin?.provenance ?? "not recorded"}; trajectory control ${channel.trajectoryControlMode ?? "legacy/unresolved"}`,
      `- Aperture / vector (patient RAS): [${channel.aperture.join(", ")}] mm / [${channel.vector.join(", ")}]`,
      `- Exact instrument chain: ${assessed.status}`,
      `- Region / market: ${chain.regionInstitutionSetId ?? "not selected"} / ${chain.marketOrRegion ?? "not selected"}`,
      `- Manufacturer / family: ${manufacturer?.name ?? chain.manufacturerId ?? "not selected"} / ${family?.name ?? chain.productFamilyId ?? "not selected"}`,
      `- Product model / SKU: ${variant?.name ?? chain.productVariantId ?? "not selected"} / ${variant?.sku ?? "not documented"}`,
      `- Guide / side: ${chain.guideInstrumentId ?? "not selected"} / ${chain.guideSide ?? "not selected"}`,
      `- Hook / offset / angle: ${chain.hookArmOffsetAngle.hookOrArmId ?? "not selected"} / ${chain.hookArmOffsetAngle.offsetMm ?? "not entered"} mm / ${chain.hookArmOffsetAngle.angleDeg ?? "not entered"}°`,
      `- Sleeve / depth stop: ${chain.sleeveBulletDepthStop.sleeveOrBulletId ?? "not selected"} / ${chain.sleeveBulletDepthStop.depthStopMm ?? "not entered"} mm`,
      `- Pin / cutter / exact setting: ${chain.pinInstrumentId ?? "not selected"} / ${chain.cutterInstrumentId ?? "not selected"} / ${chain.exactSizeOrProfileId ?? "not selected"}`,
      `- Instrument depth mode / value: ${chain.depthOrFullTunnelSetting.mode ?? "not selected"} / ${chain.depthOrFullTunnelSetting.depthMm ?? "not applicable"} mm`,
      `- Graft / fixation / preparation: ${chain.graftSelectionId ?? "not selected"} / ${chain.fixationImplantIds.join(", ") || "not selected"} / ${chain.fixationPreparationInstrumentIds.join(", ") || "not selected"}`,
      `- Catalog sources: ${chain.sourceIds.join(", ") || "unresolved"}`,
      `- User verification: ${assessed.verificationCurrent ? `current; recorded ${chain.verification?.verifiedAt ?? "without timestamp"}` : "required or stale"}`,
      `- Unresolved chain fields: ${assessed.missing.join("; ") || "none"}`,
      `- Warnings: ${[...channel.warnings, ...assessed.catalog.incompatibleReasons, ...assessed.catalog.warningReasons].join("; ") || "none recorded"}`,
      "",
    );
  }
  const active = plan.variants.find((variant) => variant.id === plan.activeVariantId);
  report.push("## Planned sequence", "");
  for (const step of active?.sequence ?? []) {
    report.push(`- ${step.order + 1}. ${step.kind.replaceAll("_", " ")}: ${step.label}${step.completed ? " (complete)" : ""}`);
  }
  report.push("", "## Audit provenance", "", `- Audit events preserved: ${plan.audit.length}`, `- Latest plan update: ${plan.updatedAt}`, "");
  report.push("## Geometric analysis", "");
  for (const result of analysis) {
    report.push(
      `- ${result.objectAId} ↔ ${result.objectBId}: ${result.state}; ${result.signedClearanceMm === null ? "not evaluated" : `${result.signedClearanceMm.toFixed(2)} mm edge-to-edge${result.conservative ? " (conservative support-volume estimate)" : ""}`}. ${result.explanation}`,
    );
  }
  const disclosures = createPlanExport(plan).disclosures;
  report.push(
    "",
    "## Disclosures",
    "",
    `- Incomplete exact chains: ${disclosures.incompleteInstrumentChainChannelIds.length || "none"}`,
    `- Not-evaluated results: ${disclosures.notEvaluatedAnalysisIds.length || "none"}`,
    `- Safety anatomy absent or not registered: ${disclosures.missingSafetyAnatomy.join("; ") || "none recorded"}`,
    "- Manufacturer-documented does not mean available, approved, indicated, recommended, or mutually compatible. Verify the current regional IFU and local tray.",
  );
  return report.join("\n");
}

export function meshesToObj(meshes: readonly ViewerMeshPayload[]): string {
  const lines = [`# ${PLANNING_NOTICE}`, "# Units: millimeters; frame: patient RAS"];
  let vertexOffset = 1;
  for (const mesh of meshes) {
    lines.push(`o ${mesh.name.replaceAll(/[^a-zA-Z0-9_.-]/g, "_")}`);
    mesh.vertices.forEach(([x, y, z]) => lines.push(`v ${x} ${y} ${z}`));
    mesh.faces.forEach(([a, b, c]) => lines.push(`f ${a + vertexOffset} ${b + vertexOffset} ${c + vertexOffset}`));
    vertexOffset += mesh.vertices.length;
  }
  return `${lines.join("\n")}\n`;
}

export function downloadText(fileName: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.replaceAll(/[^a-zA-Z0-9_.-]/g, "-");
  anchor.click();
  URL.revokeObjectURL(url);
}
