/**
 * Persisted planning-domain contracts.
 *
 * All distances are millimetres and all persisted spatial transforms map into
 * patient RAS millimetres.  Product documentation is descriptive catalog data;
 * it is not an approval, availability, recommendation, or compatibility claim.
 */

export type UUID = string;
export type ISODateTime = string;
export type Millimeters = number;
export type Degrees = number;
export type Vector2 = readonly [number, number];
export type Vector3 = readonly [number, number, number];

/** Row-major homogeneous 4 x 4 matrix. */
export type Matrix4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type Laterality = "left" | "right";
export type Bone = "femur" | "tibia" | "fibula" | "patella" | "custom";
export type ProcedureIdentity =
  | "ACL"
  | "PCL"
  | "PLC_FCL"
  | "MCL_POL_PMC"
  | "ALL"
  | "LET"
  | "MEDIAL_ROOT"
  | "LATERAL_ROOT"
  | "CUSTOM";

export type CoordinateFrameKind =
  | "dicom_patient"
  | "voxel"
  | "label_map"
  | "segmentation"
  | "mesh"
  | "viewer_world"
  | "bone_local";

export interface CoordinateFrame {
  id: UUID;
  kind: CoordinateFrameKind;
  name: string;
  units: "mm";
  /** Original convention before conversion into patient RAS. */
  sourceConvention: "RAS" | "LPS" | "IJK" | "MODEL_LOCAL" | "VIEWER_WORLD";
  /** Maps a homogeneous point in this frame into patient RAS millimetres. */
  transformToPatientRas: Matrix4;
  source: string;
  verifiedBy?: string;
  verifiedAt?: ISODateTime;
  scaleVerified: boolean;
}

export type ImagingSourceKind = "dicom_mri" | "nifti" | "label_map" | "surface_mesh";

export interface SegmentationProvenance {
  sourceKind: ImagingSourceKind;
  sourceAssetIds: UUID[];
  sourceLabelMapAssetId?: UUID;
  /** Source label maps remain immutable; corrections are separate assets. */
  immutableSource: true;
  correctionAssetIds: UUID[];
  method: "imported" | "manual" | "service_adapter" | "mock_adapter";
  algorithmName?: string;
  algorithmVersion?: string;
  reviewedBy?: string;
  reviewedAt?: ISODateTime;
  notes?: string;
}

export interface MeshQuality {
  manifold: boolean | null;
  watertight: boolean | null;
  triangleCount: number | null;
  minimumEdgeLengthMm: Millimeters | null;
  warnings: string[];
}

export type AnatomyKind =
  | "femur"
  | "tibia"
  | "fibula"
  | "patella"
  | "cartilage"
  | "physis"
  | "danger_region"
  | "previous_tunnel"
  | "previous_hardware"
  | "osteotomy_hardware"
  | "custom";

export interface AnatomyObject {
  id: UUID;
  label: string;
  kind: AnatomyKind;
  sourceVolumeId?: UUID;
  labelMapId?: UUID;
  meshAssetId: UUID;
  coordinateFrameId: UUID;
  segmentationProvenance: SegmentationProvenance;
  quality: MeshQuality;
  reviewStatus: "unreviewed" | "needs_correction" | "approved";
  visible: boolean;
}

export interface Footprint {
  id: UUID;
  procedureId: UUID;
  label: string;
  bone: Bone;
  centerPatientRasMm: Vector3;
  normalPatientRas: Vector3;
  outlinePatientRasMm?: Vector3[];
  provenance: "preset_assumption" | "landmark_derived" | "manual" | "imported";
  verifiedByUser: boolean;
}

/**
 * Deterministic attachment of a channel handle to a patient-space anatomy
 * mesh.  The attachment records the exact triangle result, not merely the
 * snapped coordinate, so save/reload can preserve and audit the tether.
 *
 * A whole-bone projection must never be represented as a reviewed anatomic
 * subregion. The user-defined tibial superior envelope is likewise a derived
 * placement rule, not a clinician-reviewed articular-surface annotation.
 */
export type ChannelSurfaceTargetKind =
  | "whole_bone_surface"
  | "tibial_superior_envelope"
  | "tibial_plateau_region";

export type ChannelSurfaceReviewState =
  | "surface_review_not_evaluated"
  | "user_defined_not_clinician_approved"
  | "approved";

export interface ChannelSurfaceAttachment {
  coordinateSpace: "patient_ras";
  units: "mm";
  bone: Bone;
  targetKind: ChannelSurfaceTargetKind;
  /** Required for a future reviewed subregion; null for whole-bone tethers. */
  targetRegionId: UUID | null;
  meshId: UUID;
  requestedPointPatientRasMm: Vector3;
  attachedPointPatientRasMm: Vector3;
  distanceFromRequestedPointMm: Millimeters;
  /** Stable triangle/face identity within the immutable mesh artifact. */
  triangleStableId: string;
  faceStableId: string;
  faceIndex: number;
  vertexIndices: readonly [number, number, number];
  vertexStableIds: readonly [string, string, string];
  barycentric: readonly [number, number, number];
  surfaceNormalPatientRas: Vector3;
  reviewState: ChannelSurfaceReviewState;
  /** Present for the user-defined superior-envelope rule; never implies reviewed anatomy. */
  constraintProvenance?: {
    rule: "maximum_patient_ras_z_at_requested_xy";
    ruleVersion: "1";
    sourceGeometryRole: "viewer_display_surface";
    resolution: "vertical_intersection" | "nearest_xy_fallback";
    xyFallbackDistanceMm: Millimeters;
  };
}

export interface ChannelSurfacePlacement {
  /** Pending defaults are evaluated only when the declared bone mesh exists. */
  state: "pending_default" | "default_applied" | "clinician_edited";
  method:
    | "preset_seed_unregistered"
    | "migration_pending"
    | "nearest_bone_surface"
    | "tibial_superior_envelope"
    | "manual_surface_drag"
    | "manual_trajectory_drag"
    | "manual_numeric_edit";
  meshIds: UUID[];
  endpointMethod:
    | "opposite_surface_intersection"
    | "nearest_surface_projection"
    | "blind_socket_tip"
    | "preserved_depth"
    | "not_available";
}

export type TrajectoryControlMode =
  | "outer_cortex_surface"
  | "blind_socket_tip"
  | "exterior_rod"
  | "none";

export interface GuidePinPlan {
  /** Planned guide-pin diameter in millimetres; null means geometry-critical data is absent. */
  diameterMm: Millimeters | null;
  provenance:
    | "generic_parametric_visual_seed"
    | "clinician_entered_planning_value"
    | "catalog_resolved";
}

export type CenterlineDefinition =
  | {
      kind: "rigid";
      aperturePatientRasMm: Vector3;
      directionPatientRas: Vector3;
    }
  | {
      kind: "flexible";
      aperturePatientRasMm: Vector3;
      intraosseousDirectionPatientRas: Vector3;
      accessControlPointsPatientRasMm: Vector3[];
      minimumBendRadiusMm: Millimeters | null;
    }
  | {
      kind: "polyline";
      pointsPatientRasMm: Vector3[];
    };

export type CrossSection =
  | { kind: "circle"; diameterMm: Millimeters | null }
  | { kind: "ellipse"; majorMm: Millimeters | null; minorMm: Millimeters | null; rotationDeg: Degrees }
  | { kind: "stadium"; widthMm: Millimeters | null; heightMm: Millimeters | null; rotationDeg: Degrees }
  | { kind: "rectangle"; widthMm: Millimeters | null; heightMm: Millimeters | null; rotationDeg: Degrees }
  | {
      kind: "rounded_rectangle";
      widthMm: Millimeters | null;
      heightMm: Millimeters | null;
      cornerRadiusMm: Millimeters | null;
      rotationDeg: Degrees;
    }
  | {
      kind: "c_profile";
      outerRadiusMm: Millimeters | null;
      innerRadiusMm: Millimeters | null;
      openingDeg: Degrees | null;
      rotationDeg: Degrees;
    }
  | { kind: "slot_ribbon"; widthMm: Millimeters | null; thicknessMm: Millimeters | null; rotationDeg: Degrees }
  | { kind: "polygon"; pointsMm: Vector2[]; rotationDeg: Degrees }
  | {
      kind: "imported_profile";
      assetId: UUID;
      scaleMmPerUnit: number | null;
      /** Immutable source-space outline; converted to millimetres deterministically. */
      pointsSourceUnits: Vector2[];
      rotationDeg: Degrees;
    };

export type GeometryType =
  | "rigid_pin"
  | "flexible_pin"
  | "round_full_tunnel"
  | "antegrade_blind_socket"
  | "retrograde_socket"
  | "stepped_button_tunnel"
  | "flexible_reamed_socket"
  | "noncircular_tunnel"
  | "overlapping_holes_dilator"
  | "sequential_dilated_tunnel"
  | "coring_trephine"
  | "anchor_pilot"
  | "interference_fixation"
  | "cortical_button_plate"
  | "post_washer_staple"
  | "pcl_inlay_trough"
  | "chamfer_notch_keyhole"
  | "onlay_no_large_tunnel"
  | "custom";

export type GeometryLayerKind =
  | "bone_removal_or_compaction"
  | "pin_tract_and_overshoot"
  | "instrument_access_swept_volume"
  | "cutter_deployment_retraction"
  | "graft_or_bone_block"
  | "retained_fixation"
  | "surface_hardware_flip_deployment"
  | "safety_margin";

export interface GeometryLayer {
  id: UUID;
  channelId: UUID;
  kind: GeometryLayerKind;
  label: string;
  geometryRecipeId?: UUID;
  meshAssetId?: UUID;
  visible: boolean;
  analyzable: boolean;
  geometryHash?: string;
  geometryGeneratorVersion: string;
  missingParameters: string[];
}

export type CatalogStatus =
  | "manufacturer_documented"
  | "region_ifu_check_required"
  | "legacy_or_transition_unclear"
  | "institution_defined"
  | "generic_parametric"
  | "retired_by_institution";

export interface CatalogSource {
  id: UUID;
  title: string;
  publisher: string;
  url?: string;
  documentNumber?: string;
  publishedAt?: string;
  checkedAt: string;
  marketOrRegion: string;
  status: CatalogStatus;
}

export interface Manufacturer {
  id: UUID;
  name: string;
  aliases: string[];
  status: CatalogStatus;
  sourceIds: UUID[];
}

export type ProductFamilyCategory =
  | "guide_system"
  | "pin"
  | "rigid_cutter"
  | "flexible_cutter"
  | "retrograde_cutter"
  | "coring_cutter"
  | "dilator_compactor"
  | "root_system"
  | "cortical_fixation"
  | "interference_fixation"
  | "anchor"
  | "post_washer_staple"
  | "trough_instrument"
  | "tray_system"
  | "parametric";

export interface ProductFamily {
  id: UUID;
  manufacturerId: UUID;
  name: string;
  category: ProductFamilyCategory;
  description: string;
  status: CatalogStatus;
  sourceIds: UUID[];
  geometryRecipeIds: UUID[];
}

export interface ProductVariant {
  id: UUID;
  familyId: UUID;
  name: string;
  sku: string | null;
  status: CatalogStatus;
  dimensionsMm: Record<string, Millimeters | null>;
  selectableSizesMm: Millimeters[] | null;
  settings: Record<string, string | number | boolean | null>;
  sourceIds: UUID[];
  geometryRecipeId: UUID | null;
}

export type InstrumentKind =
  | "guide"
  | "hook_arm"
  | "sleeve_bullet"
  | "depth_stop"
  | "pin"
  | "drill"
  | "reamer"
  | "cutter"
  | "dilator"
  | "punch"
  | "tap"
  | "trephine"
  | "saw_burr_osteotome"
  | "driver";

export interface Instrument {
  id: UUID;
  familyId: UUID;
  variantId?: UUID;
  name: string;
  kind: InstrumentKind;
  sku: string | null;
  side: Laterality | "universal" | null;
  dimensionsMm: Record<string, Millimeters | null>;
  selectableSizesMm: Millimeters[] | null;
  settings?: Record<string, string | number | boolean | null>;
  status: CatalogStatus;
  sourceIds: UUID[];
  geometryRecipeId: UUID | null;
}

export type GeometryRecipeClass =
  | "rigid_pin"
  | "flexible_pin"
  | "full_thickness_cutter"
  | "headed_reamer"
  | "flexible_reamer"
  | "adjustable_retrograde_reamer"
  | "fixed_retrograde_reamer"
  | "antegrade_retrograde_hybrid"
  | "stepped_button_tunnel"
  | "sequential_dilator"
  | "coring_trephine"
  | "overlapping_drills_dilator"
  | "shape_specific_tunnel"
  | "anchor_pilot"
  | "interference_screw_sheath"
  | "cortical_button_plate"
  | "post_washer_staple"
  | "pcl_inlay_trough"
  | "chamfer_notch"
  | "no_bone_removal_onlay";

export interface GeometryRecipe {
  id: UUID;
  version: number;
  class: GeometryRecipeClass;
  requiredParameters: string[];
  boneVolumeGenerator?: string;
  pinVolumeGenerator?: string;
  accessEnvelopeGenerator?: string;
  deploymentEnvelopeGenerator?: string;
  implantVolumeGenerator?: string;
  sourceIds: UUID[];
  status: CatalogStatus;
}

export interface CompatibilityEdge {
  id: UUID;
  fromId: UUID;
  toId: UUID;
  relationship: "compatible" | "requires" | "excludes" | "unverified";
  rationale: string;
  sourceIds: UUID[];
  marketOrRegion: string;
}

export interface RegionAvailability {
  id: UUID;
  catalogItemId: UUID;
  marketOrRegion: string;
  status: "unverified" | "documented" | "institution_confirmed" | "unavailable";
  checkedAt: string;
  sourceIds: UUID[];
  verifiedBy?: string;
}

export interface RegionInstitutionSet {
  id: UUID;
  label: string;
  marketOrRegion: string;
  status: CatalogStatus;
  checkedAt: string;
  sourceIds: UUID[];
}

export interface InstitutionOverride {
  id: UUID;
  institutionId: UUID;
  catalogItemId: UUID;
  localName?: string;
  localCatalogNumber?: string;
  dimensionOverridesMm: Record<string, Millimeters | null>;
  attachmentIds: UUID[];
  verifiedBy: string;
  verifiedAt: ISODateTime;
  retiredAt?: ISODateTime;
  status: "institution_defined" | "retired_by_institution";
}

export interface CatalogVersion {
  id: UUID;
  version: string;
  createdAt: ISODateTime;
  checkedAt: string;
  marketOrRegion: string;
  sourceIds: UUID[];
  manufacturerIds: UUID[];
  immutable: true;
}

export interface InstrumentChain {
  id: UUID;
  /** Region/institution catalog set is the first explicit selection. */
  regionInstitutionSetId: UUID | null;
  marketOrRegion: string | null;
  manufacturerId: UUID | null;
  productFamilyId: UUID | null;
  productVariantId: UUID | null;
  guideInstrumentId: UUID | null;
  guideSide: Laterality | "universal" | null;
  hookArmOffsetAngle: {
    hookOrArmId: UUID | null;
    offsetMm: Millimeters | null;
    angleDeg: Degrees | null;
  };
  sleeveBulletDepthStop: {
    sleeveOrBulletId: UUID | null;
    depthStopMm: Millimeters | null;
  };
  pinInstrumentId: UUID | null;
  cutterInstrumentId: UUID | null;
  exactSizeOrProfileId: UUID | null;
  depthOrFullTunnelSetting: {
    mode: "depth" | "full_tunnel" | null;
    depthMm: Millimeters | null;
  };
  graftSelectionId: UUID | null;
  fixationImplantIds: UUID[];
  fixationPreparationInstrumentIds: UUID[];
  sourceIds: UUID[];
  catalogVersion: string;
  userVerified: boolean;
  verification: {
    verifiedAt: ISODateTime;
    verifiedBy: string;
    selectionHash: string;
    catalogVersion: string;
    marketOrRegion: string;
    sourceIds: UUID[];
  } | null;
  completionState: "incomplete" | "complete" | "warning" | "incompatible";
  missingSelections: string[];
}

export interface GraftPlan {
  id: UUID;
  type: string | null;
  preparation: string | null;
  diameterMm: Millimeters | null;
  dimensionsMm: Record<string, Millimeters | null>;
  source: "clinician_selected" | "measured" | "imported" | null;
  verifiedByUser: boolean;
}

export interface FixationPlan {
  id: UUID;
  role: "femoral" | "tibial" | "fibular" | "surface" | "other";
  productVariantId: UUID | null;
  preparationInstrumentIds: UUID[];
  positionPatientRasMm?: Vector3;
  orientationPatientRas?: Vector3;
  verifiedByUser: boolean;
}

export interface GenericSeedRange {
  diameterMm?: readonly [Millimeters, Millimeters];
  depthMm?: readonly [Millimeters, Millimeters];
  widthMm?: readonly [Millimeters, Millimeters];
  heightMm?: readonly [Millimeters, Millimeters];
  pilotDiameterMm?: readonly [Millimeters, Millimeters];
  socketDiameterMm?: readonly [Millimeters, Millimeters];
  socketDepthMm?: readonly [Millimeters, Millimeters];
  note?: string;
}

export interface ChannelPlan {
  id: UUID;
  /**
   * Stable identity of the data-driven technique seed within its procedure.
   * Older plan documents may omit this; replacement flows then fall back to
   * bone/bundle/order matching without changing the saved clinical geometry.
   */
  semanticKey?: string;
  label: string;
  procedureId: UUID;
  constructId?: UUID;
  bone: Bone;
  geometryType: GeometryType;
  hardwareSubtype?: "post_washer" | "staple";
  crossSection: CrossSection;
  aperture: Vector3;
  vector: Vector3;
  centerline: CenterlineDefinition;
  /** Optional for backward-compatible loading of plans saved before tethers. */
  apertureSurfaceAttachment?: ChannelSurfaceAttachment | null;
  /**
   * A persisted outer-cortex Start reached by the forward trajectory ray.
   * Blind ipsilateral socket-tip and anchor exterior-rod controls deliberately
   * leave this null. Blind sockets derive their deep Start analytically; anchor
   * Starts use `apertureSurfaceAttachment` and the rod is trajectory-only.
   */
  endpointSurfaceAttachment?: ChannelSurfaceAttachment | null;
  /**
   * Defines the Viewer trajectory-control convention. Optional only for
   * loading plans written before schema 1.7; normalization makes it explicit.
   */
  trajectoryControlMode?: TrajectoryControlMode;
  /**
   * Independent coaxial guide-pin plan. A generic value is presentation-only
   * and never completes or verifies an exact instrument chain.
   */
  guidePin?: GuidePinPlan | null;
  /** One-time default placement provenance; prevents reload from re-snapping manual edits. */
  surfacePlacement?: ChannelSurfacePlacement;
  depthMm: Millimeters | null;
  diameterMm?: Millimeters;
  dimensionsMm?: Record<string, Millimeters>;
  orientationDeg: Degrees;
  fullThickness: boolean;
  preparationMode: "cut" | "dilate_compact" | "core" | "punch" | "tap" | "none" | "custom";
  /**
   * Legacy nullable geometry input retained so older plan documents can be
   * parsed and explicitly migrated. New channel presets and cases leave this
   * null; the planning workspace does not seed a tip extension.
   */
  tipOvershootMm: Millimeters | null;
  noLargeTunnel: boolean;
  genericSeed: GenericSeedRange;
  instrumentChain: InstrumentChain;
  graft: GraftPlan | null;
  fixation: FixationPlan[];
  layers: GeometryLayer[];
  intentionalRelationshipIds: UUID[];
  verificationState: "unverified" | "needs_dimensions" | "needs_instrument_chain" | "clinician_verified";
  warnings: string[];
}

export interface IntentionalRelationship {
  id: UUID;
  kind: "shared_channel" | "coalesced" | "shared_fixation" | "graft_passes_beneath" | "other";
  objectIds: UUID[];
  rationale: string;
  createdBy: string;
  createdAt: ISODateTime;
  verifiedByUser: boolean;
}

export interface Construct {
  id: UUID;
  procedureId: UUID;
  name: string;
  bundle?: string;
  footprintIds: UUID[];
  channelIds: UUID[];
  graftId?: UUID;
  relationshipIds: UUID[];
}

export interface ProcedureInstance {
  id: UUID;
  structure: ProcedureIdentity;
  techniquePresetId: string;
  techniqueName: string;
  presetVersion: number;
  citation?: string;
  constructs: Construct[];
  footprints: Footprint[];
  notes?: string;
  createdAt: ISODateTime;
}

export interface AnalysisResult {
  id: UUID;
  planVariantId: UUID;
  objectAId: UUID;
  objectBId: UUID;
  signedClearanceMm: Millimeters | null;
  state: "conflict" | "below_threshold" | "clear" | "intentional_shared" | "not_evaluated";
  closestPointA?: Vector3;
  closestPointB?: Vector3;
  thresholdMm?: Millimeters;
  thresholdSource?: "user" | "institution" | "informational";
  evaluationState?: "evaluated" | "missing_dimensions" | "missing_geometry" | "missing_anatomy";
  missingRequirements?: string[];
  nearestLayerAId?: UUID | null;
  nearestLayerBId?: UUID | null;
  conservative?: boolean;
  explanation: string;
  geometryHashes: string[];
  evaluatedAt: ISODateTime;
}

export interface SequenceStep {
  id: UUID;
  channelId?: UUID;
  kind: "pin" | "inspect" | "ream" | "graft_pass" | "fixation" | "custom";
  label: string;
  order: number;
  completed: boolean;
  notes?: string;
}

export interface AuditEvent {
  id: UUID;
  at: ISODateTime;
  actorId: string;
  action: string;
  entityType: string;
  entityId: UUID;
  beforeHash?: string;
  afterHash?: string;
  rationale?: string;
}

export interface PlanVariant {
  id: UUID;
  name: string;
  channels: ChannelPlan[];
  sequence: SequenceStep[];
  analysis: AnalysisResult[];
  parentVariantId?: UUID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type ImagingFormat = "dicom" | "dicom_archive" | "nifti" | "labelmap" | "stl" | "obj" | "ply" | "unknown";
export type ImagingBoneIdentity = "femur" | "tibia" | "fibula" | "patella" | "unknown";

export interface ImmutableImagingSourceRecord {
  id: UUID;
  fileName: string;
  format: ImagingFormat;
  byteLength: number;
  sha256: string;
  importedAt: ISODateTime;
  immutable: true;
  spacingMm: Vector3 | null;
  orientation: string | null;
  transformIds: UUID[];
  boneIdentity: ImagingBoneIdentity;
}

export interface ImagingLateralityHint {
  laterality: Laterality | null;
  status: "resolved" | "conflict" | "absent" | "not_applicable";
  confidence: "high" | "low" | "none";
  evidence: Array<{
    source:
      | "dicom_image_laterality"
      | "dicom_laterality"
      | "dicom_body_part_examined"
      | "dicom_series_description";
    laterality: Laterality;
  }>;
  requiresClinicianVerification: true;
}

export interface ImagingReviewRecord {
  laterality: Laterality | "unverified";
  scaleVerified: boolean;
  orientationVerified: boolean;
  boneIdentitiesVerified: boolean;
  sourceLabelMapsImmutable: true;
  corrections: Array<{
    id: UUID;
    sourceId: UUID;
    operation: "brush" | "erase" | "component_cleanup" | "hole_repair" | "smoothing";
    createdAt: ISODateTime;
    author: string;
    note: string;
  }>;
  meshQuality: Record<string, {
    manifold: boolean | null;
    components: number | null;
    normalsVerified: boolean;
    selfIntersections: number | null;
    reviewer: string | null;
    reviewedAt: ISODateTime | null;
  }>;
}

export interface DerivedImagingAssetRecord {
  id: UUID;
  serviceRunId: UUID;
  serviceArtifactId: UUID;
  kind: "immutable_labelmap" | "surface_mesh";
  mediaType: string;
  sha256: string;
  byteLength: number;
  immutable: true;
  coordinateFrameId: UUID;
  boneIdentity: "femur" | "tibia" | "fibula";
  sourceAssetIds: UUID[];
  /** The persisted plan stores an opaque ID, never a filesystem path or URL. */
  availability: "local_service" | "unavailable";
}

export interface SegmentationRunRecord {
  id: UUID;
  adapterId: string;
  adapterVersion: string;
  validationState: "research_only" | "institution_validated";
  researchUseOnly: boolean;
  sourceId: UUID;
  algorithm: {
    name: string;
    modelId: string;
    modelVersion: string | null;
    modelSha256: string;
    pipelineName: string;
    modelDataset: string;
    modelTrainer: string;
    modelPlans: string;
    modelConfiguration: string;
    modelFolds: number[];
    checkpointName: string;
    checkpoints: Array<{
      fold: number;
      checkpointName: string;
      sha256: string;
      byteLength: number;
    }>;
    configurationArtifacts: Array<{
      name: "plans.json" | "dataset.json";
      sha256: string;
      byteLength: number;
    }>;
    nnunetv2Version: string | null;
    matPlannerRevision: string;
    registrySha256: string;
    algorithmSourceSha256: string;
  };
  labelStatus: Record<"femur" | "tibia" | "fibula", "segmented" | "missing" | "failed">;
  artifactIds: UUID[];
  warningCodes: string[];
  notEvaluatedCodes: string[];
  /** Advisory import metadata only; never clinician verification. */
  lateralityHint?: ImagingLateralityHint;
  generatedAt: ISODateTime;
}

export interface ImagingCaseState {
  sources: ImmutableImagingSourceRecord[];
  derivedAssets: DerivedImagingAssetRecord[];
  segmentationRuns: SegmentationRunRecord[];
  /** Current privacy-safe import hint; advisory until clinician verification. */
  lateralityHint?: ImagingLateralityHint;
  review: ImagingReviewRecord;
  segmentationAdapterId: string;
  segmentationValidationState: "not_connected" | "research_only" | "institution_validated";
}

export interface PlanCase {
  id: UUID;
  deidentifiedLabel: string;
  laterality: Laterality;
  coordinateFrames: CoordinateFrame[];
  anatomy: AnatomyObject[];
  procedures: ProcedureInstance[];
  intentionalRelationships: IntentionalRelationship[];
  variants: PlanVariant[];
  activeVariantId: UUID;
  catalogVersion: string;
  schemaVersion: string;
  geometryGeneratorVersion: string;
  sourceStudyIds: UUID[];
  imaging: ImagingCaseState;
  analysisSettings: {
    informationalClearanceThresholdMm: Millimeters;
    thresholdSource: "clinician_selected";
  };
  lateralityVerified: boolean;
  scaleVerified: boolean;
  audit: AuditEvent[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
