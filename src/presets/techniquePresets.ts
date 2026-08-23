import type {
  Bone,
  ChannelPlan,
  CrossSection,
  GenericSeedRange,
  GeometryLayer,
  GeometryLayerKind,
  GeometryType,
  InstrumentChain,
  ProcedureIdentity,
  ProcedureInstance,
  UUID,
} from "../domain/types";

export interface ProcedureQuickAdd {
  id: ProcedureIdentity;
  label: string;
}

export const PROCEDURE_QUICK_ADD: readonly ProcedureQuickAdd[] = [
  { id: "ACL", label: "ACL" },
  { id: "PCL", label: "PCL" },
  { id: "PLC_FCL", label: "PLC/FCL" },
  { id: "MCL_POL_PMC", label: "MCL/POL/PMC" },
  { id: "ALL", label: "ALL" },
  { id: "LET", label: "LET" },
  { id: "MEDIAL_ROOT", label: "Medial Root" },
  { id: "LATERAL_ROOT", label: "Lateral Root" },
  { id: "CUSTOM", label: "Custom" },
] as const;

type CrossSectionKind = CrossSection["kind"];

export interface TechniqueChannelSeed {
  key: string;
  label: string;
  constructLabel: string;
  bone: Bone;
  geometryType: GeometryType;
  crossSectionKind: CrossSectionKind;
  genericSeed: GenericSeedRange;
  fullThickness: boolean;
  preparationMode: ChannelPlan["preparationMode"];
  trajectoryControlMode?: NonNullable<ChannelPlan["trajectoryControlMode"]>;
  /**
   * Optional non-authoritative values used only to make an editable planning
   * template visible on first render. These values never complete or verify an
   * instrument chain and must remain inside the accompanying generic range.
   */
  initialPlanningValues?: {
    diameterMm: number;
    depthMm: number;
    guidePinDiameterMm?: number;
    guidePinProvenance?: "generic_parametric_visual_seed" | "clinician_entered_planning_value";
    provenance: "generic_parametric_visual_seed" | "clinician_entered_planning_value";
  };
  noLargeTunnel?: boolean;
  warnings?: string[];
}

export interface TechniquePreset {
  id: string;
  version: 1;
  procedure: ProcedureIdentity;
  name: string;
  description: string;
  /** Technique labels are editable presets, never authoritative geometry. */
  provenance: "product_blueprint" | "institution_defined" | "custom";
  channelSeeds: readonly TechniqueChannelSeed[];
}

const seed = (
  key: string,
  label: string,
  bone: Bone,
  geometryType: GeometryType,
  genericSeed: GenericSeedRange,
  options: Partial<Pick<TechniqueChannelSeed,
    "constructLabel" | "crossSectionKind" | "fullThickness" | "preparationMode" | "trajectoryControlMode" | "initialPlanningValues" | "noLargeTunnel" | "warnings"
  >> = {},
): TechniqueChannelSeed => ({
  key,
  label,
  bone,
  geometryType,
  genericSeed,
  constructLabel: options.constructLabel ?? label,
  crossSectionKind: options.crossSectionKind ?? "circle",
  fullThickness: options.fullThickness ?? geometryType === "round_full_tunnel",
  preparationMode: options.preparationMode ?? (geometryType === "onlay_no_large_tunnel" ? "none" : "cut"),
  trajectoryControlMode: options.trajectoryControlMode,
  initialPlanningValues: options.initialPlanningValues,
  noLargeTunnel: options.noLargeTunnel,
  warnings: options.warnings,
});

const preset = (
  id: string,
  procedure: ProcedureIdentity,
  name: string,
  description: string,
  channelSeeds: readonly TechniqueChannelSeed[],
  provenance: TechniquePreset["provenance"] = "product_blueprint",
): TechniquePreset => ({ id, version: 1, procedure, name, description, channelSeeds, provenance });

const round = (diameterMm: readonly [number, number], depthMm?: readonly [number, number]): GenericSeedRange => ({
  diameterMm,
  ...(depthMm ? { depthMm } : {}),
});

const aclSingle = (
  femoralType: GeometryType,
  tibialType: GeometryType,
): readonly TechniqueChannelSeed[] => [
  seed("femoral", "ACL femoral", "femur", femoralType, round([7, 12], [15, 35]), {
    fullThickness: femoralType === "round_full_tunnel",
  }),
  seed("tibial", "ACL tibial", "tibia", tibialType, round([7, 12], [20, 40]), {
    fullThickness: tibialType === "round_full_tunnel",
  }),
];

const pclSingle = (
  femoralType: GeometryType,
  tibialType: GeometryType,
): readonly TechniqueChannelSeed[] => [
  seed("femoral", "PCL femoral", "femur", femoralType, round([8, 12.5], [20, 35]), {
    fullThickness: femoralType === "round_full_tunnel",
  }),
  seed("tibial", "PCL tibial", "tibia", tibialType, round([8, 12.5], [20, 45]), {
    fullThickness: tibialType === "round_full_tunnel",
    warnings: ["Posterior pin exit requires review before reaming.", "Posterior danger anatomy is not evaluated until imported or segmented."],
  }),
];

const collateralSeed = (key: string, label: string, bone: Bone, range: readonly [number, number], depth: readonly [number, number]): TechniqueChannelSeed =>
  seed(key, label, bone, "antegrade_blind_socket", round(range, depth), { fullThickness: false });

const GENERIC_ANCHOR_VISUAL_DEPTH_RANGE_MM = [4, 30] as const;
const MAT_MINI_OPEN_INTERFERENCE_TEMPLATE = { diameterMm: 4.75, depthMm: 22 } as const;
const MAT_MINI_OPEN_ALL_SUTURE_TEMPLATE = { diameterMm: 2.6, depthMm: 20 } as const;

/**
 * Creates a short, circular anchor preparation socket/pilot that is visible
 * and editable immediately, following MAT Planner's mini-open anchor visual
 * templates. The values are deliberately generic and
 * do not identify a product, preparation instrument, or clinically verified
 * pilot recipe.
 */
const anchorSocketPilotSeed = (
  key: string,
  label: string,
  bone: Bone,
  diameterRangeMm: readonly [number, number],
  additionalWarnings: string[] = [],
): TechniqueChannelSeed => {
  const visualTemplate = (
    MAT_MINI_OPEN_INTERFERENCE_TEMPLATE.diameterMm >= diameterRangeMm[0] &&
    MAT_MINI_OPEN_INTERFERENCE_TEMPLATE.diameterMm <= diameterRangeMm[1]
  )
    ? MAT_MINI_OPEN_INTERFERENCE_TEMPLATE
    : MAT_MINI_OPEN_ALL_SUTURE_TEMPLATE;
  if (
    visualTemplate.diameterMm < diameterRangeMm[0] ||
    visualTemplate.diameterMm > diameterRangeMm[1]
  ) {
    throw new Error(`Generic anchor visual diameter is outside the declared range for ${label}.`);
  }

  return seed(key, label, bone, "anchor_pilot", {
    diameterMm: diameterRangeMm,
    depthMm: GENERIC_ANCHOR_VISUAL_DEPTH_RANGE_MM,
    pilotDiameterMm: diameterRangeMm,
    note: "Editable generic visual seed only; exact drill, punch, tap, anchor, diameter, and depth remain clinician-selected from verified data.",
  }, {
    fullThickness: false,
    preparationMode: "cut",
    initialPlanningValues: {
      diameterMm: visualTemplate.diameterMm,
      depthMm: visualTemplate.depthMm,
      provenance: "generic_parametric_visual_seed",
    },
    noLargeTunnel: true,
    warnings: [
      ...additionalWarnings,
      `The displayed ${visualTemplate.diameterMm} × ${visualTemplate.depthMm} mm anchor socket/pilot follows a MAT mini-open visual template. It is an editable generic visual planning seed, not a selected or device-verified preparation.`,
      "Select and verify the exact anchor, drill/punch/tap, diameter, and depth before treating retained fixation or device-specific clearance as evaluated.",
    ],
  });
};

const rootPresets = (procedure: "MEDIAL_ROOT" | "LATERAL_ROOT", prefix: string): TechniquePreset[] => {
  const label = procedure === "MEDIAL_ROOT" ? "Medial root" : "Lateral root";
  const commonWarning = `${label} footprint must be placed explicitly; the preset does not select an anatomical point.`;
  return [
    preset(`${prefix}-single-transtibial`, procedure, "Single transtibial pullout tunnel", "One editable small pullout channel.", [
      seed("pullout", `${label} pullout`, "tibia", "round_full_tunnel", round([2.4, 4.5]), { warnings: [commonWarning] }),
    ]),
    preset(`${prefix}-double-transtibial`, procedure, "Double transtibial pullout tunnels", "Two independent small pullout channels with explicit spacing.", [
      seed("pullout-1", `${label} pullout 1`, "tibia", "round_full_tunnel", round([2.4, 4]), { warnings: [commonWarning, "Set aperture spacing explicitly."] }),
      seed("pullout-2", `${label} pullout 2`, "tibia", "round_full_tunnel", round([2.4, 4]), { warnings: [commonWarning, "Set aperture spacing explicitly."] }),
    ]),
    preset(`${prefix}-retro-socket`, procedure, "Retrograde root socket", "Blind retro socket with a separate pilot/passing channel layer.", [
      seed("retro-socket", `${label} retro socket`, "tibia", "retrograde_socket", {
        socketDiameterMm: [5, 7], socketDepthMm: [5, 15], pilotDiameterMm: [2.4, 4],
      }, { fullThickness: false, warnings: [commonWarning] }),
    ]),
    preset(`${prefix}-direct-anchor`, procedure, "Direct suture anchor", "Small verified anchor pilot; no graft-sized tunnel is created.", [
      anchorSocketPilotSeed("anchor", `${label} anchor socket/pilot`, "tibia", [1.5, 3.5], [commonWarning]),
    ]),
    preset(`${prefix}-shared-coalesced`, procedure, "Intentionally shared/coalesced channel", "Candidate shared path requiring selection of the other channel and a clinician-entered rationale.", [
      seed("shared", `${label} shared channel`, "tibia", "custom", round([2.4, 4.5]), {
        warnings: [commonWarning, "Select the related channel and record an intentional-sharing rationale; overlap alone is a conflict."],
      }),
    ]),
    preset(`${prefix}-no-bone-channel`, procedure, "No-bone-channel root-adjacent repair", "No pullout tunnel; optional verified fixation pilots may be added explicitly.", [
      seed("onlay", `${label} no-bone-channel repair`, "tibia", "onlay_no_large_tunnel", { note: "No large tunnel." }, {
        noLargeTunnel: true,
        fullThickness: false,
        warnings: [commonWarning, "Add actual small fixation pilots only after fixation selection."],
      }),
    ]),
    preset(`${prefix}-institution-defined`, procedure, "Institution-defined root technique", "Editable local technique with no implied device chain.", [
      seed("institution-defined", `${label} institution-defined channel`, "tibia", "custom", { pilotDiameterMm: [1.5, 7], depthMm: [5, 45] }, { warnings: [commonWarning] }),
    ], "institution_defined"),
    preset(`${prefix}-custom`, procedure, "Custom root construct", "Unconstrained editable root construct.", [
      seed("custom", `${label} custom channel`, "tibia", "custom", { pilotDiameterMm: [1.5, 7], depthMm: [5, 45] }, { warnings: [commonWarning] }),
    ], "custom"),
  ];
};

export const TECHNIQUE_PRESETS: readonly TechniquePreset[] = [
  // ACL
  preset("acl-single-bundle-transtibial", "ACL", "Single-bundle transtibial", "Femoral trajectory remains editable and is constrained through the tibial channel when evaluated.", aclSingle("round_full_tunnel", "round_full_tunnel")),
  preset("acl-independent-am-portal", "ACL", "Independent anteromedial portal", "Independent femoral socket with an explicit portal/access envelope.", aclSingle("antegrade_blind_socket", "round_full_tunnel")),
  preset("acl-outside-in", "ACL", "Outside-in", "Independent outside-in femoral socket and tibial channel.", aclSingle("antegrade_blind_socket", "round_full_tunnel")),
  preset("acl-flexible-reaming", "ACL", "Flexible femoral reaming", "Straight intraosseous socket plus a separate curved access envelope.", aclSingle("flexible_reamed_socket", "round_full_tunnel")),
  preset("acl-all-inside-bilateral-sockets", "ACL", "All-inside bilateral sockets", "Separate femoral and tibial retro sockets with pilot and deployment layers.", aclSingle("retrograde_socket", "retrograde_socket")),
  preset("acl-full-tunnel-soft-tissue", "ACL", "Full-tunnel soft tissue", "Independent full femoral and tibial tunnels.", aclSingle("round_full_tunnel", "round_full_tunnel")),
  preset("acl-btb-bone-block", "ACL", "Bone-block / BTB", "Measured bone-block profiles; dimensions are deliberately unset until entered.", [
    seed("femoral-block", "ACL femoral bone-block channel", "femur", "noncircular_tunnel", { widthMm: [5, 6], heightMm: [10, 10], depthMm: [15, 35] }, { crossSectionKind: "rectangle" }),
    seed("tibial-block", "ACL tibial bone-block channel", "tibia", "noncircular_tunnel", { widthMm: [5, 6], heightMm: [10, 10], depthMm: [20, 40] }, { crossSectionKind: "rectangle" }),
  ]),
  preset("acl-double-bundle-am-pl", "ACL", "Double-bundle AM/PL", "Four independently editable AM/PL channels.", [
    seed("femoral-am", "ACL femoral AM", "femur", "antegrade_blind_socket", round([5, 10], [15, 35]), { constructLabel: "ACL AM", fullThickness: false }),
    seed("tibial-am", "ACL tibial AM", "tibia", "round_full_tunnel", round([5, 10]), { constructLabel: "ACL AM" }),
    seed("femoral-pl", "ACL femoral PL", "femur", "antegrade_blind_socket", round([4.5, 9], [15, 30]), { constructLabel: "ACL PL", fullThickness: false }),
    seed("tibial-pl", "ACL tibial PL", "tibia", "round_full_tunnel", round([4.5, 9]), { constructLabel: "ACL PL" }),
  ]),
  preset("acl-ribbon", "ACL", "Ribbon / slot", "Editable noncircular ribbon profiles on each bone.", [
    seed("femoral", "ACL femoral ribbon", "femur", "noncircular_tunnel", { widthMm: [7, 12], heightMm: [3, 8], depthMm: [15, 35] }, { crossSectionKind: "slot_ribbon" }),
    seed("tibial", "ACL tibial ribbon", "tibia", "noncircular_tunnel", { widthMm: [7, 12], heightMm: [3, 8], depthMm: [20, 40] }, { crossSectionKind: "slot_ribbon" }),
  ]),
  preset("acl-oval", "ACL", "Oval", "Editable oval profiles on each bone.", [
    seed("femoral", "ACL femoral oval", "femur", "noncircular_tunnel", { widthMm: [7, 12], heightMm: [4.5, 10], depthMm: [15, 35] }, { crossSectionKind: "ellipse" }),
    seed("tibial", "ACL tibial oval", "tibia", "noncircular_tunnel", { widthMm: [7, 12], heightMm: [4.5, 10], depthMm: [20, 40] }, { crossSectionKind: "ellipse" }),
  ]),
  preset("acl-rectangular", "ACL", "Rectangular", "Editable rectangular profiles on each bone.", [
    seed("femoral", "ACL femoral rectangle", "femur", "noncircular_tunnel", { widthMm: [5, 12], heightMm: [4.5, 10], depthMm: [15, 35] }, { crossSectionKind: "rounded_rectangle" }),
    seed("tibial", "ACL tibial rectangle", "tibia", "noncircular_tunnel", { widthMm: [5, 12], heightMm: [4.5, 10], depthMm: [20, 40] }, { crossSectionKind: "rounded_rectangle" }),
  ]),
  preset("acl-c-shaped", "ACL", "C-shaped", "Editable C-profile tunnels with explicit cross-section orientation.", [
    seed("femoral", "ACL femoral C-profile", "femur", "noncircular_tunnel", { diameterMm: [7, 12], depthMm: [15, 35] }, { crossSectionKind: "c_profile" }),
    seed("tibial", "ACL tibial C-profile", "tibia", "noncircular_tunnel", { diameterMm: [7, 12], depthMm: [20, 40] }, { crossSectionKind: "c_profile" }),
  ]),
  preset("acl-repair-anchor", "ACL", "Repair / anchor augmentation", "Small anchor pilots only; no graft-sized tunnel is inferred.", [
    seed("femoral-anchor", "ACL femoral anchor pilot", "femur", "anchor_pilot", { pilotDiameterMm: [1.5, 5.5] }, { preparationMode: "punch", fullThickness: false }),
    seed("tibial-anchor", "ACL tibial anchor pilot", "tibia", "anchor_pilot", { pilotDiameterMm: [1.5, 5.5] }, { preparationMode: "punch", fullThickness: false }),
  ]),
  preset("acl-physeal-sparing", "ACL", "Physeal-sparing", "Editable construct that remains not evaluated until physis anatomy is present.", [
    seed("femoral", "ACL physeal-sparing femoral", "femur", "custom", round([4.5, 12], [15, 35]), { warnings: ["Physis is not evaluated until imported or segmented."] }),
    seed("tibial", "ACL physeal-sparing tibial", "tibia", "custom", round([4.5, 12], [15, 40]), { warnings: ["Physis is not evaluated until imported or segmented."] }),
  ]),
  preset("acl-custom", "ACL", "Custom ACL", "Unconstrained editable ACL construct.", [seed("custom", "ACL custom channel", "custom", "custom", round([4.5, 20], [5, 60]))], "custom"),

  // PCL
  preset("pcl-single-bundle-transtibial", "PCL", "Single-bundle transtibial", "Full tibial channel with posterior exit review.", pclSingle("antegrade_blind_socket", "round_full_tunnel")),
  preset("pcl-all-inside", "PCL", "Single-bundle all-inside", "Separate retrograde femoral and tibial sockets.", pclSingle("retrograde_socket", "retrograde_socket")),
  preset("pcl-outside-in-femoral", "PCL", "Outside-in femoral socket", "Independent outside-in femoral socket.", pclSingle("antegrade_blind_socket", "round_full_tunnel")),
  preset("pcl-flexible-femoral", "PCL", "Flexible femoral reaming", "Femoral socket plus separate curved access envelope.", pclSingle("flexible_reamed_socket", "round_full_tunnel")),
  preset("pcl-rigid-femoral", "PCL", "Rigid femoral reaming", "Rigid femoral socket and independent tibial channel.", pclSingle("antegrade_blind_socket", "round_full_tunnel")),
  preset("pcl-double-bundle-al-pm", "PCL", "Double-bundle AL/PM", "Four independently editable AL/PM channels.", [
    seed("femoral-al", "PCL femoral AL", "femur", "antegrade_blind_socket", round([7, 12], [20, 35]), { constructLabel: "PCL AL", fullThickness: false }),
    seed("tibial-al", "PCL tibial AL", "tibia", "round_full_tunnel", round([7, 12]), { constructLabel: "PCL AL", warnings: ["Posterior danger anatomy is not evaluated until imported or segmented."] }),
    seed("femoral-pm", "PCL femoral PM", "femur", "antegrade_blind_socket", round([5, 9], [15, 30]), { constructLabel: "PCL PM", fullThickness: false }),
    seed("tibial-pm", "PCL tibial PM", "tibia", "round_full_tunnel", round([5, 9]), { constructLabel: "PCL PM", warnings: ["Posterior danger anatomy is not evaluated until imported or segmented."] }),
  ]),
  preset("pcl-tibial-inlay", "PCL", "Tibial inlay trough", "Posterior trough/bone-block recess plus femoral channel; never approximated as one cylinder.", [
    seed("femoral", "PCL femoral", "femur", "antegrade_blind_socket", round([8, 12.5], [20, 35]), { fullThickness: false }),
    seed("tibial-trough", "PCL tibial inlay trough", "tibia", "pcl_inlay_trough", { widthMm: [8, 18], depthMm: [3, 12], note: "Outline and wall slope are clinician drawn." }, { crossSectionKind: "polygon", fullThickness: false }),
  ]),
  preset("pcl-repair-avulsion", "PCL", "Repair / avulsion", "Anchor or transosseous pilot geometry without an inferred graft-sized tunnel.", [
    seed("repair-pilot", "PCL repair/avulsion pilot", "tibia", "anchor_pilot", { pilotDiameterMm: [1.5, 6] }, { preparationMode: "punch", fullThickness: false }),
  ]),
  preset("pcl-physeal-sparing", "PCL", "Physeal-sparing", "Editable construct that remains not evaluated until physis anatomy is present.", [
    seed("femoral", "PCL physeal-sparing femoral", "femur", "custom", round([5, 12.5], [15, 35]), { warnings: ["Physis is not evaluated until imported or segmented."] }),
    seed("tibial", "PCL physeal-sparing tibial", "tibia", "custom", round([5, 12.5], [15, 45]), { warnings: ["Physis and posterior danger anatomy are not evaluated until present."] }),
  ]),
  preset("pcl-custom", "PCL", "Custom PCL", "Unconstrained editable PCL construct.", [seed("custom", "PCL custom channel", "custom", "custom", round([5, 20], [5, 60]))], "custom"),

  // PLC/FCL
  preset("plc-anatomic-laprade", "PLC_FCL", "Anatomic two-graft / LaPrade-style", "Only the four required editable bone channels are created.", [
    collateralSeed("fcl-femoral", "FCL femoral", "femur", [5, 9], [20, 40]),
    collateralSeed("popliteus-femoral", "Popliteus femoral", "femur", [5, 9], [20, 40]),
    seed("fibular-head", "Fibular-head tunnel", "fibula", "round_full_tunnel", round([4, 8]), { warnings: ["Evaluate fibular cortex and proximal tibiofibular joint clearance."] }),
    seed("plc-tibial", "PLC tibial tunnel", "tibia", "round_full_tunnel", round([6, 10], [20, 45])),
  ]),
  preset("plc-arciero", "PLC_FCL", "Arciero-style", "Editable femoral, fibular, and tibial components; channel objects remain authoritative.", [
    collateralSeed("fcl-femoral", "FCL femoral", "femur", [5, 9], [20, 40]),
    collateralSeed("popliteus-femoral", "Popliteus femoral", "femur", [5, 9], [20, 40]),
    seed("fibular-head", "Fibular-head tunnel", "fibula", "round_full_tunnel", round([4, 8]), { warnings: ["Evaluate fibular cortex and proximal tibiofibular joint clearance."] }),
    seed("plc-tibial", "PLC tibial tunnel", "tibia", "round_full_tunnel", round([6, 10], [20, 45])),
  ]),
  preset("plc-larson-modified", "PLC_FCL", "Larson / modified Larson", "Fibular sling seed with editable femoral fixation; no full anatomic PLC set is forced.", [
    seed("fibular-head", "Larson fibular tunnel", "fibula", "round_full_tunnel", round([4, 8]), { warnings: ["Evaluate fibular cortex and proximal tibiofibular joint clearance."] }),
    collateralSeed("femoral", "Larson femoral fixation", "femur", [4, 9], [20, 40]),
  ]),
  preset("plc-isolated-fcl", "PLC_FCL", "Isolated FCL", "FCL femoral and fibular channels only.", [
    collateralSeed("fcl-femoral", "FCL femoral", "femur", [5, 9], [20, 40]),
    seed("fibular-head", "FCL fibular-head tunnel", "fibula", "round_full_tunnel", round([4, 8]), { warnings: ["Evaluate fibular cortex and proximal tibiofibular joint clearance."] }),
  ]),
  preset("plc-isolated-popliteus-popfib", "PLC_FCL", "Isolated popliteus / popliteofibular", "Only popliteus/popliteofibular channels are seeded.", [
    collateralSeed("popliteus-femoral", "Popliteus femoral", "femur", [5, 9], [20, 40]),
    seed("popfib-tibial", "Popliteofibular tibial", "tibia", "round_full_tunnel", round([6, 10], [20, 45])),
  ]),
  preset("plc-repair-onlay", "PLC_FCL", "Repair / onlay", "Small anchor or surface-fixation pilots only.", [
    anchorSocketPilotSeed("femoral-anchor", "PLC femoral anchor socket/pilot", "femur", [1.5, 6]),
    anchorSocketPilotSeed("fibular-anchor", "PLC fibular anchor socket/pilot", "fibula", [1.5, 6]),
  ]),
  preset("plc-institution-defined", "PLC_FCL", "Institution-defined PLC/FCL", "Local editable construct with no implied channel set or device.", [seed("local", "Institution-defined PLC/FCL channel", "custom", "custom", round([1.5, 10], [5, 45]))], "institution_defined"),
  preset("plc-custom", "PLC_FCL", "Custom PLC/FCL", "Unconstrained editable PLC/FCL construct.", [seed("custom", "Custom PLC/FCL channel", "custom", "custom", round([1.5, 10], [5, 45]))], "custom"),

  // MCL/POL/PMC
  preset("mcl-anatomic-smcl", "MCL_POL_PMC", "Anatomic sMCL", "Femoral plus proximal/distal tibial sMCL channels.", [
    collateralSeed("smcl-femoral", "sMCL femoral", "femur", [5, 8], [20, 40]),
    collateralSeed("smcl-proximal-tibial", "sMCL proximal tibial", "tibia", [4, 8], [15, 35]),
    collateralSeed("smcl-distal-tibial", "sMCL distal tibial", "tibia", [4, 8], [15, 35]),
  ]),
  preset("mcl-smcl-pol-pmc", "MCL_POL_PMC", "sMCL plus POL/PMC", "Separate sMCL and POL/PMC channels.", [
    collateralSeed("smcl-femoral", "sMCL femoral", "femur", [5, 8], [20, 40]),
    collateralSeed("smcl-proximal-tibial", "sMCL proximal tibial", "tibia", [4, 8], [15, 35]),
    collateralSeed("smcl-distal-tibial", "sMCL distal tibial", "tibia", [4, 8], [15, 35]),
    collateralSeed("pol-femoral", "POL femoral", "femur", [4, 8], [15, 35]),
    collateralSeed("pol-tibial", "POL tibial", "tibia", [2, 8], [15, 35]),
  ]),
  preset("mcl-isolated-pol", "MCL_POL_PMC", "Isolated POL", "Separate editable POL femoral and tibial channels.", [
    collateralSeed("pol-femoral", "POL femoral", "femur", [4, 8], [15, 35]),
    collateralSeed("pol-tibial", "POL tibial", "tibia", [2, 8], [15, 35]),
  ]),
  preset("mcl-modified-lind", "MCL_POL_PMC", "Modified Lind-type", "Editable femoral and tibial fixation seed.", [
    collateralSeed("femoral", "Modified Lind femoral", "femur", [4, 8], [15, 40]),
    collateralSeed("tibial", "Modified Lind tibial", "tibia", [4, 8], [15, 35]),
  ]),
  preset("mcl-single-bundle", "MCL_POL_PMC", "Single-bundle", "Single femoral and tibial graft channels.", [
    collateralSeed("femoral", "MCL single-bundle femoral", "femur", [4, 8], [15, 40]),
    collateralSeed("tibial", "MCL single-bundle tibial", "tibia", [4, 8], [15, 35]),
  ]),
  preset("mcl-double-bundle", "MCL_POL_PMC", "Double-bundle", "Independent superficial and posterior bundle channels.", [
    collateralSeed("femoral-1", "MCL bundle 1 femoral", "femur", [4, 8], [15, 40]),
    collateralSeed("tibial-1", "MCL bundle 1 tibial", "tibia", [4, 8], [15, 35]),
    collateralSeed("femoral-2", "MCL bundle 2 femoral", "femur", [4, 8], [15, 40]),
    collateralSeed("tibial-2", "MCL bundle 2 tibial", "tibia", [4, 8], [15, 35]),
  ]),
  preset("mcl-repair", "MCL_POL_PMC", "Repair", "Editable anchor preparation pilot; exact fixation remains required.", [anchorSocketPilotSeed("repair", "MCL repair anchor socket/pilot", "femur", [1.5, 6])]),
  preset("mcl-internal-brace", "MCL_POL_PMC", "Internal brace augmentation", "Anchor pilots and retained implants require exact selection.", [
    anchorSocketPilotSeed("femoral", "MCL internal-brace femoral anchor socket/pilot", "femur", [1.5, 6]),
    anchorSocketPilotSeed("tibial", "MCL internal-brace tibial anchor socket/pilot", "tibia", [1.5, 6]),
  ]),
  preset("mcl-onlay", "MCL_POL_PMC", "Anchor / onlay", "An editable small anchor preparation pilot is shown; no graft-sized tunnel is inferred.", [anchorSocketPilotSeed("anchor", "MCL onlay anchor socket/pilot", "tibia", [1.5, 6])]),
  preset("mcl-institution-defined", "MCL_POL_PMC", "Institution-defined MCL/POL/PMC", "Local editable construct with no device defaults.", [seed("local", "Institution-defined medial channel", "custom", "custom", round([1.5, 8], [5, 40]))], "institution_defined"),
  preset("mcl-custom", "MCL_POL_PMC", "Custom MCL/POL/PMC", "Unconstrained editable medial construct.", [seed("custom", "Custom medial channel", "custom", "custom", round([1.5, 8], [5, 40]))], "custom"),

  // ALL
  preset("all-independent-sockets", "ALL", "Independent femoral/tibial sockets", "Two independent ALL sockets.", [
    collateralSeed("femoral", "ALL femoral", "femur", [4, 7], [15, 30]),
    collateralSeed("tibial", "ALL tibial", "tibia", [3.5, 7], [15, 30]),
  ]),
  preset("all-shared-acl-femoral", "ALL", "Explicitly shared ACL femoral channel", "Candidate shared channel requiring an ACL target and rationale.", [
    seed("shared-femoral", "ALL shared femoral", "femur", "custom", round([4, 7], [15, 30]), { warnings: ["Select the ACL channel and record a sharing rationale; overlap alone is a conflict."] }),
    collateralSeed("tibial", "ALL tibial", "tibia", [3.5, 7], [15, 30]),
  ]),
  preset("all-double-strand-transosseous", "ALL", "Double-strand / transosseous", "One femoral socket and two small tibial channels.", [
    collateralSeed("femoral", "ALL femoral", "femur", [4, 7], [15, 30]),
    seed("tibial-1", "ALL tibial transosseous 1", "tibia", "round_full_tunnel", round([2, 5])),
    seed("tibial-2", "ALL tibial transosseous 2", "tibia", "round_full_tunnel", round([2, 5])),
  ]),
  preset("all-anchor-onlay", "ALL", "Anchor / onlay", "Editable femoral and tibial anchor preparation pilots; no graft-sized tunnel is created.", [
    anchorSocketPilotSeed("femoral-anchor", "ALL femoral anchor socket/pilot", "femur", [1.5, 5.5]),
    anchorSocketPilotSeed("tibial-anchor", "ALL tibial anchor socket/pilot", "tibia", [1.5, 5.5]),
  ]),
  preset("all-repair-augmentation", "ALL", "Repair / augmentation", "An editable anchor preparation pilot is shown; exact fixation remains required.", [anchorSocketPilotSeed("repair", "ALL repair anchor socket/pilot", "femur", [1.5, 5.5])]),
  preset("all-institution-defined", "ALL", "Institution-defined ALL", "Local editable construct with no device defaults.", [seed("local", "Institution-defined ALL channel", "custom", "custom", round([1.5, 7], [5, 30]))], "institution_defined"),
  preset("all-custom", "ALL", "Custom ALL", "Unconstrained editable ALL construct.", [seed("custom", "Custom ALL channel", "custom", "custom", round([1.5, 7], [5, 30]))], "custom"),

  // LET
  preset("let-modified-lemaire", "LET", "Modified Lemaire", "Editable femoral fixation; IT-band relationship is soft tissue, not an invented tunnel.", [collateralSeed("femoral", "LET femoral socket", "femur", [4.5, 8], [15, 35])]),
  preset("let-institution-strip", "LET", "Institution-defined strip technique", "Local strip technique with editable fixation geometry.", [seed("fixation", "LET institution-defined fixation", "femur", "custom", round([1.5, 8], [5, 35]))], "institution_defined"),
  preset("let-interference-screw", "LET", "Interference-screw socket", "Socket and retained interference device remain separate layers.", [collateralSeed("socket", "LET interference-screw socket", "femur", [4.5, 8], [15, 35])]),
  preset("let-anchor", "LET", "Anchor fixation", "Editable short anchor socket/pilot; no graft-sized socket is created.", [anchorSocketPilotSeed("anchor", "LET anchor socket/pilot", "femur", [1.5, 5.5])]),
  preset("let-staple", "LET", "Staple fixation", "Paired staple legs and surface hardware require exact device geometry.", [seed("staple", "LET staple pilots", "femur", "post_washer_staple", { pilotDiameterMm: [1.5, 6], note: "Leg spacing and footprint require exact device data." }, { fullThickness: false })]),
  preset("let-transosseous", "LET", "Transosseous fixation", "Short full channel with anatomy-derived length.", [seed("transosseous", "LET transosseous tunnel", "femur", "round_full_tunnel", round([3, 7]))]),
  preset("let-no-large-tunnel-onlay", "LET", "No-large-tunnel onlay", "No graft-sized tunnel; an editable small anchor preparation pilot is shown and remains device-unverified.", [anchorSocketPilotSeed("anchor", "LET onlay anchor socket/pilot", "femur", [1.5, 5.5])]),
  preset("let-custom", "LET", "Custom LET", "Unconstrained editable LET construct.", [seed("custom", "Custom LET fixation", "custom", "custom", round([1.5, 8], [5, 35]))], "custom"),

  ...rootPresets("MEDIAL_ROOT", "medial-root"),
  ...rootPresets("LATERAL_ROOT", "lateral-root"),

  preset("custom-construct", "CUSTOM", "Custom construct", "Unconstrained patient-space channel with all selections explicit.", [seed("custom", "Custom channel", "custom", "custom", round([1, 20], [1, 80]))], "custom"),
] as const;

const PRESET_BY_ID = new Map(TECHNIQUE_PRESETS.map((item) => [item.id, item]));

export function getTechniquePreset(id: string): TechniquePreset | undefined {
  return PRESET_BY_ID.get(id);
}

export function getTechniquePresetsForProcedure(procedure: ProcedureIdentity): TechniquePreset[] {
  return TECHNIQUE_PRESETS.filter((item) => item.procedure === procedure);
}

export interface InstantiateTechniquePresetOptions {
  procedureId?: UUID;
  createId?: () => UUID;
  createdAt?: string;
  catalogVersion?: string;
  geometryGeneratorVersion?: string;
}

export interface InstantiatedTechniquePreset {
  procedure: ProcedureInstance;
  channels: ChannelPlan[];
}

const defaultCreateId = (): UUID => globalThis.crypto.randomUUID();

const requiredChainSelections = [
  "region/institution set",
  "manufacturer or Generic/Institution Defined",
  "product family",
  "exact product/model/SKU",
  "guide and side",
  "hook/arm/offset/angle",
  "sleeve/bullet/depth stop",
  "pin",
  "drill/reamer/cutter/dilator/punch/tap",
  "exact size/profile",
  "depth/full-tunnel setting",
  "graft",
  "fixation implant and preparation",
] as const;

export function createIncompleteInstrumentChain(
  id: UUID,
  catalogVersion = "1.0.0",
): InstrumentChain {
  return {
    id,
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
    catalogVersion,
    userVerified: false,
    verification: null,
    completionState: "incomplete",
    missingSelections: [...requiredChainSelections],
  };
}

const geometryLayerKinds: readonly GeometryLayerKind[] = [
  "bone_removal_or_compaction",
  "pin_tract_and_overshoot",
  "instrument_access_swept_volume",
  "cutter_deployment_retraction",
  "graft_or_bone_block",
  "retained_fixation",
  "surface_hardware_flip_deployment",
  "safety_margin",
];

const createCrossSection = (kind: CrossSectionKind, initialDiameterMm?: number): CrossSection => {
  switch (kind) {
    case "circle": return { kind, diameterMm: initialDiameterMm ?? null };
    case "ellipse": return { kind, majorMm: null, minorMm: null, rotationDeg: 0 };
    case "stadium": return { kind, widthMm: null, heightMm: null, rotationDeg: 0 };
    case "rectangle": return { kind, widthMm: null, heightMm: null, rotationDeg: 0 };
    case "rounded_rectangle": return { kind, widthMm: null, heightMm: null, cornerRadiusMm: null, rotationDeg: 0 };
    case "c_profile": return { kind, outerRadiusMm: null, innerRadiusMm: null, openingDeg: null, rotationDeg: 0 };
    case "slot_ribbon": return { kind, widthMm: null, thicknessMm: null, rotationDeg: 0 };
    case "polygon": return { kind, pointsMm: [], rotationDeg: 0 };
    case "imported_profile": return { kind, assetId: "", scaleMmPerUnit: null, pointsSourceUnits: [], rotationDeg: 0 };
  }
};

export function instantiateTechniquePreset(
  presetOrId: TechniquePreset | string,
  options: InstantiateTechniquePresetOptions = {},
): InstantiatedTechniquePreset {
  const selectedPreset = typeof presetOrId === "string" ? getTechniquePreset(presetOrId) : presetOrId;
  if (!selectedPreset) throw new Error(`Unknown technique preset: ${String(presetOrId)}`);

  const createId = options.createId ?? defaultCreateId;
  const procedureId = options.procedureId ?? createId();
  const createdAt = options.createdAt ?? new Date().toISOString();
  const geometryGeneratorVersion = options.geometryGeneratorVersion ?? "1.2.0";

  const instantiated = selectedPreset.channelSeeds.map((channelSeed) => {
    const channelId = createId();
    const initialPlanningValues = channelSeed.initialPlanningValues;
    const guidePinSocket = [
      "antegrade_blind_socket",
      "retrograde_socket",
      "flexible_reamed_socket",
      "stepped_button_tunnel",
    ].includes(channelSeed.geometryType);
    const layers: GeometryLayer[] = geometryLayerKinds.map((kind) => ({
      id: createId(),
      channelId,
      kind,
      label: kind.replaceAll("_", " "),
      visible: kind === "bone_removal_or_compaction" || kind === "pin_tract_and_overshoot",
      analyzable: true,
      geometryGeneratorVersion,
      missingParameters: channelSeed.noLargeTunnel
        ? ["exact fixation selection"]
        : ["aperture", "vector", "exact dimensions", "instrument chain"],
    }));
    const isFlexible = channelSeed.geometryType === "flexible_reamed_socket" || channelSeed.geometryType === "flexible_pin";
    const warnings = [
      initialPlanningValues?.provenance === "clinician_entered_planning_value"
        ? "Diameter and depth were entered by the clinician for this planning geometry; no device or instrument was selected."
        : "Generic ranges are editable UI seeds, not recommendations or final plan values.",
      "Geometry is not evaluated until exact dimensions and required anatomy are present.",
      ...(channelSeed.warnings ?? []),
      ...(guidePinSocket && initialPlanningValues?.guidePinDiameterMm === undefined
        ? ["The displayed 3.5 mm guide pin is an editable generic parametric display seed, not a selected device, recommendation, or verified catalog dimension."]
        : []),
    ];

    const channel: ChannelPlan = {
      id: channelId,
      semanticKey: channelSeed.key,
      label: channelSeed.label,
      procedureId,
      bone: channelSeed.bone,
      geometryType: channelSeed.geometryType,
      crossSection: createCrossSection(channelSeed.crossSectionKind, initialPlanningValues?.diameterMm),
      aperture: [0, 0, 0],
      vector: [0, 0, 1],
      centerline: isFlexible
        ? {
            kind: "flexible",
            aperturePatientRasMm: [0, 0, 0],
            intraosseousDirectionPatientRas: [0, 0, 1],
            accessControlPointsPatientRasMm: [],
            minimumBendRadiusMm: null,
          }
        : { kind: "rigid", aperturePatientRasMm: [0, 0, 0], directionPatientRas: [0, 0, 1] },
      trajectoryControlMode: channelSeed.trajectoryControlMode
        ?? (channelSeed.geometryType === "anchor_pilot"
          ? "exterior_rod"
          : channelSeed.noLargeTunnel || channelSeed.geometryType === "onlay_no_large_tunnel"
            ? "none"
            : "outer_cortex_surface"),
      guidePin: initialPlanningValues?.guidePinDiameterMm !== undefined || guidePinSocket
        ? {
            diameterMm: initialPlanningValues?.guidePinDiameterMm ?? 3.5,
            provenance: initialPlanningValues?.guidePinProvenance
              ?? initialPlanningValues?.provenance
              ?? "generic_parametric_visual_seed",
          }
        : null,
      surfacePlacement: {
        state: "pending_default",
        method: "preset_seed_unregistered",
        meshIds: [],
        endpointMethod: "not_available",
      },
      depthMm: initialPlanningValues?.depthMm ?? null,
      ...(initialPlanningValues ? { diameterMm: initialPlanningValues.diameterMm } : {}),
      orientationDeg: 0,
      fullThickness: channelSeed.fullThickness,
      preparationMode: channelSeed.preparationMode,
      tipOvershootMm: null,
      noLargeTunnel: channelSeed.noLargeTunnel ?? false,
      genericSeed: {
        ...channelSeed.genericSeed,
        ...(guidePinSocket && !channelSeed.genericSeed.pilotDiameterMm
          ? { pilotDiameterMm: [1, 6] as const }
          : {}),
      },
      instrumentChain: createIncompleteInstrumentChain(createId(), options.catalogVersion),
      graft: null,
      fixation: [],
      layers,
      intentionalRelationshipIds: [],
      verificationState: initialPlanningValues?.provenance === "clinician_entered_planning_value"
        ? "needs_instrument_chain"
        : "needs_dimensions",
      warnings,
    };
    return { seed: channelSeed, channel };
  });

  const constructLabels = [...new Set(instantiated.map(({ seed: item }) => item.constructLabel))];
  const constructs = constructLabels.map((constructLabel) => {
    const constructId = createId();
    const channels = instantiated.filter(({ seed: item }) => item.constructLabel === constructLabel);
    channels.forEach(({ channel }) => { channel.constructId = constructId; });
    return {
      id: constructId,
      procedureId,
      name: constructLabel,
      footprintIds: [],
      channelIds: channels.map(({ channel }) => channel.id),
      relationshipIds: [],
    };
  });

  return {
    procedure: {
      id: procedureId,
      structure: selectedPreset.procedure,
      techniquePresetId: selectedPreset.id,
      techniqueName: selectedPreset.name,
      presetVersion: selectedPreset.version,
      constructs,
      footprints: [],
      createdAt,
    },
    channels: instantiated.map(({ channel }) => channel),
  };
}
