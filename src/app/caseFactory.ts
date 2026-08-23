import type {
  ChannelPlan,
  GeometryLayerKind,
  InstrumentChain,
  PlanCase,
  ProcedureInstance,
  SequenceStep,
  Vector3,
} from "../domain/types";
import { CURRENT_PLAN_SCHEMA_VERSION } from "../domain/schema";

const NOW = "2026-08-02T12:00:00Z";

export function createIncompleteInstrumentChain(id: string): InstrumentChain {
  return {
    id: `chain-${id}`,
    regionInstitutionSetId: null,
    marketOrRegion: null,
    manufacturerId: null,
    productFamilyId: null,
    productVariantId: null,
    guideInstrumentId: null,
    guideSide: null,
    hookArmOffsetAngle: { hookOrArmId: null, offsetMm: null, angleDeg: null },
    sleeveBulletDepthStop: { sleeveOrBulletId: null, depthStopMm: null },
    pinInstrumentId: null,
    cutterInstrumentId: null,
    exactSizeOrProfileId: null,
    depthOrFullTunnelSetting: { mode: null, depthMm: null },
    graftSelectionId: null,
    fixationImplantIds: [],
    fixationPreparationInstrumentIds: [],
    sourceIds: [],
    catalogVersion: "1.0.0",
    userVerified: false,
    verification: null,
    completionState: "incomplete",
    missingSelections: [
      "region/institution set",
      "manufacturer",
      "product family",
      "exact model/SKU",
      "guide and side",
      "hook/arm/offset/angle",
      "sleeve/bullet/depth stop",
      "pin",
      "drill/reamer/cutter/dilator/punch/tap",
      "exact size/profile",
      "depth/full-tunnel setting",
      "graft",
      "fixation implant and preparation",
    ],
  };
}

const LAYER_KINDS: GeometryLayerKind[] = [
  "bone_removal_or_compaction",
  "pin_tract_and_overshoot",
  "instrument_access_swept_volume",
  "cutter_deployment_retraction",
  "graft_or_bone_block",
  "retained_fixation",
  "surface_hardware_flip_deployment",
  "safety_margin",
];

interface ChannelSeed {
  id: string;
  label: string;
  procedureId: string;
  bone: ChannelPlan["bone"];
  geometryType: ChannelPlan["geometryType"];
  aperture: Vector3;
  vector: Vector3;
  depthMm: number;
  diameterMm: number;
  fullThickness?: boolean;
  crossSection?: ChannelPlan["crossSection"];
  preparationMode?: ChannelPlan["preparationMode"];
  noLargeTunnel?: boolean;
}

function channel(seed: ChannelSeed): ChannelPlan {
  const resolvedCrossSection = seed.crossSection ?? { kind: "circle" as const, diameterMm: seed.diameterMm };
  const guidePinSocket = [
    "antegrade_blind_socket",
    "retrograde_socket",
    "flexible_reamed_socket",
    "stepped_button_tunnel",
  ].includes(seed.geometryType);
  return {
    id: seed.id,
    label: seed.label,
    procedureId: seed.procedureId,
    bone: seed.bone,
    geometryType: seed.geometryType,
    crossSection: resolvedCrossSection,
    aperture: seed.aperture,
    vector: seed.vector,
    centerline: { kind: "rigid", aperturePatientRasMm: seed.aperture, directionPatientRas: seed.vector },
    trajectoryControlMode: seed.geometryType === "anchor_pilot"
      ? "exterior_rod"
      : seed.noLargeTunnel || seed.geometryType === "onlay_no_large_tunnel"
        ? "none"
        : "outer_cortex_surface",
    guidePin: guidePinSocket
      ? { diameterMm: 3.5, provenance: "generic_parametric_visual_seed" }
      : null,
    surfacePlacement: {
      state: "pending_default",
      method: "preset_seed_unregistered",
      meshIds: [],
      endpointMethod: "not_available",
    },
    depthMm: seed.depthMm,
    diameterMm: seed.diameterMm,
    orientationDeg: "rotationDeg" in resolvedCrossSection ? resolvedCrossSection.rotationDeg : 0,
    fullThickness: seed.fullThickness ?? false,
    preparationMode: seed.preparationMode ?? "cut",
    // Retained as a nullable persisted field for older plans and geometry
    // recipes, but no planning channel is seeded with a tip extension.
    tipOvershootMm: null,
    noLargeTunnel: seed.noLargeTunnel ?? false,
    genericSeed: {
      ...(guidePinSocket ? { pilotDiameterMm: [1, 6] as const } : {}),
      note: "Editable synthetic demonstration value; not a recommendation.",
    },
    instrumentChain: createIncompleteInstrumentChain(seed.id),
    graft: {
      id: `graft-${seed.id}`,
      type: null,
      preparation: null,
      diameterMm: null,
      dimensionsMm: {},
      source: null,
      verifiedByUser: false,
    },
    fixation: [],
    layers: LAYER_KINDS.map((kind) => ({
      id: `${seed.id}-${kind}`,
      channelId: seed.id,
      kind,
      label: kind.replaceAll("_", " "),
      visible: true,
      analyzable: kind !== "safety_margin",
      geometryGeneratorVersion: "1.2.0",
      missingParameters: [],
    })),
    intentionalRelationshipIds: [],
    verificationState: "needs_instrument_chain",
    warnings: [
      "Exact instrument chain incomplete — no device substitution has been made.",
      ...(guidePinSocket
        ? ["The displayed 3.5 mm guide pin is an editable generic parametric display seed, not a selected device, recommendation, or verified catalog dimension."]
        : []),
    ],
  };
}

function procedure(
  id: string,
  structure: ProcedureInstance["structure"],
  techniquePresetId: string,
  techniqueName: string,
  channelIds: string[],
): ProcedureInstance {
  return {
    id,
    structure,
    techniquePresetId,
    techniqueName,
    presetVersion: 1,
    constructs: [
      {
        id: `construct-${id}`,
        procedureId: id,
        name: `${structure} construct`,
        footprintIds: [],
        channelIds,
        relationshipIds: [],
      },
    ],
    footprints: [],
    notes: "Synthetic nonclinical demonstration preset; all geometry remains editable.",
    createdAt: NOW,
  };
}

function sequenceFor(channels: ChannelPlan[]): SequenceStep[] {
  const steps: SequenceStep[] = [];
  channels.forEach((item, index) => {
    steps.push({ id: `pin-${item.id}`, channelId: item.id, kind: "pin", label: `Place ${item.label} pin`, order: index, completed: false });
  });
  steps.push({ id: "inspect-all-pins", kind: "inspect", label: "Inspect all virtual pins and predicted exits", order: steps.length, completed: false });
  channels.forEach((item) => {
    steps.push({ id: `ream-${item.id}`, channelId: item.id, kind: "ream", label: `Prepare ${item.label}`, order: steps.length, completed: false });
  });
  ["ACL", "PCL", "PLC/FCL", "Medial root"].forEach((label) => {
    steps.push({ id: `graft-${label}`, kind: "graft_pass", label: `Pass ${label} graft/repair construct`, order: steps.length, completed: false });
    steps.push({ id: `fix-${label}`, kind: "fixation", label: `Place clinician-selected ${label} fixation`, order: steps.length, completed: false });
  });
  return steps;
}

export function createSyntheticDemoCase(): PlanCase {
  const channels = [
    channel({ id: "acl-femoral", label: "ACL femoral retro socket", procedureId: "proc-acl", bone: "femur", geometryType: "retrograde_socket", aperture: [2, 2, 48], vector: [0.62, 0.42, 0.66], depthMm: 26, diameterMm: 9 }),
    channel({ id: "acl-tibial", label: "ACL tibial retro socket", procedureId: "proc-acl", bone: "tibia", geometryType: "retrograde_socket", aperture: [1, 5, 22], vector: [-0.05, -0.2, -1], depthMm: 32, diameterMm: 9 }),
    channel({ id: "pcl-femoral", label: "PCL femoral socket", procedureId: "proc-pcl", bone: "femur", geometryType: "antegrade_blind_socket", aperture: [-5, -5, 46], vector: [-0.85, -0.24, 0.12], depthMm: 28, diameterMm: 10 }),
    channel({ id: "pcl-tibial", label: "PCL transtibial tunnel", procedureId: "proc-pcl", bone: "tibia", geometryType: "round_full_tunnel", aperture: [-4, -7, 21], vector: [0.16, -0.43, -0.89], depthMm: 45, diameterMm: 10, fullThickness: true }),
    channel({ id: "plc-fcl-femoral", label: "FCL femoral socket", procedureId: "proc-plc", bone: "femur", geometryType: "antegrade_blind_socket", aperture: [7, 3, 48], vector: [0.94, 0.12, 0.18], depthMm: 26, diameterMm: 6 }),
    channel({ id: "plc-pop-femoral", label: "Popliteus femoral socket", procedureId: "proc-plc", bone: "femur", geometryType: "flexible_reamed_socket", aperture: [7, -2, 45], vector: [0.92, -0.28, 0.12], depthMm: 25, diameterMm: 6 }),
    channel({ id: "plc-fibular", label: "Fibular-head tunnel", procedureId: "proc-plc", bone: "fibula", geometryType: "round_full_tunnel", aperture: [23, 2, 18], vector: [0.18, -0.94, -0.08], depthMm: 24, diameterMm: 6, fullThickness: true }),
    channel({ id: "plc-tibial", label: "PLC tibial tunnel", procedureId: "proc-plc", bone: "tibia", geometryType: "round_full_tunnel", aperture: [13, -5, 18], vector: [-0.28, 0.5, -0.82], depthMm: 38, diameterMm: 7, fullThickness: true }),
    channel({ id: "root-medial-a", label: "Medial root anterior tunnel", procedureId: "proc-root", bone: "tibia", geometryType: "round_full_tunnel", aperture: [-4, 0, 20], vector: [-0.18, 0.18, -0.97], depthMm: 34, diameterMm: 3.5, fullThickness: true }),
    channel({ id: "root-medial-p", label: "Medial root posterior tunnel", procedureId: "proc-root", bone: "tibia", geometryType: "round_full_tunnel", aperture: [-8, -4, 19], vector: [-0.12, 0.1, -0.99], depthMm: 34, diameterMm: 3.5, fullThickness: true }),
  ];

  const procedures = [
    procedure("proc-acl", "ACL", "acl-all-inside-bilateral", "All-inside bilateral sockets", ["acl-femoral", "acl-tibial"]),
    procedure("proc-pcl", "PCL", "pcl-transtibial", "Single-bundle transtibial", ["pcl-femoral", "pcl-tibial"]),
    procedure("proc-plc", "PLC_FCL", "plc-anatomic-two-graft", "Anatomic two-graft / LaPrade-style", ["plc-fcl-femoral", "plc-pop-femoral", "plc-fibular", "plc-tibial"]),
    procedure("proc-root", "MEDIAL_ROOT", "medial-root-double", "Double transtibial", ["root-medial-a", "root-medial-p"]),
  ];

  return {
    id: "synthetic-case-mlk-042",
    deidentifiedLabel: "MLK-042 · Synthetic demo",
    laterality: "left",
    coordinateFrames: [
      {
        id: "patient-ras",
        kind: "dicom_patient",
        name: "Synthetic patient RAS",
        units: "mm",
        sourceConvention: "RAS",
        transformToPatientRas: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        source: "synthetic_nonclinical_fixture",
        scaleVerified: true,
      },
      {
        id: "viewer-world",
        kind: "viewer_world",
        name: "MAT Viewer v2 world",
        units: "mm",
        sourceConvention: "VIEWER_WORLD",
        transformToPatientRas: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        source: "MAT Viewer v2 contract",
        scaleVerified: true,
      },
    ],
    anatomy: [],
    procedures,
    intentionalRelationships: [],
    variants: [
      { id: "variant-a", name: "Plan A", channels, sequence: sequenceFor(channels), analysis: [], createdAt: NOW, updatedAt: NOW },
    ],
    activeVariantId: "variant-a",
    catalogVersion: "1.0.0",
    schemaVersion: CURRENT_PLAN_SCHEMA_VERSION,
    geometryGeneratorVersion: "1.2.0",
    sourceStudyIds: [],
    imaging: {
      sources: [],
      derivedAssets: [],
      segmentationRuns: [],
      review: {
        laterality: "unverified",
        scaleVerified: false,
        orientationVerified: false,
        boneIdentitiesVerified: false,
        sourceLabelMapsImmutable: true,
        corrections: [],
        meshQuality: {},
      },
      segmentationAdapterId: "mat-planner-knee-bone-masker-nnunetv2",
      segmentationValidationState: "research_only",
    },
    analysisSettings: {
      informationalClearanceThresholdMm: 2,
      thresholdSource: "clinician_selected",
    },
    lateralityVerified: true,
    scaleVerified: true,
    audit: [
      { id: "audit-create", at: NOW, actorId: "demo-loader", action: "load_synthetic_nonclinical_fixture", entityType: "PlanCase", entityId: "synthetic-case-mlk-042", rationale: "Interactive product demonstration only" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}
