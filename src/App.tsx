/* eslint-disable react-refresh/only-export-components -- Shared legacy migration/import helpers support the compact workspace. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChannelPlan,
  CrossSection,
  InstrumentChain,
  PlanCase,
  ProcedureIdentity,
  SequenceStep,
} from "./domain/types";
import { CURRENT_PLAN_SCHEMA_VERSION } from "./domain/schema";
import {
  PROCEDURE_QUICK_ADD,
  getTechniquePresetsForProcedure,
} from "./presets/techniquePresets";
import {
  GeometryAnalysisCache,
  analyzeAllPairs,
  notEvaluatedForMissingAnatomy,
  type AnalysisResult as EngineAnalysisResult,
  type CollisionGeometry,
} from "./geometry/collision";
import { cross3, deterministicPerpendicular, dot3, normalize3 } from "./geometry/mesh";
import { GEOMETRY_GENERATOR_VERSION } from "./geometry/recipes";
import {
  MatViewerV2Adapter,
} from "./viewer/MatViewerV2Adapter";
import type {
  StandardView,
  ViewerHandleChange,
  ViewerLayer,
  ViewerMeshPayload,
  ViewerPlanningScene,
  ViewerScreenshotResult,
} from "./viewer/types";
import {
  DEFAULT_LAYER_VISIBILITY,
  PROCEDURE_COLORS,
  buildSyntheticAnatomyMeshes,
  buildViewerScene,
  tupleToVec3,
} from "./app/channelGeometry";
import { classifyChannelEntryTether } from "./app/channelEntryTether";
import {
  applyChannelDepthGeometryEdit,
  applyNumericVectorComponentEdit,
  applySurfaceConstrainedHandleCommit,
  withTibialSuperiorEnvelopeWarnings,
} from "./app/channelHandleEdit";
import {
  attachMissingForwardSurfaceStart,
  initializePendingChannelSurfacePlacements,
} from "./app/channelSurfaceInitialization";
import { toggleProcedureVisibility } from "./app/procedureVisibility";
import {
  defaultTrajectoryControlMode,
  isGuidePinSocketGeometry,
} from "./app/channelTrajectorySemantics";
import {
  DEFAULT_GENERIC_SOCKET_GUIDE_PIN_DIAMETER_MM,
  GENERIC_SOCKET_GUIDE_PIN_WARNING,
  LEGACY_SIMPLIFIED_TECHNIQUE_NOTE_PREFIX,
  SIMPLIFIED_TECHNIQUE_NOTE_PREFIX,
} from "./app/simplifiedTechniqueFlow";
import { migrateLegacyRootSutureAnchorPins } from "./app/legacyRootSutureAnchorPinMigration";
import { publicAssetPath } from "./publicAssetPath";
import { requireClinicianSelectedDimensions } from "./app/channelAnalysis";
import { createSyntheticDemoCase } from "./app/caseFactory";
import {
  createBundledDemoPlan,
  usesBundledDemoAnatomy,
} from "./demo/bundledDemo";
import {
  activeVariant,
  addTechniquePreset,
  cloneActiveVariant,
  finalizeChainState,
  procedureLabel,
  removePinTipOvershootFromPlan,
  restoreLegacyAnchorVisualTemplates,
  reorderSequence,
  setActiveVariant,
  updateChannel,
} from "./app/planOperations";
import {
  commitPlan,
  createPlanHistory,
  loadPlanLocally,
  redoPlan,
  savePlanLocally,
  stablePlanHash,
  undoPlan,
} from "./store/planHistory";
import {
  channelsToCsv,
  createHumanReadableReport,
  downloadText,
  meshesToObj,
  planToJson,
  withComputedAnalysis,
} from "./export/exporters";
import {
  SEGMENTATION_BOUNDARY,
  classifyImagingFile,
  createImmutableSource,
  type ImagingReviewState,
  type ImmutableImagingSource,
} from "./imaging/imagingAdapter";
import { MatNnunetClient } from "./imaging/matNnunetClient";
import {
  segmentationPlanPatch,
  type AppliedSegmentationArtifact,
  type SegmentationPlanPatch,
} from "./imaging/applySegmentationResult";
import { parseStlToViewerMesh } from "./imaging/stlToViewerMesh";
import { parseMatViewerMeshArtifactBytes } from "./imaging/matViewerMeshArtifact";
import type { MatNnunetJob, MatNnunetSourceKind } from "./imaging/matNnunetTypes";
import {
  INSTRUMENTS,
  MANUFACTURERS as CATALOG_MANUFACTURERS,
  PRODUCT_FAMILIES,
  PRODUCT_VARIANTS,
  REGION_INSTITUTION_SETS,
  getCatalogSources,
  getProductFamilies,
  getProductVariants,
} from "./catalog/deviceCatalog";
import {
  assessCatalogChain,
  instrumentChainSelectionHash,
} from "./catalog/chainValidation";

export const LOCAL_PLAN_KEY = "multilig-planner:deidentified-case:v1";
const SEGMENTATION_BONE_COLORS: Record<"femur" | "tibia" | "fibula", string> = {
  femur: "#d4dddf",
  tibia: "#bbc9cc",
  fibula: "#c6d2d4",
};
const MAT_XRAY_BONE_OPACITY = 0.22;

type SegmentationUiStatus = "idle" | "selected" | "checking" | "uploading" | "running" | "completed" | "failed";

export interface SegmentationUiState {
  status: SegmentationUiStatus;
  progress: number;
  message: string;
  file: File | null;
  jobId: string | null;
}

function matSourceKind(file: File): MatNnunetSourceKind | null {
  const format = classifyImagingFile(file.name);
  if (format === "dicom_archive") return "dicom_tar_gz";
  if (format === "nifti") return "nifti";
  return null;
}

function mergeById<T extends { id: string }>(existing: readonly T[], additions: readonly T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of additions) merged.set(item.id, item);
  return [...merged.values()];
}

const MANUFACTURER_OPTIONS: Array<[string, string]> = CATALOG_MANUFACTURERS.map((manufacturer) => [
  manufacturer.id,
  `${manufacturer.name} · ${manufacturer.status.replaceAll("_", " ")}`,
]);

function instrumentOptions(
  manufacturerId: string | null | undefined,
  kinds: readonly string[],
  retainedId?: string | null,
): Array<[string, string]> {
  const base = INSTRUMENTS.filter((instrument) => {
    const family = PRODUCT_FAMILIES.find((item) => item.id === instrument.familyId);
    return kinds.includes(instrument.kind) && Boolean(manufacturerId) && family?.manufacturerId === manufacturerId;
  }).map((instrument): [string, string] => [
    instrument.id,
    `${instrument.name}${instrument.sku ? ` · ${instrument.sku}` : " · exact model record; SKU unresolved"}`,
  ]);
  const retained = INSTRUMENTS.find((instrument) => instrument.id === retainedId);
  if (retained && !base.some(([id]) => id === retained.id)) {
    return [[retained.id, `Retained incompatible · ${retained.name}`], ...base];
  }
  return base;
}

const GEOMETRY_TYPES: Array<[ChannelPlan["geometryType"], string]> = [
  ["round_full_tunnel", "Round full tunnel"],
  ["antegrade_blind_socket", "Antegrade blind socket"],
  ["retrograde_socket", "Retro socket + pilot/deployment"],
  ["stepped_button_tunnel", "Stepped button tunnel"],
  ["flexible_reamed_socket", "Flexible socket + access"],
  ["noncircular_tunnel", "Noncircular profile"],
  ["overlapping_holes_dilator", "Overlapping holes + dilator"],
  ["sequential_dilated_tunnel", "Sequential dilated / compacted"],
  ["coring_trephine", "Coring / trephine"],
  ["anchor_pilot", "Anchor pilot + retained anchor"],
  ["interference_fixation", "Interference screw/sheath"],
  ["cortical_button_plate", "Cortical button / plate"],
  ["post_washer_staple", "Post / washer / staple"],
  ["pcl_inlay_trough", "PCL inlay trough"],
  ["chamfer_notch_keyhole", "Chamfer / notch / keyhole"],
  ["onlay_no_large_tunnel", "No-large-tunnel / onlay"],
  ["custom", "Custom parametric"],
];

const GEOMETRY_DIMENSION_FIELDS: Partial<Record<ChannelPlan["geometryType"], ReadonlyArray<readonly [string, string, "mm" | "deg"]>>> = {
  retrograde_socket: [
    ["pilotLengthMm", "Pilot length", "mm"],
    ["corticalChannelLengthMm", "Cortical channel length", "mm"],
    ["deploymentLengthMm", "Cutter deployment length", "mm"],
  ],
  stepped_button_tunnel: [["flipEnvelopeDiameterMm", "Flip envelope diameter", "mm"]],
  flexible_reamed_socket: [
    ["accessReachMm", "Curved access reach", "mm"],
    ["accessLiftMm", "Curved access lift", "mm"],
  ],
  overlapping_holes_dilator: [["pilotHoleOffsetMm", "Pilot-hole offset", "mm"]],
  sequential_dilated_tunnel: [["firstStageDiameterMm", "First dilation stage", "mm"]],
  coring_trephine: [["innerDiameterMm", "Trephine inner diameter", "mm"]],
  anchor_pilot: [
    ["punchDiameterMm", "Punch diameter", "mm"],
    ["tapMajorDiameterMm", "Tap major diameter", "mm"],
  ],
  cortical_button_plate: [
    ["buttonLengthMm", "Button / plate length", "mm"],
    ["buttonWidthMm", "Button / plate width", "mm"],
    ["buttonThicknessMm", "Button / plate thickness", "mm"],
    ["plateCornerRadiusMm", "Plate corner radius", "mm"],
    ["flipEnvelopeDiameterMm", "Flip envelope diameter", "mm"],
  ],
  post_washer_staple: [
    ["washerDiameterMm", "Washer diameter", "mm"],
    ["washerThicknessMm", "Washer thickness", "mm"],
    ["stapleLegSpacingMm", "Staple leg spacing", "mm"],
    ["stapleLegDiameterMm", "Staple leg diameter", "mm"],
    ["stapleBridgeWidthMm", "Staple bridge width", "mm"],
    ["stapleBridgeThicknessMm", "Staple bridge thickness", "mm"],
  ],
  pcl_inlay_trough: [
    ["wallSlopeDeg", "Trough wall slope", "deg"],
    ["accessEnvelopeDiameterMm", "Access envelope diameter", "mm"],
  ],
  chamfer_notch_keyhole: [
    ["innerDiameterMm", "Inner diameter", "mm"],
    ["accessEnvelopeDiameterMm", "Access envelope diameter", "mm"],
  ],
};

const CROSS_SECTION_TYPES: Array<[CrossSection["kind"], string]> = [
  ["circle", "Circle"],
  ["ellipse", "Ellipse / oval"],
  ["stadium", "Stadium"],
  ["rectangle", "Rectangle"],
  ["rounded_rectangle", "Rounded rectangle"],
  ["c_profile", "C-profile"],
  ["slot_ribbon", "Slot / ribbon"],
  ["polygon", "Polygon"],
  ["imported_profile", "Imported 2D profile"],
];

const LAYER_BUTTONS: Array<[ViewerLayer, string]> = [
  ["bones", "Bones"],
  ["landmarks", "Landmarks"],
  ["mri", "MRI slices"],
  ["boneRemoval", "Tunnels/sockets"],
  ["pins", "Pins"],
  ["access", "Access"],
  ["deployment", "Deployment"],
  ["grafts", "Grafts"],
  ["hardware", "Hardware"],
  ["previous", "Previous"],
  ["safety", "Safety anatomy"],
  ["measurements", "Measurements"],
];

function profileForKind(kind: CrossSection["kind"]): CrossSection {
  switch (kind) {
    case "circle": return { kind, diameterMm: null };
    case "ellipse": return { kind, majorMm: null, minorMm: null, rotationDeg: 0 };
    case "stadium": return { kind, widthMm: null, heightMm: null, rotationDeg: 0 };
    case "rectangle": return { kind, widthMm: null, heightMm: null, rotationDeg: 0 };
    case "rounded_rectangle": return { kind, widthMm: null, heightMm: null, cornerRadiusMm: null, rotationDeg: 0 };
    case "c_profile": return { kind, outerRadiusMm: null, innerRadiusMm: null, openingDeg: null, rotationDeg: 0 };
    case "slot_ribbon": return { kind, widthMm: null, thicknessMm: null, rotationDeg: 0 };
    case "polygon": return { kind, pointsMm: [], rotationDeg: 0 };
    case "imported_profile": return { kind, assetId: "", scaleMmPerUnit: null, pointsSourceUnits: [], rotationDeg: 0 };
  }
}

function resizeCrossSection(crossSection: CrossSection, primaryMm: number | null): CrossSection {
  const positive = primaryMm !== null && Number.isFinite(primaryMm) && primaryMm > 0 ? primaryMm : null;
  if (crossSection.kind === "circle") return { ...crossSection, diameterMm: positive };
  if (positive === null) return crossSection;
  const scaleSecondary = (currentPrimary: number | null, value: number | null): number | null => (
    currentPrimary !== null && currentPrimary > 0 && value !== null
      ? value * positive / currentPrimary
      : value
  );
  if (crossSection.kind === "ellipse") return {
    ...crossSection,
    minorMm: scaleSecondary(crossSection.majorMm, crossSection.minorMm),
    majorMm: positive,
  };
  if (crossSection.kind === "stadium" || crossSection.kind === "rectangle") return {
    ...crossSection,
    heightMm: scaleSecondary(crossSection.widthMm, crossSection.heightMm),
    widthMm: positive,
  };
  if (crossSection.kind === "rounded_rectangle") return {
    ...crossSection,
    heightMm: scaleSecondary(crossSection.widthMm, crossSection.heightMm),
    cornerRadiusMm: scaleSecondary(crossSection.widthMm, crossSection.cornerRadiusMm),
    widthMm: positive,
  };
  if (crossSection.kind === "c_profile") {
    const currentDiameter = crossSection.outerRadiusMm === null ? null : crossSection.outerRadiusMm * 2;
    return {
      ...crossSection,
      innerRadiusMm: scaleSecondary(currentDiameter, crossSection.innerRadiusMm),
      outerRadiusMm: positive / 2,
    };
  }
  if (crossSection.kind === "slot_ribbon") return {
    ...crossSection,
    thicknessMm: scaleSecondary(crossSection.widthMm, crossSection.thicknessMm),
    widthMm: positive,
  };
  if (crossSection.kind === "polygon" && crossSection.pointsMm.length) {
    const xs = crossSection.pointsMm.map(([x]) => x);
    const ys = crossSection.pointsMm.map(([, y]) => y);
    const currentSpan = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (currentSpan > 0) {
      const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
      const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
      const scale = positive / currentSpan;
      return {
        ...crossSection,
        pointsMm: crossSection.pointsMm.map(([x, y]) => [
          centerX + (x - centerX) * scale,
          centerY + (y - centerY) * scale,
        ]),
      };
    }
  }
  return crossSection;
}

function signedWorstFor(channelId: string, results: EngineAnalysisResult[]): number | null {
  const values = results
    .filter((result) => result.objectAId === channelId || result.objectBId === channelId)
    .map((result) => result.signedClearanceMm)
    .filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : null;
}

export function deidentifiedLocalSnapshot(plan: PlanCase): PlanCase {
  const safe = structuredClone(plan);
  safe.deidentifiedLabel = `Case ${stablePlanHash(plan.id).slice(-8)}`;
  safe.imaging.sources = safe.imaging.sources.map((source) => ({
    ...source,
    fileName: `source-${source.sha256.slice(0, 12)}.${source.format}`,
  }));
  safe.imaging.derivedAssets = (safe.imaging.derivedAssets ?? []).map((asset) => ({
    ...asset,
    availability: "unavailable",
  }));
  safe.imaging.segmentationRuns = safe.imaging.segmentationRuns ?? [];
  safe.imaging.review.corrections = safe.imaging.review.corrections.map((correction) => ({
    ...correction,
    author: "clinician-role",
    note: "[redacted from de-identified local snapshot]",
  }));
  safe.procedures = safe.procedures.map((procedure) => ({
    ...procedure,
    notes: procedure.notes?.startsWith(SIMPLIFIED_TECHNIQUE_NOTE_PREFIX) ||
      procedure.notes?.startsWith(LEGACY_SIMPLIFIED_TECHNIQUE_NOTE_PREFIX)
      ? procedure.notes
      : procedure.notes
        ? "[redacted from de-identified local snapshot]"
        : undefined,
  }));
  safe.intentionalRelationships = safe.intentionalRelationships.map((relationship) => ({
    ...relationship,
    rationale: "[redacted from de-identified local snapshot; re-verification required]",
    createdBy: "clinician-role",
    verifiedByUser: false,
  }));
  safe.audit = safe.audit.map((event) => ({
    ...event,
    actorId: "clinician-role",
    rationale: event.rationale ? "[redacted from de-identified local snapshot]" : undefined,
  }));
  return safe;
}

export function normalizeLoadedPlan(plan: PlanCase): PlanCase {
  const loadedSchemaVersion = plan.schemaVersion;
  const [schemaMajor, schemaMinor, schemaPatch] = plan.schemaVersion.split(".").map(Number);
  if (
    !Number.isInteger(schemaMajor) ||
    !Number.isInteger(schemaMinor) ||
    !Number.isInteger(schemaPatch) ||
    schemaMajor > 1 ||
    (schemaMajor === 1 && (schemaMinor > 7 || (schemaMinor === 7 && schemaPatch > 0)))
  ) {
    throw new Error(`Unsupported future plan schema ${plan.schemaVersion}`);
  }
  const migratePlacement = schemaMajor < 1 || (schemaMajor === 1 && schemaMinor < 4);
  const hasSegmentation = (plan.imaging.segmentationRuns ?? []).length > 0;
  const isSyntheticFixtureLineage = plan.audit.some((event) => event.action === "load_synthetic_nonclinical_fixture");
  const fixtureSeedById = new Map(
    createSyntheticDemoCase().variants.flatMap((variant) => variant.channels).map((channel) => [channel.id, channel]),
  );
  const procedureById = new Map(plan.procedures.map((procedure) => [procedure.id, procedure.structure]));
  const isUntouchedFixtureCoordinateSeed = (channel: ChannelPlan): boolean => {
    const seed = fixtureSeedById.get(channel.id);
    return Boolean(
      seed &&
      channel.aperture.every((value, index) => value === seed.aperture[index]) &&
      channel.vector.every((value, index) => value === seed.vector[index]) &&
      channel.depthMm === seed.depthMm &&
      JSON.stringify(channel.centerline) === JSON.stringify(seed.centerline)
    );
  };
  const normalizedPlan: PlanCase = {
    ...plan,
    schemaVersion: CURRENT_PLAN_SCHEMA_VERSION,
    geometryGeneratorVersion: GEOMETRY_GENERATOR_VERSION,
    audit: loadedSchemaVersion === CURRENT_PLAN_SCHEMA_VERSION
      ? plan.audit
      : [
          ...plan.audit,
          {
            id: `schema-migration-${plan.id}-${loadedSchemaVersion}-${CURRENT_PLAN_SCHEMA_VERSION}`,
            at: new Date().toISOString(),
            actorId: "local-application",
            action: `Migrated plan schema ${loadedSchemaVersion} to ${CURRENT_PLAN_SCHEMA_VERSION}`,
            entityType: "PlanCase",
            entityId: plan.id,
            rationale: "Added explicit socket trajectory-control semantics and independent guide-pin diameter provenance; preserved authored Entry, vector, depth, and cross-section while migrating ipsilateral sockets away from obsolete contralateral Start tethers.",
          },
        ],
    variants: plan.variants.map((variant) => ({
      ...variant,
      channels: variant.channels.map((channel) => {
        const procedure = procedureById.get(channel.procedureId);
        const trajectoryControlMode = isGuidePinSocketGeometry(channel) &&
          procedure !== undefined && ["MCL_POL_PMC", "PLC_FCL", "ALL", "LET"].includes(procedure)
          ? "blind_socket_tip" as const
          : channel.trajectoryControlMode ?? defaultTrajectoryControlMode(channel);
        const shouldSeedGuidePin = isGuidePinSocketGeometry(channel) && channel.guidePin === undefined;
        const guidePin = shouldSeedGuidePin
          ? {
              diameterMm: DEFAULT_GENERIC_SOCKET_GUIDE_PIN_DIAMETER_MM,
              provenance: "generic_parametric_visual_seed" as const,
            }
          : channel.guidePin ?? null;
        const warnings = shouldSeedGuidePin && !channel.warnings.includes(GENERIC_SOCKET_GUIDE_PIN_WARNING)
          ? [...channel.warnings, GENERIC_SOCKET_GUIDE_PIN_WARNING]
          : channel.warnings;
        const apertureSurfaceAttachment = channel.apertureSurfaceAttachment?.targetKind === "tibial_superior_envelope" && !channel.apertureSurfaceAttachment.constraintProvenance
          ? (() => {
              const xyFallbackDistanceMm = Math.hypot(
                channel.apertureSurfaceAttachment!.attachedPointPatientRasMm[0] - channel.apertureSurfaceAttachment!.requestedPointPatientRasMm[0],
                channel.apertureSurfaceAttachment!.attachedPointPatientRasMm[1] - channel.apertureSurfaceAttachment!.requestedPointPatientRasMm[1],
              );
              return {
                ...channel.apertureSurfaceAttachment!,
                constraintProvenance: {
                  rule: "maximum_patient_ras_z_at_requested_xy" as const,
                  ruleVersion: "1" as const,
                  sourceGeometryRole: "viewer_display_surface" as const,
                  resolution: xyFallbackDistanceMm <= 1e-6
                    ? "vertical_intersection" as const
                    : "nearest_xy_fallback" as const,
                  xyFallbackDistanceMm,
                },
              };
            })()
          : channel.apertureSurfaceAttachment;
        let normalizedChannel: ChannelPlan = {
          ...channel,
          apertureSurfaceAttachment,
          trajectoryControlMode,
          guidePin,
          warnings,
          layers: channel.layers.map((layer) => ({
            ...layer,
            geometryGeneratorVersion: GEOMETRY_GENERATOR_VERSION,
          })),
          ...(trajectoryControlMode === "blind_socket_tip" ? {
            endpointSurfaceAttachment: null,
            surfacePlacement: channel.surfacePlacement
              ? {
                  ...channel.surfacePlacement,
                  meshIds: channel.apertureSurfaceAttachment?.meshId
                    ? [channel.apertureSurfaceAttachment.meshId]
                    : [],
                  endpointMethod: "blind_socket_tip" as const,
                }
              : channel.surfacePlacement,
          } : {}),
        };
        if (normalizedChannel.apertureSurfaceAttachment?.targetKind === "tibial_superior_envelope") {
          normalizedChannel = {
            ...normalizedChannel,
            warnings: withTibialSuperiorEnvelopeWarnings(
              normalizedChannel.warnings,
              normalizedChannel.apertureSurfaceAttachment,
            ),
          };
        }
        if (normalizedChannel.surfacePlacement || !migratePlacement) return normalizedChannel;
        return {
          ...normalizedChannel,
          surfacePlacement: normalizedChannel.apertureSurfaceAttachment
            ? {
                state: "clinician_edited" as const,
                method: "manual_surface_drag" as const,
                meshIds: [normalizedChannel.apertureSurfaceAttachment.meshId],
                endpointMethod: normalizedChannel.endpointSurfaceAttachment
                  ? "nearest_surface_projection" as const
                  : "preserved_depth" as const,
              }
            : hasSegmentation && isSyntheticFixtureLineage && isUntouchedFixtureCoordinateSeed(normalizedChannel)
              ? {
                  state: "pending_default" as const,
                  method: "migration_pending" as const,
                  meshIds: [],
                  endpointMethod: "not_available" as const,
                }
              : {
                  state: "clinician_edited" as const,
                  method: "manual_numeric_edit" as const,
                  meshIds: [],
                  endpointMethod: "not_available" as const,
                },
        };
      }),
    })),
    imaging: {
      ...plan.imaging,
      derivedAssets: plan.imaging.derivedAssets ?? [],
      segmentationRuns: plan.imaging.segmentationRuns ?? [],
    },
  };
  return migrateLegacyRootSutureAnchorPins(
    restoreLegacyAnchorVisualTemplates(removePinTipOvershootFromPlan(normalizedPlan)),
  );
}

export function loadInitialPlan(): PlanCase {
  try {
    const saved = loadPlanLocally<PlanCase>(LOCAL_PLAN_KEY);
    if (!saved) return normalizeLoadedPlan(createBundledDemoPlan());
    const initial = normalizeLoadedPlan(saved);
    if (usesBundledDemoAnatomy(initial)) return initial;
    return initial.imaging.segmentationRuns.length
      ? initial
      : initializePendingChannelSurfacePlacements(initial, buildSyntheticAnatomyMeshes());
  } catch {
    // Corrupt, incompatible, or unavailable browser storage must never prevent a
    // planning workspace from opening. The bundled fixture is de-identified,
    // geometry-only, unreviewed, and explicitly research/demo use only.
    return normalizeLoadedPlan(createBundledDemoPlan());
  }
}

function availableVolumeGeometry(geometry: CollisionGeometry): CollisionGeometry {
  const layers = geometry.layers.filter((layer) => layer.analyzable && layer.primitives.length > 0);
  return {
    ...geometry,
    layers,
    complete: layers.length > 0,
    missingDimensions: layers.length > 0 ? [] : geometry.missingDimensions,
    geometryHash: `${geometry.geometryHash}:available:${layers.map((layer) => layer.id).join("|")}`,
  };
}

function resolveInstrumentChainState(
  chain: InstrumentChain,
  recordVerification = false,
): { chain: InstrumentChain; catalogWarnings: string[]; incompatibleReasons: string[]; exactSizeMm: number | null } {
  const assessment = assessCatalogChain(chain);
  let resolved: InstrumentChain = {
    ...chain,
    sourceIds: assessment.sourceIds,
  };
  const selectionHash = instrumentChainSelectionHash(resolved);
  const retainedVerificationIsCurrent = Boolean(
    resolved.userVerified &&
    resolved.verification &&
    resolved.verification.selectionHash === selectionHash &&
    resolved.verification.catalogVersion === resolved.catalogVersion,
  );
  if (!retainedVerificationIsCurrent) {
    resolved = { ...resolved, userVerified: false, verification: null };
  }
  resolved = finalizeChainState(resolved);
  if (assessment.incompatibleReasons.length) {
    resolved = {
      ...resolved,
      userVerified: false,
      verification: null,
      completionState: "incompatible",
      missingSelections: [
        ...resolved.missingSelections,
        ...assessment.incompatibleReasons.map((reason) => `catalog conflict: ${reason}`),
      ],
    };
  } else if (recordVerification && resolved.missingSelections.length === 0) {
    const verifiedAt = new Date().toISOString();
    resolved = {
      ...resolved,
      userVerified: true,
      verification: {
        verifiedAt,
        verifiedBy: "local-clinician",
        selectionHash,
        catalogVersion: resolved.catalogVersion,
        marketOrRegion: resolved.marketOrRegion ?? "unspecified",
        sourceIds: assessment.sourceIds,
      },
      completionState: "complete",
    };
  }
  return {
    chain: resolved,
    catalogWarnings: assessment.warningReasons,
    incompatibleReasons: assessment.incompatibleReasons,
    exactSizeMm: assessment.exactSizeMm,
  };
}

function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`field ${className}`}>
      <label>{label}</label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

interface ChannelParameterSliderProps {
  id: string;
  label: string;
  value: number | null | undefined;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals: number;
  onChange: (value: string) => void;
}

function ChannelParameterSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  unit = "",
  decimals,
  onChange,
}: ChannelParameterSliderProps) {
  const isSet = typeof value === "number" && Number.isFinite(value);
  const boundedValue = isSet ? Math.max(min, Math.min(max, value)) : min;
  const outsideSliderWindow = isSet && value !== boundedValue;
  const displayedValue = isSet ? `${value.toFixed(decimals)}${unit ? ` ${unit}` : ""}` : "Not set";

  return (
    <div className={`channel-parameter-slider ${isSet ? "" : "unresolved"}`}>
      <div className="channel-parameter-slider-header">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className={outsideSliderWindow ? "outside-window" : ""}>{displayedValue}</output>
      </div>
      <input
        id={id}
        aria-label={`${label} slider`}
        className="channel-parameter-slider-track"
        type="range"
        min={min}
        max={max}
        step={step}
        value={boundedValue}
        disabled={!isSet}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {outsideSliderWindow ? <div className="channel-parameter-slider-warning">Current exact value is outside this editing window; it was not changed.</div> : null}
    </div>
  );
}

function positiveSliderMaximum(value: number | null | undefined, baseline: number, quantum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= baseline) return baseline;
  return Math.ceil(value / quantum) * quantum;
}

function SelectedChannelParameterSliders({
  channel,
  onNumericValue,
}: {
  channel: ChannelPlan;
  onNumericValue: (field: "depthMm" | "diameterMm" | "orientationDeg", value: string) => void;
}) {
  const idPrefix = `selected-channel-${channel.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const isAnchorPilot = channel.geometryType === "anchor_pilot";
  const anchorDepthRange = channel.genericSeed.depthMm;
  const anchorDiameterRange = channel.genericSeed.diameterMm ?? channel.genericSeed.pilotDiameterMm;
  const depthMinimum = isAnchorPilot ? anchorDepthRange?.[0] ?? 0 : 0;
  const depthMaximum = isAnchorPilot
    ? positiveSliderMaximum(channel.depthMm, anchorDepthRange?.[1] ?? 30, 5)
    : positiveSliderMaximum(channel.depthMm, 80, 10);
  const diameterMinimum = isAnchorPilot ? anchorDiameterRange?.[0] ?? 0.5 : 0.5;
  const diameterMaximum = isAnchorPilot
    ? positiveSliderMaximum(channel.diameterMm, anchorDiameterRange?.[1] ?? 8, 1)
    : positiveSliderMaximum(channel.diameterMm, 30, 5);
  const orientationExtent = Math.max(180, Math.ceil(Math.abs(channel.orientationDeg ?? 0) / 45) * 45);

  return (
    <div className="channel-parameter-panel" aria-label={`Selected channel parameters for ${channel.label}`}>
      <div className="channel-parameter-panel-heading">
        <strong>Selected channel parameters</strong>
        <span>Sliders · exact entry below</span>
      </div>
      <div className="channel-parameter-panel-note">
        {isAnchorPilot
          ? channel.verificationState === "needs_dimensions"
            ? "The displayed socket values are an editable MAT-style generic visual template until the clinician changes or confirms them. They do not select an anchor or preparation instrument and remain not evaluated as final dimensions."
            : "These planning dimensions were explicitly changed or confirmed by the clinician. Exact anchor and preparation-instrument geometry remain a separate incomplete selection."
          : "Slider bounds are interface controls, not clinical recommendations. Unresolved values stay unset and disabled until an exact value is entered below; generic seeds and catalog data are never selected automatically."}
      </div>
      <div className="channel-parameter-sliders">
        <ChannelParameterSlider id={`${idPrefix}-depth`} label={isAnchorPilot ? "Anchor socket/pilot depth" : "Depth / tunnel length"} value={channel.depthMm} min={depthMinimum} max={depthMaximum} step={0.5} unit="mm" decimals={1} onChange={(value) => onNumericValue("depthMm", value)} />
        <ChannelParameterSlider id={`${idPrefix}-diameter`} label={isAnchorPilot ? "Anchor socket/pilot diameter" : "Size / diameter"} value={channel.diameterMm} min={diameterMinimum} max={diameterMaximum} step={isAnchorPilot ? 0.05 : 0.5} unit="mm" decimals={isAnchorPilot ? 2 : 1} onChange={(value) => onNumericValue("diameterMm", value)} />
        <ChannelParameterSlider id={`${idPrefix}-orientation`} label="Profile orientation" value={channel.orientationDeg} min={-orientationExtent} max={orientationExtent} step={1} unit="°" decimals={0} onChange={(value) => onNumericValue("orientationDeg", value)} />
      </div>
    </div>
  );
}

function StatusPill({ tone, children }: { tone: "warn" | "conflict" | "ok" | "info"; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function App() {
  const [history, setHistory] = useState(() => createPlanHistory(loadInitialPlan()));
  const plan = history.present.snapshot;
  const variant = activeVariant(plan);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const selectedChannel = variant.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const [pendingProcedure, setPendingProcedure] = useState<ProcedureIdentity | null>(null);
  const [focusedProcedureIdentity, setFocusedProcedureIdentity] = useState<ProcedureIdentity | null>(null);
  const [highlightedProcedureIdentities, setHighlightedProcedureIdentities] = useState<ProcedureIdentity[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<"channels" | "sequence">("channels");
  const [layerVisibility, setLayerVisibility] = useState<ViewerPlanningScene["layerVisibility"]>(DEFAULT_LAYER_VISIBILITY);
  const [globalOpacity, setGlobalOpacity] = useState(1);
  const [clipping, setClipping] = useState<ViewerPlanningScene["clipping"]>({ enabled: false, axis: "z", offsetMm: 0, invert: false });
  const [crossSection, setCrossSection] = useState<ViewerPlanningScene["crossSection"]>({ enabled: false, axis: "z", offsetMm: 20 });
  const [standardView, setStandardView] = useState<{ view: StandardView; nonce: number }>({ view: "focus", nonce: 0 });
  const [screenshotRequest, setScreenshotRequest] = useState<{ channelId: string; nonce: number } | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ghostVariantId, setGhostVariantId] = useState<string | null>(null);
  const analysisThreshold = plan.analysisSettings.informationalClearanceThresholdMm;
  const [dragStep, setDragStep] = useState<number | null>(null);
  const [relationshipTargetId, setRelationshipTargetId] = useState<string>("");
  const [relationshipRationale, setRelationshipRationale] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const segmentationInputRef = useRef<HTMLInputElement>(null);
  const segmentationAbortRef = useRef<AbortController | null>(null);
  const anatomyLoadGenerationRef = useRef(0);
  const displayedAnatomySignatureRef = useRef<string | null>(null);
  const segmentationClient = useMemo(() => new MatNnunetClient(), []);
  const [segmentationUi, setSegmentationUi] = useState<SegmentationUiState>({
    status: "idle",
    progress: 0,
    message: "Select a DICOM .tar.gz archive or NIfTI MRI to run MAT Planner's local research model.",
    file: null,
    jobId: null,
  });
  const [patientAnatomyMeshes, setPatientAnatomyMeshes] = useState<ViewerMeshPayload[] | null>(
    () => plan.imaging.segmentationRuns.length ? [] : null,
  );
  const syntheticAnatomyMeshes = useMemo(() => buildSyntheticAnatomyMeshes(), []);
  const interactionAnatomyMeshes = patientAnatomyMeshes ?? syntheticAnatomyMeshes;
  const analysisCache = useRef(new GeometryAnalysisCache());
  const sources = plan.imaging.sources;
  const imagingReview = plan.imaging.review;
  const hasPatientSegmentation = plan.imaging.segmentationRuns.length > 0;

  const procedureById = useMemo(
    () => Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
    [plan.procedures],
  );
  const highlightedProcedureSet = useMemo<ReadonlySet<ProcedureIdentity>>(
    () => new Set(highlightedProcedureIdentities),
    [highlightedProcedureIdentities],
  );

  useEffect(() => {
    if (!selectedChannelId) return;
    if (!selectedChannel) {
      setSelectedChannelId(null);
      return;
    }
    const identity = procedureById[selectedChannel.procedureId];
    if (!identity || !highlightedProcedureSet.has(identity)) setSelectedChannelId(null);
  }, [highlightedProcedureSet, procedureById, selectedChannel, selectedChannelId]);

  const ghostVariant = useMemo(
    () => ghostVariantId && ghostVariantId !== plan.activeVariantId
      ? plan.variants.find((candidate) => candidate.id === ghostVariantId) ?? null
      : null,
    [ghostVariantId, plan.activeVariantId, plan.variants],
  );

  const ghostMeshes = useMemo<ViewerMeshPayload[]>(() => {
    if (!ghostVariant) return [];
    return buildViewerScene({
      revision: history.present.sequence,
      channels: ghostVariant.channels,
      procedureById,
      visibleProcedureIdentities: highlightedProcedureSet,
      selectedChannelId: null,
      layerVisibility: { ...DEFAULT_LAYER_VISIBILITY, bones: false },
      globalOpacity: 0.18,
    }).scene.meshes
      .filter((mesh) => mesh.layer !== "bones")
      .map((mesh) => ({ ...mesh, id: `ghost-${mesh.id}`, layer: "ghost", color: "#8b9daa", opacity: 0.18 }));
  }, [ghostVariant, highlightedProcedureSet, history.present.sequence, procedureById]);

  const ghostSelectedChannel = useMemo(
    () => ghostVariant?.channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [ghostVariant, selectedChannelId],
  );

  const viewerModel = useMemo(
    () => buildViewerScene({
      revision: history.present.sequence,
      channels: variant.channels,
      procedureById,
      visibleProcedureIdentities: highlightedProcedureSet,
      selectedChannelId,
      layerVisibility,
      globalOpacity,
      clipping,
      crossSection,
      ghostMeshes,
      anatomyMeshes: interactionAnatomyMeshes,
    }),
    [clipping, crossSection, ghostMeshes, globalOpacity, highlightedProcedureSet, history.present.sequence, interactionAnatomyMeshes, layerVisibility, procedureById, selectedChannelId, variant.channels],
  );

  const analysisResults = useMemo(() => {
    const geometries = [...viewerModel.geometry.values()];
    const channelById = new Map(variant.channels.map((channel) => [channel.id, channel]));
    const intentionalRelationships = plan.intentionalRelationships
      .filter((relationship) => relationship.verifiedByUser && relationship.objectIds.length >= 2 && relationship.rationale.trim())
      .map((relationship) => ({
        id: relationship.id,
        objectAId: relationship.objectIds[0],
        objectBId: relationship.objectIds[1],
        kind: relationship.kind === "coalesced" ? "coalesced" as const : "shared" as const,
        rationale: relationship.rationale,
      }));
    const availableResults = analyzeAllPairs(
      geometries.map((geometry) => requireClinicianSelectedDimensions(
        availableVolumeGeometry(geometry),
        channelById.get(geometry.id),
      )),
      { thresholdMm: analysisThreshold, intentionalRelationships },
      analysisCache.current,
    );
    const completenessResults = analyzeAllPairs(
      geometries.map((geometry) => requireClinicianSelectedDimensions(
        geometry,
        channelById.get(geometry.id),
      )),
      { thresholdMm: analysisThreshold, intentionalRelationships },
      analysisCache.current,
    );
    const pairResults = availableResults.flatMap((available, index) => {
      const complete = completenessResults[index];
      if (["conflict", "below_threshold", "intentional_shared"].includes(available.status)) {
        return complete.status === "not_evaluated" ? [available, complete] : [available];
      }
      return [complete.status === "not_evaluated" ? complete : available];
    });

    const analyzableAnatomyKinds = new Set(
      plan.anatomy
        .filter((object) => object.reviewStatus === "approved" && geometries.some((geometry) => geometry.id === object.id))
        .map((object) => object.kind),
    );
    const missingAnatomyResults: EngineAnalysisResult[] = [];
    for (const channel of variant.channels) {
      const geometry = viewerModel.geometry.get(channel.id);
      if (!geometry) continue;
      if (!analyzableAnatomyKinds.has(channel.bone)) {
        missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
          geometry,
          `missing:${channel.bone}:cortex`,
          `${channel.bone} cortex mesh`,
          { thresholdMm: analysisThreshold },
        ));
      }
      if (!analyzableAnatomyKinds.has("cartilage")) {
        missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
          geometry,
          "missing:articular-surface",
          "registered articular cartilage/surface anatomy",
          { thresholdMm: analysisThreshold },
        ));
      }
      if (!analyzableAnatomyKinds.has("physis")) {
        missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
          geometry,
          "missing:physis",
          "registered physis anatomy",
          { thresholdMm: analysisThreshold },
        ));
      }
      const procedure = plan.procedures.find((item) => item.id === channel.procedureId);
      if (procedure?.structure === "PCL" && channel.bone === "tibia" && !analyzableAnatomyKinds.has("danger_region")) {
        missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
          geometry,
          "missing:posterior-danger-anatomy",
          "posterior neurovascular or other registered danger anatomy",
          { thresholdMm: analysisThreshold },
        ));
      }
      for (const [kind, label] of [
        ["previous_tunnel", "registered previous tunnels"],
        ["previous_hardware", "registered previous hardware"],
        ["osteotomy_hardware", "registered osteotomy hardware"],
      ] as const) {
        if (!analyzableAnatomyKinds.has(kind)) {
          missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
            geometry,
            `missing:${kind}`,
            label,
            { thresholdMm: analysisThreshold },
          ));
        }
      }
      if (channel.bone === "fibula") {
        missingAnatomyResults.push(notEvaluatedForMissingAnatomy(
          geometry,
          "missing:proximal-tibiofibular-joint",
          "registered proximal tibiofibular joint surface",
          { thresholdMm: analysisThreshold },
        ));
      }
    }
    return [...pairResults, ...missingAnatomyResults];
  }, [analysisThreshold, plan.anatomy, plan.intentionalRelationships, plan.procedures, variant.channels, viewerModel.geometry]);

  const selectedAnalysis = useMemo(
    () => analysisResults
      .filter((result) => !selectedChannelId || result.objectAId === selectedChannelId || result.objectBId === selectedChannelId)
      .sort((a, b) => {
        const rank = { conflict: 0, below_threshold: 1, intentional_shared: 2, not_evaluated: 3, clear: 4 };
        const statusRank = rank[a.status] - rank[b.status];
        if (statusRank) return statusRank;
        if (a.status === "not_evaluated" && b.status === "not_evaluated") {
          const missingRank = (result: EngineAnalysisResult) => result.objectBId.includes("posterior-danger") ? 0 : result.evaluationState === "missing_anatomy" ? 1 : 2;
          const coverageRank = missingRank(a) - missingRank(b);
          if (coverageRank) return coverageRank;
        }
        return (a.signedClearanceMm ?? 999) - (b.signedClearanceMm ?? 999);
      }),
    [analysisResults, selectedChannelId],
  );

  const planWithAnalysis = useMemo(
    () => withComputedAnalysis(plan, analysisResults),
    [analysisResults, plan],
  );

  const commit = useCallback((
    update: PlanCase | ((current: PlanCase) => PlanCase),
    reason: string,
    options: { persistDeidentifiedSnapshot?: boolean } = {},
  ) => {
    setHistory((current) => {
      const next = commitPlan(current, (currentPlan) => {
        const candidate = typeof update === "function" ? update(currentPlan) : update;
        const beforeHash = stablePlanHash(currentPlan);
        const afterHash = stablePlanHash(candidate);
        if (beforeHash === afterHash) return currentPlan;
        const at = new Date().toISOString();
        return {
          ...candidate,
          updatedAt: at,
          audit: [
            ...candidate.audit,
            {
              id: crypto.randomUUID(),
              at,
              actorId: "local-clinician",
              action: reason,
              entityType: "PlanRevision",
              entityId: candidate.activeVariantId,
              beforeHash,
              afterHash,
            },
          ],
        };
      }, reason);
      if (options.persistDeidentifiedSnapshot) {
        savePlanLocally(LOCAL_PLAN_KEY, deidentifiedLocalSnapshot(next.present.snapshot));
      }
      return next;
    });
  }, []);

  const commitChannel = useCallback((channelId: string, update: (channel: ChannelPlan) => ChannelPlan, reason: string) => {
    commit((current) => updateChannel(current, channelId, (channel) => {
      const updated = update(channel);
      if (reason === "Changed user verification" || !updated.instrumentChain.userVerified) return updated;
      return {
        ...updated,
        instrumentChain: finalizeChainState({
          ...updated.instrumentChain,
          userVerified: false,
          verification: null,
        }),
      };
    }), reason);
  }, [commit]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 3200);
  }, []);

  const handleViewerScreenshot = useCallback((result: ViewerScreenshotResult) => {
    if (result.error || !result.dataUrl) {
      showToast(result.error ?? "Channel screenshot was not available.");
      return;
    }
    const link = document.createElement("a");
    link.href = result.dataUrl;
    link.download = `multilig-channel-${result.channelId.replace(/[^a-zA-Z0-9_-]/g, "-")}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("De-identified selected-channel screenshot exported from Viewer v2.");
  }, [showToast]);

  const handleViewerChange = useCallback((change: ViewerHandleChange) => {
    if (change.phase !== "commit") return;
    commitChannel(change.channelId, (channel) => {
      const procedure = procedureById[channel.procedureId];
      if (change.kind === "aperture" || change.kind === "endpoint") {
        return applySurfaceConstrainedHandleCommit(
          channel,
          procedure,
          change,
          interactionAnatomyMeshes,
        );
      }
      const aperture = tupleToVec3(channel.aperture);
      const moved = { x: change.position[0], y: change.position[1], z: change.position[2] };
      const delta = { x: moved.x - aperture.x, y: moved.y - aperture.y, z: moved.z - aperture.z };
      const magnitude = Math.hypot(delta.x, delta.y, delta.z);
      if (change.kind === "diameter" && magnitude > 0.1) {
        const diameterMm = Math.max(0.5, Math.min(30, magnitude * 2));
        const cross = resizeCrossSection(channel.crossSection, diameterMm);
        const selectedVariant = PRODUCT_VARIANTS.find((variantRecord) => variantRecord.id === channel.instrumentChain.productVariantId);
        let instrumentChain = channel.instrumentChain;
        if (selectedVariant?.selectableSizesMm?.length) {
          const documentedSize = selectedVariant.selectableSizesMm.some((size) => Math.abs(size - diameterMm) < 1e-8);
          instrumentChain = resolveInstrumentChainState({
            ...instrumentChain,
            exactSizeOrProfileId: documentedSize
              ? `${selectedVariant.id}:size:${diameterMm}`
              : `${selectedVariant.id}:unverified-size:${diameterMm}`,
            userVerified: false,
            verification: null,
          }).chain;
        }
        return { ...channel, diameterMm, crossSection: cross, instrumentChain };
      }
      if (change.kind === "orientation") {
        const axis = normalize3(tupleToVec3(channel.vector));
        const basisX = deterministicPerpendicular(axis);
        const basisY = normalize3(cross3(axis, basisX));
        const orientationDeg = Math.atan2(dot3(delta, basisY), dot3(delta, basisX)) * 180 / Math.PI;
        const crossSection = "rotationDeg" in channel.crossSection
          ? { ...channel.crossSection, rotationDeg: orientationDeg }
          : channel.crossSection;
        return { ...channel, orientationDeg, crossSection };
      }
      return channel;
    }, `Directly manipulated ${change.kind}`);
  }, [commitChannel, interactionAnatomyMeshes, procedureById]);

  const numericChannelValue = (
    field: "depthMm" | "diameterMm" | "orientationDeg",
    value: string,
  ) => {
    if (!selectedChannel) return;
    const parsed = value === "" ? null : Number(value);
    if (parsed !== null && !Number.isFinite(parsed)) return;
    commitChannel(selectedChannel.id, (channel) => {
      if (field === "diameterMm") {
        const crossSection = resizeCrossSection(channel.crossSection, parsed);
        const selectedVariant = PRODUCT_VARIANTS.find((variantRecord) => variantRecord.id === channel.instrumentChain.productVariantId);
        let instrumentChain = channel.instrumentChain;
        if (selectedVariant?.selectableSizesMm?.length) {
          const documentedSize = parsed !== null && selectedVariant.selectableSizesMm.some((size) => Math.abs(size - parsed) < 1e-8);
          const exactSizeOrProfileId = parsed === null
            ? null
            : documentedSize
              ? `${selectedVariant.id}:size:${parsed}`
              : `${selectedVariant.id}:unverified-size:${parsed}`;
          instrumentChain = resolveInstrumentChainState({
            ...instrumentChain,
            exactSizeOrProfileId,
            userVerified: false,
            verification: null,
          }).chain;
        }
        const anchorDimensionsReady = channel.geometryType === "anchor_pilot" &&
          parsed !== null && parsed > 0 && channel.depthMm !== null && channel.depthMm > 0;
        return {
          ...channel,
          diameterMm: parsed ?? undefined,
          crossSection,
          instrumentChain,
          ...(channel.geometryType === "anchor_pilot"
            ? { verificationState: anchorDimensionsReady ? "needs_instrument_chain" as const : "needs_dimensions" as const }
            : {}),
        };
      }
      if (field === "depthMm") {
        const instrumentChain = channel.instrumentChain.depthOrFullTunnelSetting.mode === "depth"
          ? finalizeChainState({
            ...channel.instrumentChain,
            depthOrFullTunnelSetting: { mode: "depth", depthMm: parsed },
            userVerified: false,
            verification: null,
          })
          : channel.instrumentChain;
        const edited = attachMissingForwardSurfaceStart({
          ...applyChannelDepthGeometryEdit(channel, parsed),
          instrumentChain,
        }, interactionAnatomyMeshes);
        const anchorDimensionsReady = channel.geometryType === "anchor_pilot" &&
          parsed !== null && parsed > 0 && channel.diameterMm !== undefined && channel.diameterMm > 0;
        return channel.geometryType === "anchor_pilot"
          ? {
              ...edited,
              verificationState: anchorDimensionsReady ? "needs_instrument_chain" : "needs_dimensions",
            }
          : edited;
      }
      return { ...channel, [field]: parsed } as ChannelPlan;
    }, `Changed ${field}`);
  };

  const vectorValue = (index: number, value: string, field: "aperture" | "vector") => {
    if (!selectedChannel) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    commitChannel(
      selectedChannel.id,
      (channel) => {
        const edited = field === "aperture"
          ? applySurfaceConstrainedHandleCommit(
              channel,
              procedureById[channel.procedureId],
              {
                channelId: channel.id,
                kind: "aperture",
                position: channel.aperture.map((component, componentIndex) =>
                  componentIndex === index ? parsed : component) as [number, number, number],
                phase: "commit",
              },
              interactionAnatomyMeshes,
            )
          : applyNumericVectorComponentEdit(channel, field, index as 0 | 1 | 2, parsed);
        return attachMissingForwardSurfaceStart(edited, interactionAnatomyMeshes);
      },
      `Changed ${field} ${["X", "Y", "Z"][index]}`,
    );
  };

  const updateChain = (
    update: (chain: InstrumentChain) => InstrumentChain,
    reason: string,
    options: {
      recordVerification?: boolean;
      updateGeometry?: (channel: ChannelPlan, exactSizeMm: number | null) => ChannelPlan;
    } = {},
  ) => {
    if (!selectedChannel) return;
    commitChannel(selectedChannel.id, (channel) => {
      const edited = update({
        ...structuredClone(channel.instrumentChain),
        userVerified: options.recordVerification ? channel.instrumentChain.userVerified : false,
        verification: options.recordVerification ? channel.instrumentChain.verification : null,
      });
      const resolved = resolveInstrumentChainState(edited, options.recordVerification);
      const baseChannel: ChannelPlan = {
        ...channel,
        instrumentChain: resolved.chain,
        verificationState: "needs_instrument_chain",
        warnings: [
          ...channel.warnings.filter((warning) => !warning.startsWith("Catalog chain conflict:") && !warning.startsWith("Catalog verification:")),
          ...resolved.incompatibleReasons.map((warning) => `Catalog chain conflict: ${warning}. Resolve explicitly; nothing was substituted.`),
          ...resolved.catalogWarnings.map((warning) => `Catalog verification: ${warning}.`),
        ],
      };
      return options.updateGeometry ? options.updateGeometry(baseChannel, resolved.exactSizeMm) : baseChannel;
    }, reason);
  };

  const addPreset = (presetId: string) => {
    const existingChannelIds = new Set(variant.channels.map((channel) => channel.id));
    const nextPlan = initializePendingChannelSurfacePlacements(
      addTechniquePreset(plan, presetId),
      interactionAnatomyMeshes,
    );
    const addedChannels = activeVariant(nextPlan).channels.filter((channel) => !existingChannelIds.has(channel.id));
    const addedProcedureIdentity = addedChannels[0]
      ? nextPlan.procedures.find((procedure) => procedure.id === addedChannels[0].procedureId)?.structure ?? null
      : pendingProcedure ?? focusedProcedureIdentity;
    commit(
      nextPlan,
      `Added technique preset ${presetId} and initialized available bone-surface defaults`,
    );
    setLayerVisibility((current) => ({
      ...current,
      bones: true,
      boneRemoval: true,
      pins: true,
      access: true,
      deployment: true,
      hardware: true,
      measurements: true,
    }));
    if (addedProcedureIdentity) {
      setHighlightedProcedureIdentities((current) => current.includes(addedProcedureIdentity)
        ? current
        : [...current, addedProcedureIdentity]);
      setFocusedProcedureIdentity(addedProcedureIdentity);
    }
    setSelectedChannelId(addedChannels[0]?.id ?? null);
    setPendingProcedure(null);
    showToast(`${addedChannels.length} editable channel${addedChannels.length === 1 ? "" : "s"} added and selected for review. Exact instruments and dimensions remain unresolved.`);
  };

  const importFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const imported = await Promise.all([...fileList].map(createImmutableSource));
    commit((current) => ({
      ...current,
      sourceStudyIds: [...current.sourceStudyIds, ...imported.map((source) => source.id)],
      imaging: {
        ...current.imaging,
        sources: [...current.imaging.sources, ...imported],
        review: {
          ...current.imaging.review,
          laterality: "unverified",
          scaleVerified: false,
          orientationVerified: false,
          boneIdentitiesVerified: false,
        },
      },
      lateralityVerified: false,
      scaleVerified: false,
    }), "Imported immutable imaging source metadata and reset source-dependent verification");
    showToast(`${imported.length} source file${imported.length === 1 ? "" : "s"} staged for review; no clinical segmentation inference was run.`);
  };

  const selectMatSegmentationSource = (fileList: FileList | null) => {
    const files = fileList ? [...fileList] : [];
    if (files.length !== 1) {
      setSegmentationUi({
        status: "failed",
        progress: 0,
        message: "Select exactly one DICOM .tar.gz archive or one NIfTI MRI volume.",
        file: null,
        jobId: null,
      });
      return;
    }
    const file = files[0];
    const sourceKind = matSourceKind(file);
    if (!sourceKind) {
      setSegmentationUi({
        status: "failed",
        progress: 0,
        message: "MAT nnUNetv2 accepts a DICOM .tar.gz archive or NIfTI MRI volume for this workflow.",
        file: null,
        jobId: null,
      });
      return;
    }
    setSegmentationUi({
      status: "selected",
      progress: 0,
      message: `${sourceKind === "dicom_tar_gz" ? "DICOM archive" : "NIfTI MRI"} selected (${(file.size / 1024 / 1024).toFixed(1)} MiB). No inference has run.`,
      file,
      jobId: null,
    });
  };

  const resolveSegmentationMesh = async (
    artifact: AppliedSegmentationArtifact,
    patch: SegmentationPlanPatch,
    signal?: AbortSignal,
  ): Promise<ViewerMeshPayload> => {
    const bytes = await segmentationClient.getArtifact({
      artifactId: artifact.serviceArtifactId,
      expectedSha256: artifact.sha256,
      expectedByteLength: artifact.byteLength,
      signal,
    });
    const label = artifact.bone[0].toUpperCase() + artifact.bone.slice(1);
    const options = {
      id: artifact.assetId,
      name: `${label} · MAT nnUNetv2 research output`,
      color: SEGMENTATION_BONE_COLORS[artifact.bone],
      opacity: MAT_XRAY_BONE_OPACITY,
      layer: "bones" as const,
    };
    if (artifact.mediaType === "application/json") {
      const mesh = parseMatViewerMeshArtifactBytes(bytes, {
        ...options,
        expectedBone: artifact.bone,
      });
      return { ...mesh, anatomyBone: artifact.bone };
    }
    if (artifact.mediaType === "model/stl") {
      const frame = patch.coordinateFramesToAdd.find((candidate) => candidate.id === artifact.coordinateFrameId);
      if (!frame) throw new Error(`Coordinate frame for ${artifact.bone} mesh is unavailable`);
      const mesh = parseStlToViewerMesh(bytes, {
        ...options,
        transformToPatientRas: frame.transformToPatientRas,
      });
      return { ...mesh, anatomyBone: artifact.bone };
    }
    throw new Error(`Unsupported viewer mesh media type for ${artifact.bone}`);
  };

  const applyCompletedSegmentation = async (job: MatNnunetJob, signal?: AbortSignal) => {
    if (job.status !== "completed" || !job.result) throw new Error("Segmentation result is incomplete");
    const anatomyLoadGeneration = ++anatomyLoadGenerationRef.current;
    const patch = segmentationPlanPatch(job.result);
    const meshArtifacts = patch.artifacts.filter((artifact) => artifact.kind === "surface_mesh");
    const resolved = await Promise.allSettled(
      meshArtifacts.map(async (artifact) => ({
        artifact,
        mesh: await resolveSegmentationMesh(artifact, patch, signal),
      })),
    );
    const availableAssetIds = new Set(
      resolved.flatMap((result) => result.status === "fulfilled" ? [result.value.artifact.assetId] : []),
    );
    const meshes = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value.mesh] : []);
    if (anatomyLoadGeneration !== anatomyLoadGenerationRef.current) return;
    const derivedAssets = patch.artifacts.map((artifact) => ({
      id: artifact.assetId,
      serviceRunId: artifact.serviceRunId,
      serviceArtifactId: artifact.serviceArtifactId,
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      immutable: true as const,
      coordinateFrameId: artifact.coordinateFrameId,
      boneIdentity: artifact.bone,
      sourceAssetIds: [patch.sourceToAdd.id],
      availability: artifact.kind === "immutable_labelmap" || availableAssetIds.has(artifact.assetId)
        ? "local_service" as const
        : "unavailable" as const,
    }));
    const run = patch.segmentationRun;
    displayedAnatomySignatureRef.current = run.runId;
    commit((current) => {
      const importedPlan: PlanCase = {
      ...current,
      schemaVersion: CURRENT_PLAN_SCHEMA_VERSION,
      coordinateFrames: mergeById(current.coordinateFrames, patch.coordinateFramesToAdd),
      anatomy: mergeById(current.anatomy, patch.anatomyToAdd),
      sourceStudyIds: [...new Set([...current.sourceStudyIds, patch.sourceToAdd.id])],
      variants: current.variants.map((candidate) => ({
        ...candidate,
        channels: candidate.channels.map((channel) => ({
          ...channel,
          apertureSurfaceAttachment: null,
          endpointSurfaceAttachment: null,
          warnings: channel.surfacePlacement?.state === "clinician_edited"
            ? [...new Set([...channel.warnings, "The anatomy mesh changed; manual patient-RAS coordinates were preserved, but their prior bone-mask attachment is stale and must be explicitly reviewed."])]
            : channel.warnings,
          surfacePlacement: channel.surfacePlacement?.state === "clinician_edited"
            ? {
                ...channel.surfacePlacement,
                meshIds: [],
                endpointMethod: "not_available",
              }
            : {
                state: "pending_default",
                method: "migration_pending",
                meshIds: [],
                endpointMethod: "not_available",
              },
        })),
      })),
      imaging: {
        ...current.imaging,
        sources: mergeById(current.imaging.sources, [patch.sourceToAdd]),
        derivedAssets: mergeById(current.imaging.derivedAssets ?? [], derivedAssets),
        segmentationRuns: mergeById(current.imaging.segmentationRuns ?? [], [{
          id: run.runId,
          adapterId: run.adapterId,
          adapterVersion: run.adapterVersion,
          validationState: run.validationState,
          researchUseOnly: run.researchUseOnly,
          sourceId: run.source.sourceId,
          algorithm: structuredClone(run.algorithm),
          labelStatus: run.labelStatus,
          artifactIds: derivedAssets.map((asset) => asset.id),
          warningCodes: [...new Set([...run.warningCodes, "PATIENT_CHANNEL_REGISTRATION_REQUIRED"])],
          notEvaluatedCodes: [...new Set([...run.notEvaluatedCodes, "patient_channel_registration"])],
          generatedAt: run.generatedAt,
        }]),
        review: {
          ...patch.review,
          corrections: current.imaging.review.corrections,
          meshQuality: { ...current.imaging.review.meshQuality, ...patch.review.meshQuality },
        },
        segmentationAdapterId: patch.segmentationAdapterId,
        segmentationValidationState: patch.segmentationValidationState,
      },
      lateralityVerified: false,
        scaleVerified: false,
      };
      return initializePendingChannelSurfacePlacements(importedPlan, meshes);
    }, "Imported immutable MAT nnUNetv2 segmentation assets, initialized available bone-surface defaults, and reset clinician review gates", {
      persistDeidentifiedSnapshot: true,
    });
    setPatientAnatomyMeshes(meshes);
    setLayerVisibility((current) => ({
      ...current,
      bones: true,
      boneRemoval: true,
      measurements: true,
    }));
    setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }));
    const missing = patch.unavailableRequiredBones.map((item) => item.bone).join(", ");
    const meshQualityFlags = patch.anatomyToAdd
      .filter((anatomy) => anatomy.quality.watertight === false || anatomy.quality.manifold === false)
      .map((anatomy) => `${anatomy.label} display mesh: ${anatomy.quality.watertight === false ? "not watertight" : "nonmanifold"}`)
      .join("; ");
    const unresolvedMeshes = resolved.length - meshes.length;
    setSegmentationUi({
      status: "completed",
      progress: 1,
      message: [
        `${meshes.length} patient-space bone mesh${meshes.length === 1 ? "" : "es"} loaded for research review.`,
        missing ? `Missing required bone: ${missing}.` : "",
        meshQualityFlags ? `${meshQualityFlags}.` : "",
        unresolvedMeshes ? `${unresolvedMeshes} display mesh artifact${unresolvedMeshes === 1 ? "" : "s"} could not be resolved.` : "",
        "Laterality, scale, orientation, identities, and mesh quality remain unverified.",
      ].filter(Boolean).join(" "),
      file: segmentationUi.file,
      jobId: job.jobId,
    });
    showToast("MAT nnUNetv2 research segmentation imported; clinician review gates remain open.");
  };

  const runMatSegmentation = async () => {
    const file = segmentationUi.file;
    if (!file) return;
    const sourceKind = matSourceKind(file);
    if (!sourceKind) return;
    segmentationAbortRef.current?.abort();
    const controller = new AbortController();
    segmentationAbortRef.current = controller;
    try {
      setSegmentationUi((current) => ({ ...current, status: "checking", progress: 0.01, message: "Checking the local MAT runtime and model registry…" }));
      const capabilities = await segmentationClient.getCapabilities(controller.signal);
      if (!capabilities.accepts.includes(sourceKind)) throw new Error("The local MAT service does not accept this source type");
      if (file.size > capabilities.maxUploadBytes) throw new Error("The MRI source exceeds the local service upload limit");
      if (!capabilities.models.some((model) => model.status === "available")) throw new Error("No MAT nnUNetv2 model checkpoint is available");
      setSegmentationUi((current) => ({ ...current, status: "uploading", progress: 0.03, message: "Hashing and uploading the immutable source to the loopback service…" }));
      let job = await segmentationClient.createJob({ source: file, sourceKind, signal: controller.signal });
      setSegmentationUi((current) => ({ ...current, status: "running", progress: job.progress ?? 0.05, jobId: job.jobId, message: "MAT nnUNetv2 inference is running. This output is research-only." }));
      if (job.status !== "completed" && job.status !== "failed") {
        job = await segmentationClient.waitForTerminalJob(job.jobId, {
          signal: controller.signal,
          onUpdate: (update) => setSegmentationUi((current) => ({
            ...current,
            status: "running",
            progress: update.progress ?? current.progress,
            jobId: update.jobId,
            message: update.progress && update.progress >= 0.82
              ? "Creating immutable label maps and decimated patient-RAS review meshes…"
              : "MAT nnUNetv2 inference is running. This output is research-only.",
          })),
        });
      }
      if (job.status === "failed") throw new Error(job.error?.message ?? job.error?.code ?? "MAT segmentation failed");
      await applyCompletedSegmentation(job, controller.signal);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setSegmentationUi((current) => ({
        ...current,
        status: aborted ? "selected" : "failed",
        message: aborted
          ? "Stopped waiting locally. A submitted segmentation job may continue in the loopback service."
          : `Segmentation was not imported: ${error instanceof Error ? error.message : "unknown local service error"}`,
      }));
    } finally {
      if (segmentationAbortRef.current === controller) segmentationAbortRef.current = null;
    }
  };

  const stopWaitingForSegmentation = () => segmentationAbortRef.current?.abort();

  const rehydratePatientAnatomy = useCallback(async (targetPlan: PlanCase) => {
    const anatomyLoadGeneration = ++anatomyLoadGenerationRef.current;
    const activeRun = targetPlan.imaging.segmentationRuns.at(-1);
    const activeArtifactIds = new Set(activeRun?.artifactIds ?? []);
    const assets = targetPlan.imaging.derivedAssets.filter(
      (asset) => asset.kind === "surface_mesh" && activeArtifactIds.has(asset.id),
    );
    if (!assets.length) {
      if (anatomyLoadGeneration === anatomyLoadGenerationRef.current) {
        setPatientAnatomyMeshes(targetPlan.imaging.segmentationRuns.length ? [] : null);
      }
      return;
    }
    setSegmentationUi((current) => ({
      ...current,
      status: "checking",
      progress: 0.25,
      message: "Reconnecting hash-verified patient anatomy meshes from the local service…",
    }));
    const resolved = await Promise.allSettled(assets.map(async (asset): Promise<ViewerMeshPayload> => {
      const bytes = await segmentationClient.getArtifact({
        artifactId: asset.serviceArtifactId,
        expectedSha256: asset.sha256,
        expectedByteLength: asset.byteLength,
      });
      const options = {
        id: asset.id,
        name: `${asset.boneIdentity[0].toUpperCase()}${asset.boneIdentity.slice(1)} · MAT nnUNetv2 research output`,
        color: SEGMENTATION_BONE_COLORS[asset.boneIdentity],
        opacity: MAT_XRAY_BONE_OPACITY,
        layer: "bones" as const,
      };
      if (asset.mediaType === "application/json") {
        const mesh = parseMatViewerMeshArtifactBytes(bytes, { ...options, expectedBone: asset.boneIdentity });
        return { ...mesh, anatomyBone: asset.boneIdentity };
      }
      if (asset.mediaType === "model/stl") {
        const frame = targetPlan.coordinateFrames.find((candidate) => candidate.id === asset.coordinateFrameId);
        if (!frame) throw new Error(`Coordinate frame for ${asset.boneIdentity} is unavailable`);
        const mesh = parseStlToViewerMesh(bytes, { ...options, transformToPatientRas: frame.transformToPatientRas });
        return { ...mesh, anatomyBone: asset.boneIdentity };
      }
      throw new Error(`Unsupported persisted mesh media type for ${asset.boneIdentity}`);
    }));
    if (anatomyLoadGeneration !== anatomyLoadGenerationRef.current) return;
    const meshes = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setPatientAnatomyMeshes(meshes);
    if (meshes.length) {
      commit(
        (current) => initializePendingChannelSurfacePlacements(current, meshes),
        "Initialized pending channel defaults on reconnected patient bone surfaces",
        { persistDeidentifiedSnapshot: true },
      );
      setLayerVisibility((current) => ({
        ...current,
        bones: true,
        boneRemoval: true,
        measurements: true,
      }));
      setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }));
    }
    const failures = resolved.length - meshes.length;
    setSegmentationUi({
      status: failures ? "failed" : "completed",
      progress: failures ? meshes.length / resolved.length : 1,
      message: failures
        ? `${meshes.length} of ${resolved.length} patient meshes reconnected. Missing assets remain unavailable; demo bones were not substituted.`
        : `${meshes.length} hash-verified patient meshes reconnected. Clinician review remains required.`,
      file: null,
      jobId: targetPlan.imaging.segmentationRuns.at(-1)?.id ?? null,
    });
  }, [commit, segmentationClient]);

  useEffect(() => {
    const activeRunId = plan.imaging.segmentationRuns.at(-1)?.id ?? null;
    if (displayedAnatomySignatureRef.current === activeRunId) return;
    displayedAnatomySignatureRef.current = activeRunId;
    if (!activeRunId) {
      anatomyLoadGenerationRef.current += 1;
      setPatientAnatomyMeshes(null);
      return;
    }
    setPatientAnatomyMeshes([]);
    void rehydratePatientAnatomy(plan);
  }, [plan, rehydratePatientAnatomy]);

  const updateImagingReview: React.Dispatch<React.SetStateAction<ImagingReviewState>> = (update) => {
    commit((current) => {
      const review = typeof update === "function" ? update(current.imaging.review) : update;
      return {
        ...current,
        laterality: review.laterality === "unverified" ? current.laterality : review.laterality,
        lateralityVerified: review.laterality !== "unverified",
        scaleVerified: review.scaleVerified,
        imaging: { ...current.imaging, review },
      };
    }, "Updated imaging review and verification provenance");
  };

  const exportObj = () => {
    const completePlanModel = buildViewerScene({
      revision: history.present.sequence,
      channels: variant.channels,
      procedureById,
      selectedChannelId: null,
      anatomyMeshes: [],
    });
    const planned = completePlanModel.scene.meshes.filter((mesh) => mesh.layer !== "bones" && mesh.layer !== "mri" && mesh.layer !== "ghost");
    downloadText("multilig-planned-volumes.obj", meshesToObj(planned), "text/plain");
    downloadText("multilig-planned-volumes.manifest.json", JSON.stringify({
      format: "multilig-planned-volume-manifest",
      version: "1.0.0",
      notice: "Clinician-directed planning only; not a patient-specific surgical guide.",
      planHash: stablePlanHash(planWithAnalysis),
      schemaVersion: plan.schemaVersion,
      geometryGeneratorVersion: plan.geometryGeneratorVersion,
      catalogVersion: plan.catalogVersion,
      coordinateFrame: "patient RAS",
      units: "mm",
      meshIds: planned.map((mesh) => mesh.id),
      incompleteGeometry: [...completePlanModel.geometry.values()]
        .filter((geometry) => !geometry.complete)
        .map((geometry) => ({ id: geometry.id, missingDimensions: geometry.missingDimensions })),
    }, null, 2), "application/json");
  };

  const addIntentionalRelationship = () => {
    if (!selectedChannel || !relationshipTargetId || relationshipTargetId === selectedChannel.id || !relationshipRationale.trim()) return;
    const relationshipId = crypto.randomUUID();
    const rationale = relationshipRationale.trim();
    commit((current) => ({
      ...current,
      intentionalRelationships: [
        ...current.intentionalRelationships,
        {
          id: relationshipId,
          kind: "shared_channel",
          objectIds: [selectedChannel.id, relationshipTargetId],
          rationale,
          createdBy: "local-clinician",
          createdAt: new Date().toISOString(),
          verifiedByUser: true,
        },
      ],
      variants: current.variants.map((candidate) => candidate.id === current.activeVariantId ? {
        ...candidate,
        channels: candidate.channels.map((channel) => [selectedChannel.id, relationshipTargetId].includes(channel.id)
          ? { ...channel, intentionalRelationshipIds: [...channel.intentionalRelationshipIds, relationshipId] }
          : channel),
      } : candidate),
    }), "Recorded clinician-verified intentional shared-channel relationship");
    setRelationshipTargetId("");
    setRelationshipRationale("");
    showToast("Intentional sharing recorded with rationale; only this pair may be classified intentional.");
  };

  const selectedProcedure = selectedChannel ? plan.procedures.find((procedure) => procedure.id === selectedChannel.procedureId) : null;
  const focusedProcedureInstances = focusedProcedureIdentity
    ? plan.procedures.filter((procedure) => procedure.structure === focusedProcedureIdentity)
    : [];
  const focusedProcedureChannels = focusedProcedureInstances.flatMap((procedure) =>
    variant.channels
      .filter((channel) => channel.procedureId === procedure.id)
      .map((channel) => ({ channel, procedure })),
  );
  const focusedProcedureIsHighlighted = focusedProcedureIdentity !== null && highlightedProcedureSet.has(focusedProcedureIdentity);

  const selectChannelForEditing = (channelId: string) => {
    const channel = variant.channels.find((candidate) => candidate.id === channelId);
    if (!channel) return;
    const identity = procedureById[channel.procedureId];
    if (identity) {
      setHighlightedProcedureIdentities((current) => current.includes(identity) ? current : [...current, identity]);
      setFocusedProcedureIdentity(identity);
      setPendingProcedure(null);
    }
    setSelectedChannelId(channelId);
    setLayerVisibility((current) => ({ ...current, boneRemoval: true, pins: true, measurements: true }));
  };

  const toggleProcedureHighlight = (identity: ProcedureIdentity) => {
    const transition = toggleProcedureVisibility(
      highlightedProcedureIdentities,
      focusedProcedureIdentity,
      identity,
    );
    const shouldHide = transition.action === "hide";
    const hasProcedureInstance = plan.procedures.some((procedure) => procedure.structure === identity);
    setFocusedProcedureIdentity(transition.focused);
    setHighlightedProcedureIdentities(transition.highlighted);
    setPendingProcedure(!shouldHide && !hasProcedureInstance ? identity : null);
    if (shouldHide && selectedChannel && procedureById[selectedChannel.procedureId] === identity) {
      setSelectedChannelId(null);
    }
    if (!shouldHide) {
      setLayerVisibility((current) => ({ ...current, boneRemoval: true, pins: true, measurements: true }));
    }
  };
  const selectedGeometry = selectedChannel ? viewerModel.geometry.get(selectedChannel.id) : null;
  const selectedEntryTether = selectedChannel
    ? classifyChannelEntryTether(selectedChannel, selectedProcedure?.structure)
    : null;
  const selectedBoneSurfaceAvailable = selectedEntryTether
    ? viewerModel.scene.meshes.some((mesh) => mesh.layer === "bones" && mesh.anatomyBone === selectedEntryTether.bone)
    : false;
  const selectedApertureAttachmentCurrent = Boolean(
    selectedChannel?.apertureSurfaceAttachment &&
    viewerModel.scene.meshes.some((mesh) => mesh.id === selectedChannel.apertureSurfaceAttachment?.meshId),
  );
  const selectedEndpointAttachmentCurrent = Boolean(
    selectedChannel?.endpointSurfaceAttachment &&
    viewerModel.scene.meshes.some((mesh) => mesh.id === selectedChannel.endpointSurfaceAttachment?.meshId),
  );
  const selectedUsesAnchorTrajectoryRod = selectedChannel?.geometryType === "anchor_pilot";
  const selectedTrajectoryControlsReady = selectedBoneSurfaceAvailable &&
    selectedApertureAttachmentCurrent &&
    (selectedUsesAnchorTrajectoryRod || selectedEndpointAttachmentCurrent);
  const selectedEnvelopeProvenance = selectedChannel?.apertureSurfaceAttachment?.constraintProvenance;
  const selectedEnvelopeUsesXyFallback = selectedEnvelopeProvenance?.resolution === "nearest_xy_fallback";
  const selectedSurfaceStatus = !selectedBoneSurfaceAvailable
    ? "Surface unavailable"
    : selectedUsesAnchorTrajectoryRod && selectedApertureAttachmentCurrent
      ? "Start attached · trajectory handle ready"
      : selectedApertureAttachmentCurrent && selectedEndpointAttachmentCurrent
      ? "Entry + Start attached"
      : selectedApertureAttachmentCurrent
        ? selectedEnvelopeUsesXyFallback
          ? "Entry attached · Start N/E · position review"
          : "Entry attached · Start not evaluated"
        : "Entry surface not evaluated";
  const selectedFamilyBase: Array<[string, string]> = selectedChannel?.instrumentChain.manufacturerId
    ? getProductFamilies(selectedChannel.instrumentChain.manufacturerId).map((family) => [family.id, `${family.name} · ${family.status.replaceAll("_", " ")}`])
    : [];
  const retainedFamily = PRODUCT_FAMILIES.find((item) => item.id === selectedChannel?.instrumentChain.productFamilyId);
  const selectedFamilyOptions: Array<[string, string]> = retainedFamily && !selectedFamilyBase.some(([id]) => id === retainedFamily.id)
    ? [[retainedFamily.id, `Retained incompatible · ${retainedFamily.name}`], ...selectedFamilyBase]
    : selectedFamilyBase;
  const selectedVariantBase: Array<[string, string]> = selectedChannel?.instrumentChain.productFamilyId
    ? getProductVariants(selectedChannel.instrumentChain.productFamilyId).map((variantRecord) => [
        variantRecord.id,
        `${variantRecord.name}${variantRecord.sku ? ` · ${variantRecord.sku}` : " · exact model; SKU not documented"} · ${variantRecord.status.replaceAll("_", " ")}`,
      ])
    : [];
  const selectedVariantRecord = PRODUCT_VARIANTS.find((item) => item.id === selectedChannel?.instrumentChain.productVariantId);
  const selectedVariantOptions: Array<[string, string]> = selectedVariantRecord && !selectedVariantBase.some(([id]) => id === selectedVariantRecord.id)
    ? [[selectedVariantRecord.id, `Retained incompatible · ${selectedVariantRecord.name}`], ...selectedVariantBase]
    : selectedVariantBase;
  const exactSizeBase: Array<[string, string]> = selectedVariantRecord
    ? (selectedVariantRecord.selectableSizesMm ?? []).map((size) => [
        `${selectedVariantRecord.id}:size:${size}`,
        `${size.toFixed(1)} mm · manufacturer-documented family setting`,
      ])
    : [];
  const retainedExactSizeId = selectedChannel?.instrumentChain.exactSizeOrProfileId;
  const exactSizeOptions: Array<[string, string]> = retainedExactSizeId && !exactSizeBase.some(([id]) => id === retainedExactSizeId)
    ? [[retainedExactSizeId, `Retained incompatible / unverified · ${retainedExactSizeId}`], ...exactSizeBase]
    : exactSizeBase;
  const selectedManufacturerId = selectedChannel?.instrumentChain.manufacturerId;
  const guideOptions = instrumentOptions(selectedManufacturerId, ["guide"], selectedChannel?.instrumentChain.guideInstrumentId);
  const hookOptions = instrumentOptions(selectedManufacturerId, ["hook_arm"], selectedChannel?.instrumentChain.hookArmOffsetAngle.hookOrArmId);
  const sleeveOptions = instrumentOptions(selectedManufacturerId, ["sleeve_bullet", "depth_stop"], selectedChannel?.instrumentChain.sleeveBulletDepthStop.sleeveOrBulletId);
  const pinOptions = instrumentOptions(selectedManufacturerId, ["pin"], selectedChannel?.instrumentChain.pinInstrumentId);
  const cutterOptions = instrumentOptions(selectedManufacturerId, ["drill", "reamer", "cutter", "dilator", "punch", "tap", "trephine"], selectedChannel?.instrumentChain.cutterInstrumentId);
  const fixationOptions: Array<[string, string]> = PRODUCT_VARIANTS
    .filter((variantRecord) => {
      const category = PRODUCT_FAMILIES.find((family) => family.id === variantRecord.familyId)?.category;
      return category === "cortical_fixation" || category === "interference_fixation" || category === "anchor" || category === "post_washer_staple";
    })
    .map((variantRecord) => {
      const family = PRODUCT_FAMILIES.find((item) => item.id === variantRecord.familyId);
      const manufacturer = CATALOG_MANUFACTURERS.find((item) => item.id === family?.manufacturerId);
      return [variantRecord.id, `${manufacturer?.name ?? "Unknown"} · ${variantRecord.name}${variantRecord.sku ? ` · ${variantRecord.sku}` : " · exact model; SKU not documented"}`];
    });
  const selectedFixation = PRODUCT_VARIANTS.find((item) => item.id === selectedChannel?.instrumentChain.fixationImplantIds[0]);
  const preparationManufacturerId = PRODUCT_FAMILIES.find((item) => item.id === selectedFixation?.familyId)?.manufacturerId ?? selectedManufacturerId;
  const preparationOptions = instrumentOptions(preparationManufacturerId, ["drill", "punch", "tap", "driver"], selectedChannel?.instrumentChain.fixationPreparationInstrumentIds[0]);
  const selectedCatalogSourceIds = new Set<string>([
    ...(selectedChannel?.instrumentChain.sourceIds ?? []),
    ...(PRODUCT_FAMILIES.find((item) => item.id === selectedChannel?.instrumentChain.productFamilyId)?.sourceIds ?? []),
    ...(selectedVariantRecord?.sourceIds ?? []),
  ]);
  const selectedCatalogSources = getCatalogSources([...selectedCatalogSourceIds]);
  const conflicts = selectedAnalysis.filter((result) => result.status === "conflict").length;
  const near = selectedAnalysis.filter((result) => result.status === "below_threshold").length;
  const notEvaluated = selectedAnalysis.filter((result) => result.status === "not_evaluated").length;

  return (
    <div className="app-shell">
      <header className="command-bar">
        <div className="brand">
          <img className="brand-mark" src={publicAssetPath("multilig-planner-logo.png")} alt="" aria-hidden="true" draggable={false} />
          <div>
            <div className="brand-name">Multilig Planner</div>
            <div className="brand-sub">Clinician-directed 3D planning</div>
          </div>
        </div>
        <div className="case-crumb">
          <span className="case-title">{plan.deidentifiedLabel}</span>
          <span className="slash">/</span>
          <select
            className="compact-select"
            aria-label="Active plan variant"
            value={plan.activeVariantId}
            onChange={(event) => commit((current) => setActiveVariant(current, event.target.value), "Changed active variant")}
            style={{ width: 112, minHeight: 27 }}
          >
            {plan.variants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <StatusPill tone={hasPatientSegmentation ? "warn" : "info"}>
            {hasPatientSegmentation ? "MRI-derived · research only" : "Synthetic · nonclinical"}
          </StatusPill>
          <span className="pill">RAS · mm</span>
          <span className="pill warn">Catalog {plan.catalogVersion} frozen</span>
        </div>
        <div className="toolbar-actions">
          <button className="cmd-btn icon-only" title="Undo" disabled={!history.past.length} onClick={() => setHistory(undoPlan)}>↶</button>
          <button className="cmd-btn icon-only" title="Redo" disabled={!history.future.length} onClick={() => setHistory(redoPlan)}>↷</button>
          <button className="cmd-btn" onClick={() => setShowImport(true)}>Import</button>
          <button className="cmd-btn" onClick={() => {
            commit((current) => cloneActiveVariant(current, `Plan ${String.fromCharCode(65 + current.variants.length)}`), "Cloned active variant");
            showToast("Named plan variant created with frozen catalog reference.");
          }}>New variant</button>
          <button className="cmd-btn" onClick={() => {
            savePlanLocally(LOCAL_PLAN_KEY, deidentifiedLocalSnapshot(planWithAnalysis));
            showToast("De-identified plan snapshot saved in browser storage; free-text provenance requires re-verification after reload.");
          }}>Save</button>
          <button className="cmd-btn" onClick={() => {
            const loaded = loadPlanLocally<PlanCase>(LOCAL_PLAN_KEY);
            if (loaded) {
              const normalized = normalizeLoadedPlan(loaded);
              displayedAnatomySignatureRef.current = null;
              setHistory(createPlanHistory(normalized));
              setSelectedChannelId(null);
              setHighlightedProcedureIdentities([]);
              setFocusedProcedureIdentity(null);
              setPendingProcedure(null);
              setPatientAnatomyMeshes(normalized.imaging.segmentationRuns.length ? [] : null);
              showToast("Saved plan reloaded with integrity check passed; reconnecting local imaging meshes.");
            } else showToast("No local saved plan found.");
          }}>Reload</button>
          <button className="primary-btn" onClick={() => setShowExport(true)}>Export plan</button>
        </div>
      </header>

      <main className={`workspace ${leftOpen ? "" : "left-collapsed"}`}>
        <aside className={`left-panel ${leftOpen ? "" : "collapsed"}`} aria-label="Planning workflow">
          <div className="panel-heading">{leftOpen ? <><span>Workflow</span><span>{plan.procedures.length} procedures</span></> : null}<button className="tiny-btn panel-collapse" aria-label={leftOpen ? "Collapse workflow panel" : "Expand workflow panel"} title={leftOpen ? "Collapse workflow" : "Expand workflow"} onClick={() => setLeftOpen((current) => !current)}>{leftOpen ? "‹" : "›"}</button></div>
          {leftOpen ? <div className="panel-scroll">
            <details className="workflow-section" open>
              <summary>Case &amp; Imaging <span className="section-badge">{sources.length}</span></summary>
              <div className="section-body">
                <Field label="De-identified case label">
                  <input value={plan.deidentifiedLabel} onChange={(event) => commit((current) => ({ ...current, deidentifiedLabel: event.target.value }), "Changed de-identified label")} />
                </Field>
                <div className="input-row">
                  <Field label="Laterality">
                    <select value={imagingReview.laterality} onChange={(event) => {
                      const laterality = event.target.value as ImagingReviewState["laterality"];
                      updateImagingReview((current) => ({ ...current, laterality }));
                    }}><option value="unverified">Unverified</option><option value="left">Left · clinician verified</option><option value="right">Right · clinician verified</option></select>
                  </Field>
                  <Field label="Scale"><span className={`pill ${plan.scaleVerified ? "ok" : "warn"}`}>{plan.scaleVerified ? "Verified" : "Verify"}</span></Field>
                  <Field label="Frame"><span className="pill info">RAS</span></Field>
                </div>
                <button className="secondary-btn" style={{ width: "100%" }} onClick={() => setShowImport(true)}>Import MRI / segmentation / mesh</button>
                <div className="missing-banner" style={{ marginTop: 7 }}><strong>{SEGMENTATION_BOUNDARY.validationState.replaceAll("_", " ")}</strong>{SEGMENTATION_BOUNDARY.notice}</div>
                {hasPatientSegmentation ? <div className="missing-banner" style={{ marginTop: 7 }}><strong>Patient channel registration required</strong>Seed channels are placed on their declared MRI-derived bone masks when available, but they have not been landmark-registered and do not infer a surgical footprint. Reposition and verify every Entry and Start point before interpreting the plan.</div> : null}
              </div>
            </details>

            <details className="workflow-section" open>
              <summary>Procedures <span className="section-badge">{highlightedProcedureIdentities.length} shown</span></summary>
              <div className="section-body">
                <div className="procedure-visibility-help">
                  <strong>Select procedures to show in 3D</strong>
                  <span>Any combination can be highlighted. This changes Viewer visibility only; it does not add or remove plan data.</span>
                </div>
                <div className="quick-add-grid" role="group" aria-label="Procedures shown in the 3D model">
                  {PROCEDURE_QUICK_ADD.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`${highlightedProcedureSet.has(item.id)
                        ? focusedProcedureIdentity === item.id ? "Hide" : "Focus"
                        : "Show"} ${item.label} procedure${highlightedProcedureSet.has(item.id) && focusedProcedureIdentity !== item.id ? " controls; remains shown in 3D" : " in 3D"}`}
                      aria-pressed={highlightedProcedureSet.has(item.id)}
                      aria-controls="focused-procedure-workflow"
                      className={`quick-add procedure-visibility-button ${highlightedProcedureSet.has(item.id) ? "active" : ""} ${focusedProcedureIdentity === item.id ? "focused" : ""} ${item.id === "MCL_POL_PMC" || item.id.includes("ROOT") ? "wide" : ""}`}
                      onClick={() => toggleProcedureHighlight(item.id)}
                    ><span>{item.label}</span><span className="procedure-visibility-state" aria-hidden="true">{highlightedProcedureSet.has(item.id) ? "●" : "○"}</span></button>
                  ))}
                </div>
                <div id="focused-procedure-workflow" className={`focused-procedure-workflow ${focusedProcedureIdentity ? "visible" : ""}`}>
                  {focusedProcedureIdentity ? <>
                    <div className="focused-procedure-heading">
                      <div><span>Focused procedure</span><strong>{procedureLabel(focusedProcedureIdentity)}</strong></div>
                      <span>{focusedProcedureIsHighlighted ? "Shown in 3D" : "Hidden from 3D"} · {focusedProcedureChannels.length} channel{focusedProcedureChannels.length === 1 ? "" : "s"}</span>
                    </div>
                    {!focusedProcedureIsHighlighted ? <div className="procedure-hidden-note"><strong>Not rendered</strong><span>Select this procedure above again—or select one of its channels below—to show it in 3D.</span></div> : null}
                    {pendingProcedure === focusedProcedureIdentity ? (
                      <div className="procedure-technique-choice">
                        <div className="procedure-technique-prompt"><strong>Add an exact named technique</strong><span>Only this explicit choice creates a construct. No device, graft, fixation, or final size/depth is selected; anchor techniques may show a clearly provisional visual socket.</span></div>
                        <div className="technique-picker">
                          {getTechniquePresetsForProcedure(focusedProcedureIdentity).map((preset) => (
                            <button key={preset.id} type="button" className="technique-option" onClick={() => addPreset(preset.id)}><strong>{preset.name}</strong><span>{preset.description}</span></button>
                          ))}
                          <button type="button" className="secondary-btn" onClick={() => setPendingProcedure(null)}>Close technique choices</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="secondary-btn choose-another-technique" onClick={() => setPendingProcedure(focusedProcedureIdentity)}>Add a named technique…</button>
                    )}
                    {focusedProcedureChannels.length ? (
                      <div className="procedure-list" aria-label={`${procedureLabel(focusedProcedureIdentity)} channels`}>
                        <div className="procedure-list-heading">Select one channel to show and edit</div>
                        {focusedProcedureChannels.map(({ channel, procedure }) => (
                          <button
                            key={channel.id}
                            type="button"
                            className={`procedure-row ${selectedChannelId === channel.id ? "selected" : ""}`}
                            onClick={() => selectChannelForEditing(channel.id)}
                          >
                            <span className="procedure-color" style={{ background: PROCEDURE_COLORS[procedure.structure] ?? "#aaa" }} />
                            <span className="procedure-row-copy"><span className="procedure-name">{channel.label}</span><span className="procedure-technique">{procedure.techniqueName} · {channel.bone}</span></span>
                            <span className="row-icon" aria-hidden="true">{selectedChannelId === channel.id ? "●" : "○"}</span>
                          </button>
                        ))}
                      </div>
                    ) : <div className="procedure-empty">No {procedureLabel(focusedProcedureIdentity)} channel exists in this variant yet. Choose an exact named technique above to create editable channel objects.</div>}
                  </> : <div className="procedure-empty">Select one or more procedure buttons. Only highlighted procedures are rendered; the most recently clicked procedure opens here.</div>}
                </div>
              </div>
            </details>

            <details className="workflow-section" open={selectedProcedure !== null}>
              <summary>Technique <span className="section-badge">{selectedProcedure ? "1" : "—"}</span></summary>
              <div className="section-body">
                {selectedProcedure ? (
                  <>
                    <div className="eyebrow">Editable preset</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>{selectedProcedure.techniqueName}</div>
                    <div className="field-hint" style={{ marginTop: 5 }}>Technique name is metadata. Channel geometry below remains authoritative.</div>
                  </>
                ) : <div className="empty-state"><strong>No channel selected</strong>Choose a procedure, select its named technique, then click the exact colored channel row.</div>}
              </div>
            </details>

            <details className="workflow-section" open>
              <summary>Instruments <span className="section-badge">{selectedChannel?.instrumentChain.missingSelections.length ?? "—"}</span></summary>
              <div className="section-body">
                {selectedChannel ? (
                  <div className="chain-flow">
                    {selectedChannel.instrumentChain.completionState === "incompatible" ? <div className="missing-banner"><strong>Resolve retained chain conflict</strong>The existing family/SKU remains visible but does not belong to the currently selected manufacturer/family. Nothing was substituted.</div> : null}
                    <ChainSelect label="Region / institution set" value={selectedChannel.instrumentChain.regionInstitutionSetId} options={REGION_INSTITUTION_SETS.map((set) => [set.id, `${set.label} · ${set.status.replaceAll("_", " ")} · checked ${set.checkedAt}`])} onChange={(value) => {
                      const set = REGION_INSTITUTION_SETS.find((item) => item.id === value);
                      updateChain((chain) => ({ ...chain, regionInstitutionSetId: value, marketOrRegion: set?.marketOrRegion ?? null }), "Selected region/institution set");
                    }} />
                    <ChainSelect label="Manufacturer" value={selectedChannel.instrumentChain.manufacturerId} options={MANUFACTURER_OPTIONS} onChange={(value) => updateChain((chain) => ({ ...chain, manufacturerId: value, userVerified: false }), "Selected manufacturer")} />
                    <ChainSelect label="Product family" value={selectedChannel.instrumentChain.productFamilyId} options={selectedFamilyOptions} onChange={(value) => updateChain((chain) => ({ ...chain, productFamilyId: value, userVerified: false }), "Selected product family")} />
                    <ChainSelect label="Exact model / SKU" value={selectedChannel.instrumentChain.productVariantId} options={selectedVariantOptions} onChange={(value) => updateChain((chain) => ({ ...chain, productVariantId: value, userVerified: false }), "Selected exact model/SKU")} />
                    <ChainSelect label="Guide" value={selectedChannel.instrumentChain.guideInstrumentId} options={guideOptions} onChange={(value) => updateChain((chain) => ({ ...chain, guideInstrumentId: value }), "Selected guide")} />
                    <ChainSelect label="Guide side" value={selectedChannel.instrumentChain.guideSide} options={[["left", "Left-sided guide"], ["right", "Right-sided guide"], ["universal", "Universal guide"]]} onChange={(value) => updateChain((chain) => ({ ...chain, guideSide: value as InstrumentChain["guideSide"] }), "Selected guide side")} />
                    <ChainSelect label="Hook / arm" value={selectedChannel.instrumentChain.hookArmOffsetAngle.hookOrArmId} options={hookOptions} onChange={(value) => updateChain((chain) => ({ ...chain, hookArmOffsetAngle: { ...chain.hookArmOffsetAngle, hookOrArmId: value } }), "Selected hook/arm")} />
                    <div className="input-row" style={{ marginLeft: 19 }}>
                      <Field label="Offset mm"><input type="number" step="0.5" value={selectedChannel.instrumentChain.hookArmOffsetAngle.offsetMm ?? ""} onChange={(event) => updateChain((chain) => ({ ...chain, hookArmOffsetAngle: { ...chain.hookArmOffsetAngle, offsetMm: event.target.value === "" ? null : Number(event.target.value) } }), "Entered guide offset")} /></Field>
                      <Field label="Angle deg"><input type="number" step="1" value={selectedChannel.instrumentChain.hookArmOffsetAngle.angleDeg ?? ""} onChange={(event) => updateChain((chain) => ({ ...chain, hookArmOffsetAngle: { ...chain.hookArmOffsetAngle, angleDeg: event.target.value === "" ? null : Number(event.target.value) } }), "Entered guide angle")} /></Field>
                    </div>
                    <ChainSelect label="Sleeve / bullet / depth stop" value={selectedChannel.instrumentChain.sleeveBulletDepthStop.sleeveOrBulletId} options={sleeveOptions} onChange={(value) => updateChain((chain) => ({ ...chain, sleeveBulletDepthStop: { ...chain.sleeveBulletDepthStop, sleeveOrBulletId: value } }), "Selected sleeve/bullet")} />
                    <div style={{ marginLeft: 19 }}><Field label="Depth stop mm"><input type="number" step="0.5" value={selectedChannel.instrumentChain.sleeveBulletDepthStop.depthStopMm ?? ""} onChange={(event) => updateChain((chain) => ({ ...chain, sleeveBulletDepthStop: { ...chain.sleeveBulletDepthStop, depthStopMm: event.target.value === "" ? null : Number(event.target.value) } }), "Entered depth stop")} /></Field></div>
                    <ChainSelect label="Pin" value={selectedChannel.instrumentChain.pinInstrumentId} options={pinOptions} onChange={(value) => updateChain((chain) => ({ ...chain, pinInstrumentId: value }), "Selected pin")} />
                    <ChainSelect label="Cutter / reamer / dilator / punch / tap" value={selectedChannel.instrumentChain.cutterInstrumentId} options={cutterOptions} onChange={(value) => updateChain((chain) => ({ ...chain, cutterInstrumentId: value }), "Selected cutter/tool")} />
                    <ChainSelect label="Exact branded size / profile" value={selectedChannel.instrumentChain.exactSizeOrProfileId} options={exactSizeOptions} onChange={(value) => updateChain(
                      (chain) => ({ ...chain, exactSizeOrProfileId: value }),
                      "Selected exact documented size/profile",
                      {
                        updateGeometry: (channel, exactSizeMm) => {
                          if (exactSizeMm === null) return channel;
                          return {
                            ...channel,
                            diameterMm: exactSizeMm,
                            crossSection: channel.crossSection.kind === "circle"
                              ? { ...channel.crossSection, diameterMm: exactSizeMm }
                              : channel.crossSection,
                          };
                        },
                      },
                    )} />
                    {selectedChannel.instrumentChain.manufacturerId === "mfr-generic" || selectedChannel.instrumentChain.manufacturerId === "mfr-institution" ? <div style={{ marginLeft: 19 }}><Field label="Exact verified local profile record"><input placeholder="Institution record ID / measured profile ID" value={selectedChannel.instrumentChain.exactSizeOrProfileId ?? ""} onChange={(event) => updateChain((chain) => ({ ...chain, exactSizeOrProfileId: event.target.value || null }), "Entered exact local size/profile record")} /></Field></div> : null}
                    <div style={{ marginLeft: 19 }}>
                      <Field label="Depth / full-tunnel setting"><select value={selectedChannel.instrumentChain.depthOrFullTunnelSetting.mode ?? ""} onChange={(event) => updateChain(
                        (chain) => ({ ...chain, depthOrFullTunnelSetting: { mode: (event.target.value || null) as "depth" | "full_tunnel" | null, depthMm: null } }),
                        "Selected depth/full-tunnel mode",
                        {
                          updateGeometry: (channel) => ({
                            ...channel,
                            ...(event.target.value === "full_tunnel" ? { fullThickness: true } : {}),
                            endpointSurfaceAttachment: null,
                          }),
                        },
                      )}><option value="">Selection required…</option><option value="depth">Exact planned depth</option><option value="full_tunnel">Full tunnel</option></select></Field>
                      {selectedChannel.instrumentChain.depthOrFullTunnelSetting.mode === "depth" ? <Field label="Exact instrument depth mm"><input type="number" step="0.5" value={selectedChannel.instrumentChain.depthOrFullTunnelSetting.depthMm ?? ""} onChange={(event) => {
                        const exactDepthMm = event.target.value === "" ? null : Number(event.target.value);
                        updateChain(
                          (chain) => ({ ...chain, depthOrFullTunnelSetting: { ...chain.depthOrFullTunnelSetting, depthMm: exactDepthMm } }),
                          "Entered exact chain depth",
                          { updateGeometry: (channel) => applyChannelDepthGeometryEdit(channel, exactDepthMm) },
                        );
                      }} /></Field> : null}
                    </div>
                  </div>
                ) : <div className="empty-state"><strong>No channel selected</strong>Select a channel to assemble its exact chain.</div>}
              </div>
            </details>

            <details className="workflow-section">
              <summary>Graft &amp; Fixation <span className="section-badge">{selectedChannel?.instrumentChain.graftSelectionId ? "✓" : "!"}</span></summary>
              <div className="section-body">
                {selectedChannel ? <>
                  <Field label="Graft / repair construct">
                    <select value={selectedChannel.instrumentChain.graftSelectionId ?? ""} onChange={(event) => {
                      const graftSelectionId = event.target.value || null;
                      updateChain(
                        (chain) => ({ ...chain, graftSelectionId }),
                        "Selected graft/repair construct",
                        {
                          updateGeometry: (channel) => ({
                            ...channel,
                            graft: graftSelectionId ? {
                              id: `graft-plan-${channel.id}`,
                              type: graftSelectionId,
                              preparation: null,
                              diameterMm: null,
                              dimensionsMm: {},
                              source: "clinician_selected",
                              verifiedByUser: false,
                            } : null,
                          }),
                        },
                      );
                    }}>
                      <option value="">Clinician selection required…</option><option value="graft-measured">Measured patient graft / bone block</option><option value="graft-allograft-verified">Institution-verified allograft record</option><option value="repair-no-graft">Repair construct · no graft</option>
                    </select>
                  </Field>
                  {selectedChannel.graft ? <div className="geometry-grid">
                    <Field label="Graft preparation"><input aria-label="Exact graft preparation" placeholder="Clinician-entered preparation required" value={selectedChannel.graft.preparation ?? ""} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, graft: channel.graft ? { ...channel.graft, preparation: event.target.value || null, verifiedByUser: false } : null }), "Entered graft preparation")} /></Field>
                    {selectedChannel.graft.type !== "repair-no-graft" ? <Field label="Measured graft diameter"><div className="input-with-unit"><input aria-label="Measured graft diameter" type="number" min="0" step="0.5" value={selectedChannel.graft.diameterMm ?? ""} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, graft: channel.graft ? { ...channel.graft, diameterMm: event.target.value === "" ? null : Number(event.target.value), verifiedByUser: false } : null }), "Entered measured graft diameter")} /><span className="input-unit">mm</span></div></Field> : null}
                    <Field label="Graft source"><select aria-label="Graft source" value={selectedChannel.graft.source ?? ""} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, graft: channel.graft ? { ...channel.graft, source: (event.target.value || null) as NonNullable<ChannelPlan["graft"]>["source"], verifiedByUser: false } : null }), "Selected graft source")}><option value="">Selection required…</option><option value="clinician_selected">Clinician selected</option><option value="measured">Measured</option><option value="imported">Imported verified record</option></select></Field>
                    <label className="checkbox-row"><input type="checkbox" checked={selectedChannel.graft.verifiedByUser} disabled={!selectedChannel.graft.preparation || !selectedChannel.graft.source || (selectedChannel.graft.type !== "repair-no-graft" && (!selectedChannel.graft.diameterMm || selectedChannel.graft.diameterMm <= 0))} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, graft: channel.graft ? { ...channel.graft, verifiedByUser: event.target.checked } : null }), "Verified graft plan")} /> Clinician verified current graft and preparation values</label>
                  </div> : null}
                  <Field label="Fixation implant">
                    <select value={selectedChannel.instrumentChain.fixationImplantIds[0] ?? ""} onChange={(event) => {
                      const fixationId = event.target.value || null;
                      updateChain(
                        (chain) => ({ ...chain, fixationImplantIds: fixationId ? [fixationId] : [] }),
                        "Selected fixation implant",
                        {
                          updateGeometry: (channel) => ({
                            ...channel,
                            fixation: fixationId && fixationId !== "explicit-no-fixation" ? [{
                              id: `fixation-plan-${channel.id}`,
                              role: channel.bone === "femur" ? "femoral" : channel.bone === "tibia" ? "tibial" : channel.bone === "fibula" ? "fibular" : "other",
                              productVariantId: PRODUCT_VARIANTS.some((item) => item.id === fixationId) ? fixationId : null,
                              preparationInstrumentIds: channel.instrumentChain.fixationPreparationInstrumentIds,
                              verifiedByUser: false,
                            }] : [],
                          }),
                        },
                      );
                    }}>
                      <option value="">Exact implant required…</option>{fixationOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="institution-fixation-exact">Institution exact implant · local override record required</option><option value="explicit-no-fixation">Clinician selected: no retained fixation</option>
                    </select>
                  </Field>
                  <Field label="Fixation preparation">
                    <select value={selectedChannel.instrumentChain.fixationPreparationInstrumentIds[0] ?? ""} onChange={(event) => {
                      const preparationId = event.target.value || null;
                      updateChain(
                        (chain) => ({ ...chain, fixationPreparationInstrumentIds: preparationId ? [preparationId] : [] }),
                        "Selected fixation preparation",
                        {
                          updateGeometry: (channel) => ({
                            ...channel,
                            fixation: channel.fixation.map((fixation) => ({ ...fixation, preparationInstrumentIds: preparationId ? [preparationId] : [] })),
                          }),
                        },
                      );
                    }}>
                      <option value="">Drill / punch / tap required…</option>{preparationOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="institution-prep-exact">Institution exact preparation · local override record required</option><option value="explicit-no-preparation">Clinician selected: no preparation instrument</option>
                    </select>
                  </Field>
                  {selectedChannel.fixation.length ? <label className="checkbox-row"><input type="checkbox" checked={selectedChannel.fixation.every((fixation) => fixation.verifiedByUser)} disabled={!selectedChannel.instrumentChain.fixationPreparationInstrumentIds.length || selectedChannel.instrumentChain.fixationPreparationInstrumentIds.includes("institution-prep-exact")} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, fixation: channel.fixation.map((fixation) => ({ ...fixation, verifiedByUser: event.target.checked })) }), "Verified fixation plan")} /> Clinician verified exact fixation implant and preparation</label> : selectedChannel.instrumentChain.fixationImplantIds.includes("explicit-no-fixation") ? <div className="field-hint">No retained fixation was explicitly selected; this remains part of the audited chain.</div> : null}
                </> : null}
              </div>
            </details>

            <details className="workflow-section">
              <summary>Tunnel Geometry <span className="section-badge">mm</span></summary>
              <div className="section-body">
                {selectedChannel ? <>
                  <Field label={selectedChannel.geometryType === "anchor_pilot" ? "Anchor socket/pilot depth" : "Depth / tunnel length"}><div className="input-with-unit"><input type="number" step="0.5" value={selectedChannel.depthMm ?? ""} onChange={(event) => numericChannelValue("depthMm", event.target.value)} /><span className="input-unit">mm</span></div></Field>
                  <Field label={selectedChannel.geometryType === "anchor_pilot" ? "Anchor socket/pilot diameter" : "Diameter / primary size"}><div className="input-with-unit"><input type="number" step={selectedChannel.geometryType === "anchor_pilot" ? "0.05" : "0.5"} value={selectedChannel.diameterMm ?? ""} onChange={(event) => numericChannelValue("diameterMm", event.target.value)} /><span className="input-unit">mm</span></div></Field>
                  <Field label="Profile orientation"><div className="input-with-unit"><input type="number" step="1" value={selectedChannel.orientationDeg} onChange={(event) => numericChannelValue("orientationDeg", event.target.value)} /><span className="input-unit">°</span></div></Field>
                  {selectedChannel.geometryType !== "anchor_pilot" ? <label className="checkbox-row"><input type="checkbox" checked={selectedChannel.fullThickness} onChange={(event) => commitChannel(selectedChannel.id, (channel) => {
                    const fullThickness = event.target.checked;
                    const toggled = { ...channel, fullThickness };
                    if (fullThickness && channel.endpointSurfaceAttachment) {
                      return applySurfaceConstrainedHandleCommit(
                        toggled,
                        procedureById[channel.procedureId],
                        {
                          channelId: channel.id,
                          kind: "endpoint",
                          position: [...channel.endpointSurfaceAttachment.attachedPointPatientRasMm],
                          phase: "commit",
                        },
                        interactionAnatomyMeshes,
                      );
                    }
                    return attachMissingForwardSurfaceStart(toggled, interactionAnatomyMeshes);
                  }, "Changed full-tunnel setting")} /> Full tunnel / bicortical</label> : null}
                </> : null}
              </div>
            </details>

            <details className="workflow-section">
              <summary>Sequence <span className="section-badge">{variant.sequence.length}</span></summary>
              <div className="section-body">
                <div className="field-hint">All virtual pins precede the first reaming step in this demonstration sequence.</div>
                <button className="secondary-btn" style={{ width: "100%", marginTop: 7 }} onClick={() => { setBottomTab("sequence"); setBottomOpen(true); }}>Open draggable sequence</button>
              </div>
            </details>
          </div> : null}
        </aside>

        <section className="viewer-column" aria-label="MAT Planner Viewer v2 canvas">
          <div className="viewer-toolbar">
            <div className="tool-group">
              {LAYER_BUTTONS.map(([layer, label]) => <button key={layer} className={`tool-button ${layerVisibility[layer] ? "active" : ""}`} onClick={() => setLayerVisibility((current) => ({ ...current, [layer]: !current[layer] }))}>{label}</button>)}
            </div>
            <div className="tool-group">
              <button className={`tool-button ${clipping.enabled ? "active" : ""}`} onClick={() => setClipping((current) => ({ ...current, enabled: !current.enabled }))}>Clipping</button>
              <button className={`tool-button ${crossSection.enabled ? "active" : ""}`} onClick={() => setCrossSection((current) => ({ ...current, enabled: !current.enabled }))}>Cross-section</button>
            </div>
            {clipping.enabled ? <div className="tool-group plane-controls">
              <select aria-label="Clipping axis" value={clipping.axis} onChange={(event) => setClipping((current) => ({ ...current, axis: event.target.value as "x" | "y" | "z" }))}><option value="x">Clip X</option><option value="y">Clip Y</option><option value="z">Clip Z</option></select>
              <input aria-label="Clipping offset millimeters" type="number" step="1" value={clipping.offsetMm} onChange={(event) => setClipping((current) => ({ ...current, offsetMm: Number(event.target.value) }))} />
              <button className={`tool-button ${clipping.invert ? "active" : ""}`} onClick={() => setClipping((current) => ({ ...current, invert: !current.invert }))}>Invert</button>
            </div> : null}
            {crossSection.enabled ? <div className="tool-group plane-controls">
              <select aria-label="Cross-section axis" value={crossSection.axis} onChange={(event) => setCrossSection((current) => ({ ...current, axis: event.target.value as "x" | "y" | "z" }))}><option value="x">Section X</option><option value="y">Section Y</option><option value="z">Section Z</option></select>
              <input aria-label="Cross-section offset millimeters" type="number" step="1" value={crossSection.offsetMm} onChange={(event) => setCrossSection((current) => ({ ...current, offsetMm: Number(event.target.value) }))} />
            </div> : null}
            <div className="range-row" style={{ width: 118, marginLeft: "auto" }}><input aria-label="Global viewer opacity" type="range" min="0.15" max="1" step="0.05" value={globalOpacity} onChange={(event) => setGlobalOpacity(Number(event.target.value))} /><span className="range-value">{Math.round(globalOpacity * 100)}%</span></div>
          </div>
          <div className="viewer-stage">
            <MatViewerV2Adapter scene={viewerModel.scene} standardView={standardView} screenshotRequest={screenshotRequest} onScreenshot={handleViewerScreenshot} onHandleChange={handleViewerChange} onSelectChannel={selectChannelForEditing} onReady={() => setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }))} />
            <div className="viewer-overlay-top">
              <div className="scene-label"><strong>Patient RAS</strong> · X ML / Y AP / Z SI · millimeters</div>
              <div className="orientation-pad" aria-label="Standard anatomical views">
                <button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+z", nonce: current.nonce + 1 }))}>+SI</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+y", nonce: current.nonce + 1 }))}>+AP</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-z", nonce: current.nonce + 1 }))}>-SI</button>
                <button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-x", nonce: current.nonce + 1 }))}>-ML</button><button className="view-btn center" onClick={() => setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }))}>FIT</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+x", nonce: current.nonce + 1 }))}>+ML</button>
                <button className="view-btn" /><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-y", nonce: current.nonce + 1 }))}>-AP</button><button className="view-btn" />
              </div>
            </div>
            <div className="viewer-legend"><span className="legend-chip" style={{ "--legend-color": "#45d1c5" } as React.CSSProperties}>Bone removal</span><span className="legend-chip" style={{ "--legend-color": "#f6d56b" } as React.CSSProperties}>Pins</span><span className="legend-chip" style={{ "--legend-color": "#5eb5e8" } as React.CSSProperties}>Access</span><span className="legend-chip" style={{ "--legend-color": "#f16f76" } as React.CSSProperties}>Safety margin</span></div>
          </div>
        </section>

        <aside className="right-panel" aria-label="Channel inspector and safety dashboard">
          {selectedChannel ? <>
            <div className="inspector-header">
              <div className="eyebrow">{selectedProcedure ? procedureLabel(selectedProcedure.structure) : "Custom"} · {selectedChannel.bone}</div>
              <div className="inspector-title">{selectedChannel.label}</div>
              <div className="inspector-subtitle">{selectedProcedure?.techniqueName ?? "Editable channel"}</div>
              <div className="status-row">
                <StatusPill tone={selectedChannel.instrumentChain.completionState === "complete" ? "ok" : "warn"}>Chain {selectedChannel.instrumentChain.completionState}</StatusPill>
                <StatusPill tone={selectedGeometry?.complete ? "info" : "warn"}>{selectedGeometry?.complete ? "Geometry complete" : "Geometry incomplete"}</StatusPill>
                <StatusPill tone={selectedTrajectoryControlsReady ? "info" : "warn"}>{selectedSurfaceStatus}</StatusPill>
              </div>
            </div>
            <div className="inspector-body">
              <div className="inspector-section">
                <div className="inspector-section-title"><span>Channel geometry</span><span>Patient RAS · mm</span></div>
                <div className="inspector-section-body">
                  <Field label="Geometry class"><select value={selectedChannel.geometryType} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, geometryType: event.target.value as ChannelPlan["geometryType"] }), "Changed geometry class")}>{GEOMETRY_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
                  {selectedEntryTether?.kind === "intra_articular_tibial_plateau" ? <div className="missing-banner" style={{ marginBottom: 8 }}><strong>{selectedEntryTether.entryLabel} placement rule</strong>{selectedBoneSurfaceAvailable
                    ? selectedUsesAnchorTrajectoryRod
                      ? <>Start is constrained to the highest available tibia-mask point at its X/Y location (patient-RAS Z). {hasPatientSegmentation ? "The displayed mask is derived from the imported segmentation" : "The displayed mask is synthetic and nonclinical"}, not a clinician-reviewed plateau or articular annotation.{selectedEnvelopeUsesXyFallback ? ` The unregistered seed X/Y was outside the available mask footprint and moved ${(selectedEnvelopeProvenance?.xyFallbackDistanceMm ?? 0).toFixed(1)} mm to the nearest supported X/Y; clinician repositioning is required.` : ""} The exterior 28 mm rod is a free Trajectory control; the socket points inward in the exact opposite direction.</>
                      : <>Entry is constrained to the highest available tibia-mask point at its X/Y location (patient-RAS Z). {hasPatientSegmentation ? "The displayed mask is derived from the imported segmentation" : "The displayed mask is synthetic and nonclinical"}, not a clinician-reviewed plateau or articular annotation.{selectedEnvelopeUsesXyFallback ? ` The unregistered seed X/Y was outside the available mask footprint and moved ${(selectedEnvelopeProvenance?.xyFallbackDistanceMm ?? 0).toFixed(1)} mm to the nearest supported X/Y; clinician repositioning is required.` : ""} Start stays attached to the tibia mask when that intersection can be evaluated; socket depth is edited below.</>
                    : "The tibia mask is unavailable, so the highest-Z placement rule cannot be evaluated."}</div>
                    : <div className="field-hint" style={{ marginBottom: 8 }}>{selectedBoneSurfaceAvailable
                      ? selectedUsesAnchorTrajectoryRod
                        ? `Start stays attached to the ${selectedChannel.bone} mask. Trajectory is the free end of a 28 mm exterior rod; dragging it rotates the inward socket without changing socket depth or diameter.`
                        : `Entry and Start handles stay attached to the ${selectedChannel.bone} mask. For a socket, Start marks the pin's bony starting point while socket depth remains an independent parameter below.`
                      : `The ${selectedChannel.bone} mask is unavailable, so Entry and Start attachment cannot be evaluated.`}</div>}
                  {selectedChannel.geometryType === "post_washer_staple" ? <Field label="Surface hardware subtype"><select value={selectedChannel.hardwareSubtype ?? "post_washer"} onChange={(event) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, hardwareSubtype: event.target.value as NonNullable<ChannelPlan["hardwareSubtype"]> }), "Selected surface hardware subtype")}><option value="post_washer">Post and washer</option><option value="staple">Staple with leg pilots</option></select></Field> : null}
                  <Field label="Cross-section"><select value={selectedChannel.crossSection.kind} onChange={(event) => {
                    const kind = event.target.value as CrossSection["kind"];
                    if (kind === selectedChannel.crossSection.kind || window.confirm("Changing profile type keeps the channel but resets shape-specific dimensions. Continue?")) {
                      commitChannel(selectedChannel.id, (channel) => ({ ...channel, crossSection: profileForKind(kind), orientationDeg: 0 }), "Changed cross-section profile");
                    }
                  }}>{CROSS_SECTION_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
                  <SelectedChannelParameterSliders channel={selectedChannel} onNumericValue={numericChannelValue} />
                  {selectedUsesAnchorTrajectoryRod && selectedChannel.verificationState === "needs_dimensions" && selectedChannel.depthMm !== null && selectedChannel.diameterMm !== undefined ? <div className="missing-banner anchor-template-banner">
                    <strong>Generic visual socket · not yet selected</strong>
                    The rendered {selectedChannel.diameterMm.toFixed(2)} mm × {selectedChannel.depthMm.toFixed(1)} mm socket is a MAT-style display template, not device geometry. Change either slider or explicitly adopt these values before any dimensional clearance can be evaluated.
                    <button type="button" data-testid="confirm-anchor-template-dimensions" className="secondary-btn" onClick={() => commitChannel(
                      selectedChannel.id,
                      (channel) => ({ ...channel, verificationState: "needs_instrument_chain" }),
                      "Confirmed displayed anchor planning dimensions",
                    )}>Use current values as planning dimensions</button>
                  </div> : null}
                  <div className="geometry-grid">
                    <Field label="Aperture X"> <div className="input-with-unit"><input aria-label="Channel aperture X" type="number" step="0.5" value={selectedChannel.aperture[0]} onChange={(event) => vectorValue(0, event.target.value, "aperture")} /><span className="input-unit">mm</span></div></Field>
                    <Field label="Aperture Y"> <div className="input-with-unit"><input aria-label="Channel aperture Y" type="number" step="0.5" value={selectedChannel.aperture[1]} onChange={(event) => vectorValue(1, event.target.value, "aperture")} /><span className="input-unit">mm</span></div></Field>
                    <Field label="Aperture Z"> <div className="input-with-unit"><input aria-label="Channel aperture Z" type="number" step="0.5" value={selectedChannel.aperture[2]} onChange={(event) => vectorValue(2, event.target.value, "aperture")} /><span className="input-unit">mm</span></div></Field>
                    <Field label={selectedUsesAnchorTrajectoryRod ? "Anchor socket/pilot depth" : "Depth"}><div className="input-with-unit"><input aria-label="Channel depth" type="number" step="0.5" value={selectedChannel.depthMm ?? ""} onChange={(event) => numericChannelValue("depthMm", event.target.value)} /><span className="input-unit">mm</span></div></Field>
                    <Field label={selectedUsesAnchorTrajectoryRod ? "Anchor socket/pilot diameter" : "Diameter"}><div className="input-with-unit"><input aria-label="Channel diameter" type="number" step={selectedUsesAnchorTrajectoryRod ? "0.05" : "0.5"} value={selectedChannel.diameterMm ?? ""} onChange={(event) => numericChannelValue("diameterMm", event.target.value)} /><span className="input-unit">mm</span></div></Field>
                    <Field label="Orientation"><div className="input-with-unit"><input aria-label="Channel profile orientation" type="number" step="1" value={selectedChannel.orientationDeg} onChange={(event) => numericChannelValue("orientationDeg", event.target.value)} /><span className="input-unit">°</span></div></Field>
                  </div>
                  <CrossSectionFields channel={selectedChannel} onCommit={(crossSection) => commitChannel(selectedChannel.id, (channel) => ({ ...channel, crossSection }), "Changed profile dimensions")} />
                  <GeometryDimensionFields channel={selectedChannel} onCommit={(key, value) => commitChannel(selectedChannel.id, (channel) => {
                    const dimensionsMm = { ...(channel.dimensionsMm ?? {}) };
                    if (value === null) delete dimensionsMm[key];
                    else dimensionsMm[key] = value;
                    return { ...channel, dimensionsMm };
                  }, `Changed explicit geometry parameter ${key}`)} />
                  <div className="handle-instruction">{selectedUsesAnchorTrajectoryRod
                    ? "The Viewer shows a bone-tethered Start point and a free Trajectory handle at the end of the inline exterior rod. Drag the rod or its Trajectory handle to set the axis; the socket remains collinear inside bone and depth/diameter stay independently editable here. Every committed edit creates an audited plan revision."
                    : "Viewer manipulation exposes only Entry and Start handles. Each appears only when its attachment to the selected bone mask can be evaluated; intra-articular tibial Entry uses the highest patient-RAS Z at X/Y. For sockets, the rendered pin path connects those controls while depth, size, and profile orientation remain editable here. Every committed edit creates an audited plan revision."}</div>
                </div>
              </div>

              <div className="inspector-section">
                <div className="inspector-section-title"><span>Collision &amp; Safety</span><span>{analysisThreshold.toFixed(1)} mm info threshold</span></div>
                <div className="inspector-section-body">
                  <div className="safety-summary">
                    <div className="metric conflict"><div className="metric-value">{conflicts}</div><div className="metric-label">Conflicts</div></div>
                    <div className="metric warn"><div className="metric-value">{near}</div><div className="metric-label">Below threshold</div></div>
                    <div className="metric unknown"><div className="metric-value">{notEvaluated}</div><div className="metric-label">Not evaluated</div></div>
                  </div>
                  <div className="range-row" style={{ marginBottom: 8 }}><input aria-label="Informational clearance threshold" type="range" min="0" max="10" step="0.5" value={analysisThreshold} onChange={(event) => commit((current) => ({ ...current, analysisSettings: { informationalClearanceThresholdMm: Number(event.target.value), thresholdSource: "clinician_selected" } }), "Changed informational clearance threshold")} /><span className="range-value">{analysisThreshold.toFixed(1)} mm</span></div>
                  <div className="missing-banner"><strong>Not evaluated</strong>{hasPatientSegmentation
                    ? "MRI-derived femur/tibia display meshes are present, but patient channel-footprint registration, approved cortex/articular surfaces, fibula, physis, prior tunnels/hardware, and danger anatomy are absent or unverified. No patient-specific bone/safety reassurance is shown."
                    : "Posterior neurovascular anatomy, physis, prior tunnels/hardware, articular surface, and patient cortex meshes are absent from this synthetic fixture. No reassurance is shown."}</div>
                  {selectedProcedure?.structure === "PCL" && selectedChannel.bone === "tibia" ? <div className="missing-banner" style={{ marginTop: 6 }}><strong>PCL tibial pin path shown</strong>The yellow path connects Entry and Start. Clearance to posterior neurovascular/danger anatomy is explicitly not evaluated until approved anatomy is registered.</div> : null}
                  {!selectedGeometry?.complete ? <div className="missing-banner" style={{ marginTop: 6 }}><strong>Device geometry incomplete</strong>{selectedGeometry?.missingDimensions.join(", ") || "Exact instrument dimensions required."}</div> : null}
                  <div className="analysis-list" style={{ marginTop: 8 }}>
                    {selectedAnalysis.slice(0, 8).map((result) => {
                      const otherId = result.objectAId === selectedChannel.id ? result.objectBId : result.objectAId;
                      const other = variant.channels.find((channel) => channel.id === otherId)?.label ?? otherId;
                      return <div className={`analysis-card ${result.status}`} key={result.id}><div className="analysis-title"><span>vs {other}</span><span className="analysis-distance">{result.signedClearanceMm === null ? "N/E" : `${result.signedClearanceMm.toFixed(2)} mm`}</span></div><div className="analysis-copy">{result.message}</div></div>;
                    })}
                  </div>
                  <div className="relationship-editor">
                    <div className="field-label">Intentional sharing (explicit only)</div>
                    <select aria-label="Intentional sharing target" value={relationshipTargetId} onChange={(event) => setRelationshipTargetId(event.target.value)}>
                      <option value="">Select another channel…</option>
                      {variant.channels.filter((channel) => channel.id !== selectedChannel.id).map((channel) => <option key={channel.id} value={channel.id}>{channel.label}</option>)}
                    </select>
                    <input aria-label="Intentional sharing rationale" placeholder="Clinician rationale required" value={relationshipRationale} onChange={(event) => setRelationshipRationale(event.target.value)} />
                    <button type="button" data-testid="record-intentional-sharing" className="secondary-btn" disabled={!relationshipTargetId || !relationshipRationale.trim()} onClick={() => addIntentionalRelationship()}>Record shared channel</button>
                    {plan.intentionalRelationships.filter((relationship) => relationship.objectIds.includes(selectedChannel.id)).map((relationship) => <div className="analysis-card intentional_shared" key={relationship.id}><div className="analysis-title"><span>Explicit relationship</span><span>verified</span></div><div className="analysis-copy">{relationship.rationale}</div></div>)}
                  </div>
                </div>
              </div>

              <div className="inspector-section">
                <div className="inspector-section-title"><span>Verification</span><span>{selectedChannel.instrumentChain.missingSelections.length} unresolved</span></div>
                <div className="inspector-section-body">
                  <label className="checkbox-row"><input
                    type="checkbox"
                    checked={selectedChannel.instrumentChain.userVerified}
                    disabled={selectedChannel.instrumentChain.missingSelections.length > 0 || selectedChannel.instrumentChain.completionState === "incompatible" || !selectedChannel.graft?.verifiedByUser || (selectedChannel.fixation.length > 0 && selectedChannel.fixation.some((fixation) => !fixation.verifiedByUser))}
                    onChange={(event) => updateChain(
                      (chain) => ({ ...chain, userVerified: event.target.checked, verification: event.target.checked ? chain.verification : null }),
                      "Changed user verification",
                      { recordVerification: event.target.checked },
                    )}
                  /> Clinician verified current region IFU, tray, dimensions, and exact selections</label>
                  <div className="field-hint" style={{ marginTop: 7 }}>Manufacturer documented does not mean available, approved, indicated, recommended, or mutually compatible.</div>
                  {selectedCatalogSources.length ? <div style={{ marginTop: 8 }}>
                    <div className="field-label">Frozen catalog sources</div>
                    {selectedCatalogSources.map((source) => <div key={source.id} className="analysis-card" style={{ marginTop: 5 }}><div className="analysis-title"><span>{source.title}</span><span>{source.status.replaceAll("_", " ")}</span></div><div className="analysis-copy">Checked {source.checkedAt} · {source.marketOrRegion}{source.url ? <> · <a href={source.url} target="_blank" rel="noreferrer" style={{ color: "#62c7d1" }}>official source</a></> : null}</div></div>)}
                  </div> : <div className="missing-banner" style={{ marginTop: 8 }}><strong>Source unresolved</strong>Select a documented family/SKU or an institution-verified record.</div>}
                </div>
              </div>
            </div>
          </> : <div className="empty-state"><strong>Select a channel</strong>Use a procedure row, 3D volume, or the channel table.</div>}
        </aside>

        <section className={`bottom-drawer ${bottomOpen ? "" : "collapsed"}`} aria-label="Channel and sequence table">
          <div className="drawer-header">
            <div className="drawer-tabs"><button className={`drawer-tab ${bottomTab === "channels" ? "active" : ""}`} onClick={() => { setBottomTab("channels"); setBottomOpen(true); }}>Channels · {variant.channels.length}</button><button className={`drawer-tab ${bottomTab === "sequence" ? "active" : ""}`} onClick={() => { setBottomTab("sequence"); setBottomOpen(true); }}>Sequence · {variant.sequence.length}</button></div>
            <div className="drawer-actions">
              <select className="compact-select" aria-label="Ghost comparison variant" value={ghostVariantId ?? ""} onChange={(event) => setGhostVariantId(event.target.value || null)} style={{ width: 145, minHeight: 23 }}><option value="">Ghost comparison off</option>{plan.variants.filter((item) => item.id !== plan.activeVariantId).map((item) => <option key={item.id} value={item.id}>Ghost {item.name}</option>)}</select>
              <button className="tiny-btn" onClick={() => setBottomOpen((current) => !current)}>{bottomOpen ? "Collapse" : "Expand"}</button>
            </div>
          </div>
          {bottomOpen ? <div className="drawer-body">
            {ghostVariant && selectedChannel && ghostSelectedChannel ? <div className="variant-comparison" aria-label="Plan variant value comparison"><strong>{selectedChannel.label}</strong><span>Active {variant.name}: depth {selectedChannel.depthMm ?? "—"} mm · size {selectedChannel.diameterMm ?? "—"} mm · orientation {selectedChannel.orientationDeg.toFixed(1)}°</span><span>Ghost {ghostVariant.name}: depth {ghostSelectedChannel.depthMm ?? "—"} mm · size {ghostSelectedChannel.diameterMm ?? "—"} mm · orientation {ghostSelectedChannel.orientationDeg.toFixed(1)}°</span><span className="delta">Δ depth {selectedChannel.depthMm !== null && ghostSelectedChannel.depthMm !== null ? (selectedChannel.depthMm - ghostSelectedChannel.depthMm).toFixed(1) : "N/E"} mm · Δ size {selectedChannel.diameterMm !== undefined && ghostSelectedChannel.diameterMm !== undefined ? (selectedChannel.diameterMm - ghostSelectedChannel.diameterMm).toFixed(1) : "N/E"} mm · Δ angle {(selectedChannel.orientationDeg - ghostSelectedChannel.orientationDeg).toFixed(1)}°</span></div> : ghostVariant ? <div className="variant-comparison"><strong>{variant.name} versus {ghostVariant.name}</strong><span>Select a channel present in both variants to compare editable values.</span></div> : null}
            {bottomTab === "channels" ? <table className="channel-table"><thead><tr><th style={{ width: "22%" }}>Structure / channel</th><th style={{ width: "7%" }}>Bone</th><th style={{ width: "15%" }}>Technique</th><th style={{ width: "17%" }}>Cutter / exact size</th><th style={{ width: "8%" }}>Depth</th><th style={{ width: "13%" }}>Fixation</th><th style={{ width: "10%" }}>Status</th><th style={{ width: "8%" }}>Worst clearance</th></tr></thead><tbody>{variant.channels.map((channel) => {
              const procedure = plan.procedures.find((item) => item.id === channel.procedureId);
              const worst = signedWorstFor(channel.id, analysisResults);
              return <tr key={channel.id} className={selectedChannelId === channel.id ? "selected" : ""} onClick={() => selectChannelForEditing(channel.id)}><td className="channel-cell">{channel.label}</td><td>{channel.bone}</td><td>{procedure?.techniqueName ?? "Custom"}</td><td className={channel.instrumentChain.cutterInstrumentId ? "" : "unresolved"}>{channel.instrumentChain.cutterInstrumentId ?? "Selection required"} · {channel.instrumentChain.exactSizeOrProfileId ?? "—"}</td><td>{channel.depthMm === null ? "—" : `${channel.depthMm.toFixed(1)} mm`}</td><td className={channel.instrumentChain.fixationImplantIds.length ? "" : "unresolved"}>{channel.instrumentChain.fixationImplantIds[0] ?? "Selection required"}</td><td><span className={`pill ${channel.instrumentChain.completionState === "complete" ? "ok" : "warn"}`}>{channel.instrumentChain.completionState}</span></td><td className={worst !== null && worst <= 0 ? "negative" : ""}>{worst === null ? "N/E" : `${worst.toFixed(2)} mm`}</td></tr>;
            })}</tbody></table> : <div className="sequence-list">{variant.sequence.map((step, index) => <SequenceRow key={step.id} step={step} index={index} onSelect={() => step.channelId && selectChannelForEditing(step.channelId)} onDragStart={() => setDragStep(index)} onDrop={() => { if (dragStep !== null) commit((current) => reorderSequence(current, dragStep, index), "Reordered sequence"); setDragStep(null); }} />)}</div>}
          </div> : null}
        </section>
      </main>

      {showImport ? <ImportDialog
        sources={sources}
        anatomy={plan.anatomy}
        review={imagingReview}
        onReview={updateImagingReview}
        inputRef={fileInputRef}
        segmentationInputRef={segmentationInputRef}
        segmentationUi={segmentationUi}
        onFiles={importFiles}
        onSegmentationSource={selectMatSegmentationSource}
        onRunSegmentation={() => void runMatSegmentation()}
        onStopSegmentation={stopWaitingForSegmentation}
        onClose={() => setShowImport(false)}
      /> : null}
      {showExport ? <ExportDialog selectedChannelLabel={selectedChannel?.label ?? null} onClose={() => setShowExport(false)} onJson={() => downloadText("multilig-plan.deidentified.json", planToJson(planWithAnalysis), "application/json")} onCsv={() => downloadText("multilig-channels.csv", channelsToCsv(planWithAnalysis), "text/csv")} onReport={() => downloadText("multilig-plan-report.md", createHumanReadableReport(planWithAnalysis), "text/markdown")} onObj={exportObj} onScreenshot={() => {
        if (!selectedChannel) {
          showToast("Select a channel before exporting its screenshot.");
          return;
        }
        setScreenshotRequest((current) => ({ channelId: selectedChannel.id, nonce: (current?.nonce ?? 0) + 1 }));
      }} /> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function ChainSelect({ label, value, options, onChange }: { label: string; value: string | null; options: readonly (readonly [string, string])[]; onChange: (value: string | null) => void }) {
  return <><div className="chain-node"><span className={`chain-dot ${value ? "set" : ""}`} /><select className={`chain-select ${value ? "" : "incomplete"}`} aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}><option value="">{label} — selection required…</option>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div><div className="chain-line" /></>;
}

function parseProfilePoints(value: string): Array<[number, number]> {
  return value
    .split(/[;\n]+/)
    .map((row) => row.trim().split(/[\s,]+/).map(Number))
    .filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map(([x, y]) => [x, y]);
}

function profilePointsText(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y]) => `${x}, ${y}`).join("\n");
}

function CrossSectionFields({ channel, onCommit }: { channel: ChannelPlan; onCommit: (crossSection: CrossSection) => void }) {
  const cross = channel.crossSection;
  const numeric = (label: string, value: number | null, set: (value: number | null) => CrossSection) => <Field label={label}><div className="input-with-unit"><input type="number" step="0.5" value={value ?? ""} onChange={(event) => onCommit(set(event.target.value === "" ? null : Number(event.target.value)))} /><span className="input-unit">mm</span></div></Field>;
  if (cross.kind === "ellipse") return <div className="geometry-grid">{numeric("Major", cross.majorMm, (value) => ({ ...cross, majorMm: value }))}{numeric("Minor", cross.minorMm, (value) => ({ ...cross, minorMm: value }))}</div>;
  if (cross.kind === "stadium" || cross.kind === "rectangle") return <div className="geometry-grid">{numeric("Width", cross.widthMm, (value) => ({ ...cross, widthMm: value }))}{numeric("Height", cross.heightMm, (value) => ({ ...cross, heightMm: value }))}</div>;
  if (cross.kind === "rounded_rectangle") return <div className="geometry-grid">{numeric("Width", cross.widthMm, (value) => ({ ...cross, widthMm: value }))}{numeric("Height", cross.heightMm, (value) => ({ ...cross, heightMm: value }))}{numeric("Corner radius", cross.cornerRadiusMm, (value) => ({ ...cross, cornerRadiusMm: value }))}</div>;
  if (cross.kind === "c_profile") return <div className="geometry-grid">{numeric("Outer radius", cross.outerRadiusMm, (value) => ({ ...cross, outerRadiusMm: value }))}{numeric("Inner radius", cross.innerRadiusMm, (value) => ({ ...cross, innerRadiusMm: value }))}<Field label="Opening"><div className="input-with-unit"><input type="number" value={cross.openingDeg ?? ""} onChange={(event) => onCommit({ ...cross, openingDeg: event.target.value === "" ? null : Number(event.target.value) })} /><span className="input-unit">°</span></div></Field></div>;
  if (cross.kind === "slot_ribbon") return <div className="geometry-grid">{numeric("Width", cross.widthMm, (value) => ({ ...cross, widthMm: value }))}{numeric("Thickness", cross.thicknessMm, (value) => ({ ...cross, thicknessMm: value }))}</div>;
  if (cross.kind === "polygon") return <div className="geometry-grid full-width"><Field label="Polygon vertices (mm · x,y per line)"><textarea aria-label="Polygon profile vertices in millimeters" value={profilePointsText(cross.pointsMm)} placeholder={"-4, -2\n4, -2\n4, 2\n-4, 2"} onChange={(event) => onCommit({ ...cross, pointsMm: parseProfilePoints(event.target.value) })} /></Field><div className="field-hint">At least three clinician-entered or measured vertices are required. Source order is preserved.</div></div>;
  if (cross.kind === "imported_profile") return <div className="geometry-grid full-width">
    <Field label="Immutable profile asset ID"><input aria-label="Imported profile asset ID" value={cross.assetId} placeholder="Source asset identifier required" onChange={(event) => onCommit({ ...cross, assetId: event.target.value })} /></Field>
    <Field label="Scale"><div className="input-with-unit"><input aria-label="Imported profile scale millimeters per unit" type="number" min="0" step="0.001" value={cross.scaleMmPerUnit ?? ""} onChange={(event) => onCommit({ ...cross, scaleMmPerUnit: event.target.value === "" ? null : Number(event.target.value) })} /><span className="input-unit">mm/u</span></div></Field>
    <Field label="Source-space outline (x,y per line)"><textarea aria-label="Imported profile source-space outline" value={profilePointsText(cross.pointsSourceUnits)} placeholder={"0, 0\n1, 0\n1, 1\n0, 1"} onChange={(event) => onCommit({ ...cross, pointsSourceUnits: parseProfilePoints(event.target.value) })} /></Field>
    <div className="missing-banner"><strong>Import boundary</strong>Geometry evaluates only after an immutable asset ID, positive verified scale, and at least three source outline points are present.</div>
  </div>;
  return null;
}

function GeometryDimensionFields({ channel, onCommit }: { channel: ChannelPlan; onCommit: (key: string, value: number | null) => void }) {
  const fields = GEOMETRY_DIMENSION_FIELDS[channel.geometryType] ?? [];
  if (!fields.length) return null;
  return <div className="geometry-grid" style={{ marginTop: 7 }}>{fields.map(([key, label, unit]) => <Field key={key} label={label}><div className="input-with-unit"><input aria-label={label} type="number" min="0" step={unit === "deg" ? "1" : "0.5"} value={channel.dimensionsMm?.[key] ?? ""} onChange={(event) => onCommit(key, event.target.value === "" ? null : Number(event.target.value))} /><span className="input-unit">{unit === "deg" ? "°" : "mm"}</span></div></Field>)}</div>;
}

function SequenceRow({ step, index, onSelect, onDragStart, onDrop }: { step: SequenceStep; index: number; onSelect: () => void; onDragStart: () => void; onDrop: () => void }) {
  return <div className="sequence-step" draggable onDragStart={onDragStart} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} onClick={onSelect}><span className="drag-grip">••</span><span className="step-number">{index + 1}</span><div><div className="step-label">{step.label}</div><div className="step-kind">{step.kind.replaceAll("_", " ")}</div></div><span className={`pill ${step.kind === "inspect" ? "info" : ""}`}>{step.completed ? "done" : "planned"}</span></div>;
}

export function ImportDialog({
  sources,
  anatomy,
  review,
  onReview,
  inputRef,
  segmentationInputRef,
  segmentationUi,
  onFiles,
  onSegmentationSource,
  onRunSegmentation,
  onStopSegmentation,
  onClose,
}: {
  sources: ImmutableImagingSource[];
  anatomy: PlanCase["anatomy"];
  review: ImagingReviewState;
  onReview: React.Dispatch<React.SetStateAction<ImagingReviewState>>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  segmentationInputRef: React.RefObject<HTMLInputElement | null>;
  segmentationUi: SegmentationUiState;
  onFiles: (files: FileList | null) => void;
  onSegmentationSource: (files: FileList | null) => void;
  onRunSegmentation: () => void;
  onStopSegmentation: () => void;
  onClose: () => void;
}) {
  const transformMetadataReady = sources.length > 0 && sources.every((source) => source.spacingMm && source.orientation && source.transformIds.length > 0);
  const representedBones = new Set([
    ...sources.map((source) => source.boneIdentity),
    ...anatomy.flatMap((object) => ["femur", "tibia", "fibula", "patella"].includes(object.kind) ? [object.kind] : []),
  ]);
  const separateBonesReady = ["femur", "tibia", "fibula"].every((bone) => representedBones.has(bone as ImmutableImagingSource["boneIdentity"]));
  return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Import imaging and segmentation"><div className="dialog"><div className="dialog-header"><div className="dialog-title">Case imaging &amp; segmentation review</div><div className="dialog-copy">Accepts DICOM MRI, NIfTI, immutable label maps, and surface meshes. No unvalidated segmentation inference is presented as clinical.</div></div><div className="dialog-body">
    <input ref={inputRef} hidden multiple type="file" accept=".dcm,.dicom,.nii,.nii.gz,.nrrd,.mha,.mhd,.seg,.stl,.obj,.ply" onChange={(event) => void onFiles(event.target.files)} />
    <button className="import-drop" style={{ width: "100%" }} onClick={() => inputRef.current?.click()}><strong>Import existing segmentation or geometry</strong>DICOM · NIfTI · immutable label map · STL · OBJ · PLY</button>
    <input ref={segmentationInputRef} hidden type="file" accept=".tar.gz,.tgz,.nii,.nii.gz" onChange={(event) => { onSegmentationSource(event.target.files); event.currentTarget.value = ""; }} />
    <div className="segmentation-card">
      <div className="segmentation-card-header"><div><strong>MAT Planner nnUNetv2</strong><span>Local research-only bone segmentation</span></div><span className={`pill ${segmentationUi.status === "failed" ? "conflict" : segmentationUi.status === "completed" ? "ok" : "warn"}`}>{segmentationUi.status.replaceAll("_", " ")}</span></div>
      <div className="dialog-copy">Uses MAT Planner's existing Python environment, registry, full-resolution model, fold, and checkpoint. It predicts femur and tibia; the current MAT model does not predict fibula.</div>
      <div className="segmentation-progress" aria-label="Segmentation progress"><span style={{ width: `${Math.round(segmentationUi.progress * 100)}%` }} /></div>
      <div className="segmentation-message">{segmentationUi.message}</div>
      <div className="segmentation-actions">
        <button className="secondary-btn" disabled={["checking", "uploading", "running"].includes(segmentationUi.status)} onClick={() => segmentationInputRef.current?.click()}>Choose MRI archive / NIfTI</button>
        <button className="primary-btn" disabled={!segmentationUi.file || !["selected", "failed"].includes(segmentationUi.status)} onClick={onRunSegmentation}>Run research segmentation</button>
        {["checking", "uploading", "running"].includes(segmentationUi.status) ? <button className="secondary-btn" onClick={onStopSegmentation}>Stop waiting</button> : null}
      </div>
      {segmentationUi.jobId ? <div className="field-hint">Opaque local job: {segmentationUi.jobId}</div> : null}
    </div>
    {sources.length ? <div style={{ marginTop: 10 }}>{sources.map((source) => <div className="procedure-row" key={source.id}><span className="procedure-color" style={{ background: source.boneIdentity === "unknown" ? "#f2b84b" : "#45d1c5" }} /><div><div className="procedure-name">{source.fileName}</div><div className="procedure-technique">{source.format} · {source.boneIdentity} · immutable SHA-256 {source.sha256.slice(0, 12)}…</div></div><span className="pill">source</span></div>)}</div> : null}
    <div className="inspector-section" style={{ marginTop: 10 }}><div className="inspector-section-title">Required review gates</div><div className="inspector-section-body">
      <Field label="Laterality"><select value={review.laterality} onChange={(event) => onReview((current) => ({ ...current, laterality: event.target.value as ImagingReviewState["laterality"] }))}><option value="unverified">Unverified</option><option value="left">Left · clinician verified</option><option value="right">Right · clinician verified</option></select></Field>
      <label className="checkbox-row"><input type="checkbox" disabled={!transformMetadataReady} checked={review.scaleVerified} onChange={(event) => onReview((current) => ({ ...current, scaleVerified: event.target.checked }))} /> Scale verified in millimeters</label>
      <label className="checkbox-row"><input type="checkbox" disabled={!transformMetadataReady} checked={review.orientationVerified} onChange={(event) => onReview((current) => ({ ...current, orientationVerified: event.target.checked }))} /> Orientation and reversible transforms verified</label>
      <label className="checkbox-row"><input type="checkbox" disabled={!separateBonesReady} checked={review.boneIdentitiesVerified} onChange={(event) => onReview((current) => ({ ...current, boneIdentitiesVerified: event.target.checked }))} /> Femur, tibia, and fibula identified separately</label>
      {!transformMetadataReady ? <div className="missing-banner"><strong>Metadata adapter required</strong>Spacing, source orientation, and transform records are unresolved; scale/orientation verification is disabled.</div> : null}
      {!separateBonesReady ? <div className="missing-banner"><strong>Separate bone objects required</strong>Reviewed femur, tibia, and fibula sources have not all been registered.</div> : null}
    </div></div>
    <div className="missing-banner"><strong>Clinical boundary</strong>Source label maps remain immutable. Manual corrections and mesh-quality review are separate provenance records. Missing danger anatomy remains not evaluated.</div>
  </div><div className="dialog-actions"><button className="secondary-btn" onClick={onClose}>Close review</button></div></div></div>;
}

function ExportDialog({ selectedChannelLabel, onClose, onJson, onCsv, onReport, onObj, onScreenshot }: { selectedChannelLabel: string | null; onClose: () => void; onJson: () => void; onCsv: () => void; onReport: () => void; onObj: () => void; onScreenshot: () => void }) {
  const exportAndClose = (action: () => void) => { action(); onClose(); };
  return <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="Export plan"><div className="dialog" style={{ width: 500 }}><div className="dialog-header"><div className="dialog-title">Export reproducible, de-identified plan</div><div className="dialog-copy">The JSON is the complete machine-readable record; the report and CSV are scoped views. Planned meshes include a versioned manifest. Nothing is labeled a patient-specific surgical guide.</div></div><div className="dialog-body"><div className="technique-picker"><button className="technique-option" onClick={() => exportAndClose(onJson)}><strong>Versioned plan JSON</strong><span>Coordinate frames, imaging provenance, procedures, channels, exact chains and catalog records, sequence, audit, warnings, and analysis.</span></button><button className="technique-option" onClick={() => exportAndClose(onCsv)}><strong>Per-channel CSV</strong><span>Geometry, every chain stage, sources, verification state, and warnings.</span></button><button className="technique-option" onClick={() => exportAndClose(onReport)}><strong>Human-readable report</strong><span>De-identified Markdown plan report with computed and not-evaluated items.</span></button><button className="technique-option" onClick={() => exportAndClose(onObj)}><strong>Planned-volume OBJ + manifest</strong><span>Renderable volumes in patient RAS millimeters plus incomplete-geometry/version metadata.</span></button><button className="technique-option" disabled={!selectedChannelLabel} onClick={() => exportAndClose(onScreenshot)}><strong>Selected-channel PNG</strong><span>{selectedChannelLabel ? `${selectedChannelLabel} isolated against visible anatomy in the current Viewer v2 camera.` : "Select a channel to export its scoped screenshot."}</span></button></div><div className="missing-banner" style={{ marginTop: 10 }}><strong>Planning only</strong>Not for autonomous navigation and not a patient-specific surgical guide. Identifying export is unavailable.</div></div><div className="dialog-actions"><button className="secondary-btn" onClick={onClose}>Cancel</button></div></div></div>;
}

export default App;
