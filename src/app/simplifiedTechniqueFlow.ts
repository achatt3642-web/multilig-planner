import type {
  Bone,
  ChannelPlan,
  PlanCase,
  ProcedureIdentity,
  ProcedureInstance,
  SequenceStep,
} from "../domain/types";
import {
  instantiateTechniquePreset,
  type TechniqueChannelSeed,
  type TechniquePreset,
} from "../presets/techniquePresets";
import { activeVariant } from "./planOperations";

export type SimplifiedProcedureIdentity = Exclude<ProcedureIdentity, "CUSTOM">;
export type BundleChoice = "single_bundle" | "double_bundle";
export type PreparationChoice =
  | "socket_with_guide_pin"
  | "full_tunnel"
  | "anchor"
  | "onlay_fixation_point"
  | "suture_anchor_location"
  | "none"
  | "laprade_full_tunnel"
  | "posterior_socket_with_guide_pin";

export interface SimplifiedBoneChoice {
  bundle: BundleChoice | null;
  preparation: PreparationChoice | null;
  count: number | null;
  diameterMm: number | null;
  depthMm: number | null;
}

export interface SimplifiedTechniqueSelection {
  procedure: SimplifiedProcedureIdentity;
  rootLocation: "anterior" | "posterior" | null;
  femur: SimplifiedBoneChoice | null;
  tibia: SimplifiedBoneChoice | null;
}

export interface SimplifiedFlowStep {
  bone: "femur" | "tibia";
  title: string;
}

export const SIMPLIFIED_PROCEDURES: readonly { id: SimplifiedProcedureIdentity; label: string }[] = [
  { id: "ACL", label: "ACL" },
  { id: "PCL", label: "PCL" },
  { id: "MCL_POL_PMC", label: "MCL" },
  { id: "ALL", label: "ALL" },
  { id: "LET", label: "LET" },
  { id: "MEDIAL_ROOT", label: "Medial root" },
  { id: "LATERAL_ROOT", label: "Lateral root" },
  { id: "PLC_FCL", label: "PLC" },
] as const;

export const SIMPLIFIED_TECHNIQUE_NOTE_PREFIX = "multilig:simplified-technique:v1:";

const emptyBone = (): SimplifiedBoneChoice => ({
  bundle: null,
  preparation: null,
  count: null,
  diameterMm: null,
  depthMm: null,
});

export function createEmptySimplifiedSelection(
  procedure: SimplifiedProcedureIdentity,
): SimplifiedTechniqueSelection {
  return {
    procedure,
    rootLocation: null,
    femur: ["ACL", "PCL", "MCL_POL_PMC", "ALL", "LET", "PLC_FCL"].includes(procedure)
      ? emptyBone()
      : null,
    tibia: ["ACL", "PCL", "MCL_POL_PMC", "ALL", "MEDIAL_ROOT", "LATERAL_ROOT", "PLC_FCL"].includes(procedure)
      ? emptyBone()
      : null,
  };
}

export function flowStepsFor(
  selectionOrProcedure: SimplifiedTechniqueSelection | SimplifiedProcedureIdentity,
): SimplifiedFlowStep[] {
  const procedure = typeof selectionOrProcedure === "string"
    ? selectionOrProcedure
    : selectionOrProcedure.procedure;
  switch (procedure) {
    case "LET": return [{ bone: "femur", title: "Femur" }];
    case "MEDIAL_ROOT":
    case "LATERAL_ROOT": return [{ bone: "tibia", title: "Tibia" }];
    default: return [{ bone: "femur", title: "Femur" }, { bone: "tibia", title: "Tibia" }];
  }
}

const positive = (value: number | null): boolean => value !== null && Number.isFinite(value) && value > 0;
const positiveInteger = (value: number | null): boolean => positive(value) && Number.isInteger(value);

function validateBone(
  selection: SimplifiedTechniqueSelection,
  bone: Bone,
): string[] {
  const choice = bone === "femur" ? selection.femur : selection.tibia;
  if (!choice) return [`${bone} planning is unavailable for ${selection.procedure}`];
  const label = bone === "femur" ? "Femur" : "Tibia";
  const errors: string[] = [];
  if (["ACL", "PCL"].includes(selection.procedure) && !choice.bundle) {
    errors.push(`${label}: choose single- or double-bundle.`);
  }
  if (!choice.preparation) errors.push(`${label}: choose a preparation.`);
  if (choice.preparation === "anchor") {
    if (!positive(choice.diameterMm)) errors.push(`${label}: enter an anchor drill diameter greater than 0 mm.`);
    if (!positive(choice.depthMm)) errors.push(`${label}: enter an anchor length / drill depth greater than 0 mm.`);
  }
  if (
    selection.procedure === "PLC_FCL" && bone === "femur" &&
    ["anchor", "socket_with_guide_pin"].includes(choice.preparation ?? "") &&
    !positiveInteger(choice.count)
  ) errors.push("Femur: enter a whole number of anchors or sockets.");
  if (
    selection.procedure === "MCL_POL_PMC" &&
    choice.preparation === "anchor" &&
    !positiveInteger(choice.count)
  ) errors.push(`${label}: enter a whole number of anchors.`);
  return errors;
}

export function validateSimplifiedStep(
  selection: SimplifiedTechniqueSelection,
  stepIndex: number,
): string[] {
  const step = flowStepsFor(selection)[stepIndex];
  if (!step) return ["Unknown technique step."];
  const errors = validateBone(selection, step.bone);
  if (
    step.bone === "tibia" &&
    ["MEDIAL_ROOT", "LATERAL_ROOT"].includes(selection.procedure) &&
    !selection.rootLocation
  ) errors.unshift("Choose anterior or posterior root.");
  return errors;
}

export function validateSimplifiedSelection(selection: SimplifiedTechniqueSelection): string[] {
  return flowStepsFor(selection).flatMap((_, index) => validateSimplifiedStep(selection, index));
}

const genericRange = (
  diameterMm: readonly [number, number],
  depthMm: readonly [number, number],
  pilotDiameterMm?: readonly [number, number],
) => ({ diameterMm, depthMm, ...(pilotDiameterMm ? { pilotDiameterMm } : {}) });

export const DEFAULT_GENERIC_SOCKET_GUIDE_PIN_DIAMETER_MM = 3.5;
export const GENERIC_SOCKET_GUIDE_PIN_WARNING =
  "The displayed 3.5 mm guide pin is an editable generic parametric display seed, not a selected device, recommendation, or verified catalog dimension.";

interface SeedOptions {
  label: string;
  key: string;
  bone: Bone;
  preparation: PreparationChoice;
  diameterRange: readonly [number, number];
  depthRange: readonly [number, number];
  visualDiameterMm?: number;
  visualDepthMm?: number;
  clinicianDiameterMm?: number;
  clinicianDepthMm?: number;
  trajectoryControlMode?: NonNullable<ChannelPlan["trajectoryControlMode"]>;
  warnings?: string[];
}

function channelSeed(options: SeedOptions): TechniqueChannelSeed {
  const pointOnly = options.preparation === "onlay_fixation_point" || options.preparation === "suture_anchor_location";
  const fullTunnel = options.preparation === "full_tunnel" || options.preparation === "laprade_full_tunnel";
  const anchor = options.preparation === "anchor";
  const socket = options.preparation === "socket_with_guide_pin" || options.preparation === "posterior_socket_with_guide_pin";
  const geometryType: ChannelPlan["geometryType"] = pointOnly
    ? "onlay_no_large_tunnel"
    : fullTunnel
      ? "round_full_tunnel"
      : anchor
        ? "anchor_pilot"
        : socket
          ? "antegrade_blind_socket"
          : "custom";
  const diameterMm = options.clinicianDiameterMm ?? options.visualDiameterMm;
  const depthMm = options.clinicianDepthMm ?? options.visualDepthMm;
  return {
    key: options.key,
    label: options.label,
    constructLabel: options.label,
    bone: options.bone,
    geometryType,
    crossSectionKind: "circle",
    genericSeed: genericRange(
      options.diameterRange,
      options.depthRange,
      socket ? [1, 6] : undefined,
    ),
    fullThickness: fullTunnel,
    preparationMode: pointOnly ? "none" : "cut",
    trajectoryControlMode: options.trajectoryControlMode
      ?? (pointOnly ? "none" : anchor ? "exterior_rod" : "outer_cortex_surface"),
    ...(diameterMm !== undefined && depthMm !== undefined ? {
      initialPlanningValues: {
        diameterMm,
        depthMm,
        ...(socket ? {
          guidePinDiameterMm: DEFAULT_GENERIC_SOCKET_GUIDE_PIN_DIAMETER_MM,
          guidePinProvenance: "generic_parametric_visual_seed" as const,
        } : {}),
        provenance: options.clinicianDiameterMm !== undefined
          ? "clinician_entered_planning_value" as const
          : "generic_parametric_visual_seed" as const,
      },
    } : {}),
    noLargeTunnel: pointOnly,
    warnings: [
      ...(options.warnings ?? []),
      ...(socket ? [GENERIC_SOCKET_GUIDE_PIN_WARNING] : []),
      ...(pointOnly ? ["Point-only fixation location; no bone tunnel or socket has been created."] : []),
    ],
  };
}

const bundleRoles = (procedure: "ACL" | "PCL", choice: SimplifiedBoneChoice): string[] => {
  if (choice.bundle === "double_bundle") return procedure === "ACL" ? ["AM", "PL"] : ["AL", "PM"];
  return [""];
};

function cruciateSeeds(
  procedure: "ACL" | "PCL",
  bone: "femur" | "tibia",
  choice: SimplifiedBoneChoice,
): TechniqueChannelSeed[] {
  if (!choice.preparation) return [];
  if (procedure === "PCL" && bone === "tibia" && choice.preparation === "onlay_fixation_point") {
    return [channelSeed({
      key: "tibia-onlay",
      label: "PCL tibial onlay fixation point",
      bone,
      preparation: choice.preparation,
      diameterRange: [0.5, 1],
      depthRange: [0.5, 1],
    })];
  }
  const diameterRange = procedure === "ACL" ? [7, 12] as const : [8, 12.5] as const;
  const depthRange = bone === "femur" ? [15, 35] as const : [20, 45] as const;
  return bundleRoles(procedure, choice).map((role, index) => channelSeed({
    key: `${bone}-${role || "single"}-${index + 1}`,
    label: `${procedure} ${bone}${role ? ` ${role}` : ""} ${choice.preparation === "full_tunnel" ? "full tunnel" : "socket"}`,
    bone,
    preparation: choice.preparation!,
    diameterRange,
    depthRange,
    visualDiameterMm: procedure === "ACL" ? (choice.bundle === "double_bundle" ? 7 : 9) : (choice.bundle === "double_bundle" ? 7 : 10),
    visualDepthMm: choice.preparation === "full_tunnel" ? depthRange[1] : Math.min(30, depthRange[1]),
    warnings: procedure === "PCL" && bone === "tibia"
      ? ["Posterior pin exit requires clinician review."]
      : undefined,
  }));
}

function anchorOrSocketSeeds(
  selection: SimplifiedTechniqueSelection,
  bone: "femur" | "tibia",
  choice: SimplifiedBoneChoice,
): TechniqueChannelSeed[] {
  if (!choice.preparation) return [];
  const name = selection.procedure === "MCL_POL_PMC"
    ? "MCL"
    : selection.procedure === "PLC_FCL"
      ? "PLC"
      : selection.procedure;
  const count = selection.procedure === "PLC_FCL"
    ? choice.count ?? 0
    : selection.procedure === "MCL_POL_PMC" && choice.preparation === "anchor"
      ? choice.count ?? 0
      : 1;
  const diameterRange = selection.procedure === "ALL"
    ? [3.5, 7] as const
    : selection.procedure === "LET"
      ? [4.5, 8] as const
      : selection.procedure === "PLC_FCL"
        ? [4, 9] as const
        : [4, 8] as const;
  const depthRange = selection.procedure === "ALL"
    ? [15, 30] as const
    : selection.procedure === "LET"
      ? [15, 35] as const
      : [15, 40] as const;
  return Array.from({ length: count }, (_, index) => channelSeed({
    key: `${bone}-${choice.preparation}-${index + 1}`,
    label: `${name} ${bone} ${choice.preparation === "anchor" ? "anchor" : "socket"}${count > 1 ? ` ${index + 1}` : ""}`,
    bone,
    preparation: choice.preparation!,
    trajectoryControlMode: choice.preparation === "socket_with_guide_pin"
      ? "blind_socket_tip"
      : undefined,
    diameterRange,
    depthRange,
    ...(choice.preparation === "anchor" ? {
      clinicianDiameterMm: choice.diameterMm!,
      clinicianDepthMm: choice.depthMm!,
    } : {
      visualDiameterMm: (diameterRange[0] + diameterRange[1]) / 2,
      visualDepthMm: (depthRange[0] + depthRange[1]) / 2,
    }),
  }));
}

function rootSeeds(selection: SimplifiedTechniqueSelection): TechniqueChannelSeed[] {
  const choice = selection.tibia!;
  if (!choice.preparation || !selection.rootLocation) return [];
  const side = selection.procedure === "MEDIAL_ROOT" ? "Medial" : "Lateral";
  const preparationLabel = choice.preparation === "suture_anchor_location"
    ? "suture anchor location"
    : choice.preparation === "full_tunnel"
      ? "full tunnel"
      : "socket";
  return [channelSeed({
    key: `${selection.rootLocation}-${choice.preparation}`,
    label: `${side} ${selection.rootLocation} root ${preparationLabel}`,
    bone: "tibia",
    preparation: choice.preparation,
    diameterRange: choice.preparation === "socket_with_guide_pin" ? [5, 7] : [2.4, 4.5],
    depthRange: choice.preparation === "socket_with_guide_pin" ? [5, 15] : [20, 45],
    ...(choice.preparation === "suture_anchor_location" ? {} : {
      visualDiameterMm: choice.preparation === "socket_with_guide_pin" ? 6 : 3.5,
      visualDepthMm: choice.preparation === "socket_with_guide_pin" ? 10 : 35,
    }),
  })];
}

function plcTibialSeeds(choice: SimplifiedBoneChoice): TechniqueChannelSeed[] {
  if (!choice.preparation || choice.preparation === "none") return [];
  return [channelSeed({
    key: `tibia-${choice.preparation}`,
    label: choice.preparation === "laprade_full_tunnel"
      ? "PLC tibial LaPrade-style full tunnel"
      : "PLC tibial posterior socket",
    bone: "tibia",
    preparation: choice.preparation,
    trajectoryControlMode: choice.preparation === "posterior_socket_with_guide_pin"
      ? "blind_socket_tip"
      : undefined,
    diameterRange: [6, 10],
    depthRange: [20, 45],
    visualDiameterMm: 8,
    visualDepthMm: choice.preparation === "laprade_full_tunnel" ? 45 : 30,
  })];
}

export function buildSimplifiedTechniquePreset(selection: SimplifiedTechniqueSelection): TechniquePreset {
  const errors = validateSimplifiedSelection(selection);
  if (errors.length) throw new Error(errors.join(" "));
  let channelSeeds: TechniqueChannelSeed[];
  switch (selection.procedure) {
    case "ACL":
    case "PCL":
      channelSeeds = [
        ...cruciateSeeds(selection.procedure, "femur", selection.femur!),
        ...cruciateSeeds(selection.procedure, "tibia", selection.tibia!),
      ];
      break;
    case "MCL_POL_PMC":
    case "ALL":
      channelSeeds = [
        ...anchorOrSocketSeeds(selection, "femur", selection.femur!),
        ...anchorOrSocketSeeds(selection, "tibia", selection.tibia!),
      ];
      break;
    case "LET":
      channelSeeds = anchorOrSocketSeeds(selection, "femur", selection.femur!);
      break;
    case "MEDIAL_ROOT":
    case "LATERAL_ROOT":
      channelSeeds = rootSeeds(selection);
      break;
    case "PLC_FCL":
      channelSeeds = [
        ...anchorOrSocketSeeds(selection, "femur", selection.femur!),
        ...plcTibialSeeds(selection.tibia!),
      ];
      break;
  }
  return {
    id: `simplified-${selection.procedure.toLowerCase().replaceAll("_", "-")}`,
    version: 1,
    procedure: selection.procedure,
    name: `${SIMPLIFIED_PROCEDURES.find((item) => item.id === selection.procedure)?.label ?? selection.procedure} reconstruction plan`,
    description: "Clinician-configured bone preparations from the simplified sequential workflow.",
    provenance: "custom",
    channelSeeds,
  };
}

export function readSimplifiedSelection(
  procedure: ProcedureInstance | null | undefined,
): SimplifiedTechniqueSelection | null {
  if (!procedure?.notes?.startsWith(SIMPLIFIED_TECHNIQUE_NOTE_PREFIX)) return null;
  try {
    const value = JSON.parse(procedure.notes.slice(SIMPLIFIED_TECHNIQUE_NOTE_PREFIX.length)) as SimplifiedTechniqueSelection;
    if (!SIMPLIFIED_PROCEDURES.some((item) => item.id === value.procedure)) return null;
    return value;
  } catch {
    return null;
  }
}

function sequenceFor(channels: readonly ChannelPlan[], startOrder: number): SequenceStep[] {
  const steps: SequenceStep[] = channels.flatMap((channel) => [
    {
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "pin" as const,
      label: `Place ${channel.label}`,
      order: 0,
      completed: false,
    },
    {
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "ream" as const,
      label: channel.noLargeTunnel ? `Mark ${channel.label}` : `Prepare ${channel.label}`,
      order: 0,
      completed: false,
    },
  ]);
  return steps.map((step, index) => ({ ...step, order: startOrder + index }));
}

interface SemanticChannel {
  channel: ChannelPlan;
  seed: TechniqueChannelSeed | null;
  boneOrdinal: number;
  bundleRole: "AM" | "PL" | "AL" | "PM" | "single" | null;
  preparation: "point" | "anchor" | "socket" | "full_tunnel" | "other";
}

function bundleRoleFor(seed: TechniqueChannelSeed | null, channel: ChannelPlan): SemanticChannel["bundleRole"] {
  const value = `${seed?.key ?? channel.semanticKey ?? ""} ${seed?.label ?? channel.label}`;
  for (const role of ["AM", "PL", "AL", "PM"] as const) {
    if (new RegExp(`(?:^|[\\s-])${role}(?:$|[\\s-])`, "i").test(value)) return role;
  }
  return /(?:^|[\s-])single(?:$|[\s-])/i.test(value) ? "single" : null;
}

function preparationFor(channel: ChannelPlan): SemanticChannel["preparation"] {
  if (channel.noLargeTunnel || channel.geometryType === "onlay_no_large_tunnel") return "point";
  if (channel.geometryType === "anchor_pilot") return "anchor";
  if (channel.geometryType === "round_full_tunnel") return "full_tunnel";
  if ([
    "antegrade_blind_socket",
    "retrograde_socket",
    "flexible_reamed_socket",
    "stepped_button_tunnel",
  ].includes(channel.geometryType)) return "socket";
  return "other";
}

function orderedProcedureChannels(
  procedure: ProcedureInstance,
  channels: readonly ChannelPlan[],
): ChannelPlan[] {
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const orderedIds = procedure.constructs.flatMap((construct) => construct.channelIds);
  const ordered = orderedIds.flatMap((id) => {
    const channel = channelById.get(id);
    return channel ? [channel] : [];
  });
  const seen = new Set(ordered.map((channel) => channel.id));
  return [
    ...ordered,
    ...channels.filter((channel) => channel.procedureId === procedure.id && !seen.has(channel.id)),
  ];
}

function semanticChannelsForProcedure(
  procedure: ProcedureInstance,
  channels: readonly ChannelPlan[],
): SemanticChannel[] {
  const ordered = orderedProcedureChannels(procedure, channels);
  const selection = readSimplifiedSelection(procedure);
  let seeds: readonly TechniqueChannelSeed[] = [];
  if (selection && validateSimplifiedSelection(selection).length === 0) {
    seeds = buildSimplifiedTechniquePreset(selection).channelSeeds;
  }
  const unusedSeeds = new Set(seeds.map((_, index) => index));
  const seedForChannel = (channel: ChannelPlan, index: number): TechniqueChannelSeed | null => {
    const semanticIndex = seeds.findIndex((seed, seedIndex) =>
      unusedSeeds.has(seedIndex) && seed.key === channel.semanticKey,
    );
    const labelIndex = semanticIndex >= 0 ? semanticIndex : seeds.findIndex((seed, seedIndex) =>
      unusedSeeds.has(seedIndex) && seed.label === channel.label,
    );
    const boneIndex = labelIndex >= 0 ? labelIndex : seeds.findIndex((seed, seedIndex) =>
      unusedSeeds.has(seedIndex) && seed.bone === channel.bone,
    );
    const resolvedIndex = boneIndex >= 0 ? boneIndex : (unusedSeeds.has(index) ? index : -1);
    if (resolvedIndex < 0) return null;
    unusedSeeds.delete(resolvedIndex);
    return seeds[resolvedIndex];
  };
  const boneCounts = new Map<Bone, number>();
  return ordered.map((channel, index) => {
    const boneOrdinal = boneCounts.get(channel.bone) ?? 0;
    boneCounts.set(channel.bone, boneOrdinal + 1);
    const seed = seedForChannel(channel, index);
    return {
      channel,
      seed,
      boneOrdinal,
      bundleRole: bundleRoleFor(seed, channel),
      preparation: preparationFor(channel),
    };
  });
}

function semanticChannelsForInstantiated(
  channels: readonly ChannelPlan[],
  seeds: readonly TechniqueChannelSeed[],
): SemanticChannel[] {
  const boneCounts = new Map<Bone, number>();
  return channels.map((channel, index) => {
    const boneOrdinal = boneCounts.get(channel.bone) ?? 0;
    boneCounts.set(channel.bone, boneOrdinal + 1);
    const seed = seeds[index] ?? null;
    return {
      channel,
      seed,
      boneOrdinal,
      bundleRole: bundleRoleFor(seed, channel),
      preparation: preparationFor(channel),
    };
  });
}

function semanticMatchScore(next: SemanticChannel, prior: SemanticChannel): number {
  if (next.channel.bone !== prior.channel.bone) return Number.NEGATIVE_INFINITY;
  let score = 1;
  if (next.seed?.key && next.seed.key === (prior.seed?.key ?? prior.channel.semanticKey)) score += 1_000;
  if (next.bundleRole && next.bundleRole === prior.bundleRole) score += 300;
  if (next.preparation === prior.preparation) score += 120;
  if (next.channel.geometryType === prior.channel.geometryType) score += 60;
  if (next.boneOrdinal === prior.boneOrdinal) score += 200;
  score -= Math.abs(next.boneOrdinal - prior.boneOrdinal) * 10;
  return score;
}

function explicitSeedValueChanged(
  next: SemanticChannel,
  prior: SemanticChannel,
  field: "diameterMm" | "depthMm",
): boolean {
  const nextValues = next.seed?.initialPlanningValues;
  if (nextValues?.provenance !== "clinician_entered_planning_value") return false;
  const priorValues = prior.seed?.initialPlanningValues;
  return priorValues?.provenance !== "clinician_entered_planning_value" ||
    priorValues[field] !== nextValues[field];
}

function withPreservedClinicalGeometry(
  next: SemanticChannel,
  prior: SemanticChannel,
): ChannelPlan {
  const nextChannel = next.channel;
  const priorChannel = prior.channel;
  const isPoint = next.preparation === "point";
  const compatibleCrossSection = !isPoint && nextChannel.crossSection.kind === priorChannel.crossSection.kind;
  const preserveDiameter = compatibleCrossSection &&
    !explicitSeedValueChanged(next, prior, "diameterMm");
  const preserveDepth = !isPoint && priorChannel.depthMm !== null &&
    !explicitSeedValueChanged(next, prior, "depthMm");
  const sameGeometryType = nextChannel.geometryType === priorChannel.geometryType;

  return {
    ...nextChannel,
    // Entry and trajectory are clinician-authored patient-space geometry. They
    // remain authoritative even when the selected preparation type changes.
    aperture: structuredClone(priorChannel.aperture),
    vector: structuredClone(priorChannel.vector),
    centerline: structuredClone(priorChannel.centerline),
    apertureSurfaceAttachment: structuredClone(priorChannel.apertureSurfaceAttachment ?? null),
    endpointSurfaceAttachment: structuredClone(priorChannel.endpointSurfaceAttachment ?? null),
    surfacePlacement: priorChannel.surfacePlacement
      ? structuredClone(priorChannel.surfacePlacement)
      : nextChannel.surfacePlacement,
    ...(preserveDiameter ? {
      crossSection: structuredClone(priorChannel.crossSection),
      ...(priorChannel.diameterMm !== undefined ? { diameterMm: priorChannel.diameterMm } : {}),
    } : {}),
    ...(preserveDepth ? { depthMm: priorChannel.depthMm } : {}),
    ...(sameGeometryType && priorChannel.dimensionsMm
      ? { dimensionsMm: structuredClone(priorChannel.dimensionsMm) }
      : {}),
    ...(sameGeometryType ? {
      trajectoryControlMode: priorChannel.trajectoryControlMode ?? nextChannel.trajectoryControlMode,
      guidePin: structuredClone(priorChannel.guidePin ?? nextChannel.guidePin ?? null),
    } : {}),
    ...(compatibleCrossSection ? { orientationDeg: priorChannel.orientationDeg } : {}),
  };
}

function preserveMatchedProcedureGeometry(
  instantiatedChannels: readonly ChannelPlan[],
  seeds: readonly TechniqueChannelSeed[],
  oldProcedures: readonly ProcedureInstance[],
  activeChannels: readonly ChannelPlan[],
): ChannelPlan[] {
  const prior = oldProcedures.flatMap((procedure) =>
    semanticChannelsForProcedure(procedure, activeChannels),
  );
  const next = semanticChannelsForInstantiated(instantiatedChannels, seeds);
  const unusedPrior = new Set(prior.map((_, index) => index));
  return next.map((nextChannel) => {
    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const priorIndex of unusedPrior) {
      const score = semanticMatchScore(nextChannel, prior[priorIndex]);
      if (score > bestScore) {
        bestIndex = priorIndex;
        bestScore = score;
      }
    }
    if (bestIndex < 0 || !Number.isFinite(bestScore)) return nextChannel.channel;
    unusedPrior.delete(bestIndex);
    return withPreservedClinicalGeometry(nextChannel, prior[bestIndex]);
  });
}

export function replaceSimplifiedProcedure(
  plan: PlanCase,
  selection: SimplifiedTechniqueSelection,
): PlanCase {
  const preset = buildSimplifiedTechniquePreset(selection);
  const instantiated = instantiateTechniquePreset(preset, {
    catalogVersion: plan.catalogVersion,
    geometryGeneratorVersion: plan.geometryGeneratorVersion,
  });
  instantiated.procedure.notes = `${SIMPLIFIED_TECHNIQUE_NOTE_PREFIX}${JSON.stringify(selection)}`;
  const variant = activeVariant(plan);
  const oldProcedures = plan.procedures
    .filter((procedure) => procedure.structure === selection.procedure);
  const oldProcedureIds = new Set(oldProcedures.map((procedure) => procedure.id));
  const oldChannelIds = new Set(
    variant.channels
      .filter((channel) => oldProcedureIds.has(channel.procedureId))
      .map((channel) => channel.id),
  );
  const removedRelationshipIds = new Set(
    plan.intentionalRelationships
      .filter((relationship) => relationship.objectIds.some((id) => oldChannelIds.has(id)))
      .map((relationship) => relationship.id),
  );
  const retainedChannels = variant.channels
    .filter((channel) => !oldChannelIds.has(channel.id))
    .map((channel) => ({
      ...channel,
      intentionalRelationshipIds: channel.intentionalRelationshipIds.filter((id) => !removedRelationshipIds.has(id)),
    }));
  instantiated.channels = preserveMatchedProcedureGeometry(
    instantiated.channels,
    preset.channelSeeds,
    oldProcedures,
    variant.channels,
  );
  const retainedSequence = variant.sequence
    .filter((step) => !step.channelId || !oldChannelIds.has(step.channelId));
  const sequence = [
    ...retainedSequence,
    ...sequenceFor(instantiated.channels, retainedSequence.length),
  ].map((step, order) => ({ ...step, order }));
  const nextVariants = plan.variants.map((candidate) => candidate.id === plan.activeVariantId
    ? {
        ...candidate,
        channels: [...retainedChannels, ...instantiated.channels],
        sequence,
        analysis: candidate.analysis.filter((result) => !oldChannelIds.has(result.objectAId) && !oldChannelIds.has(result.objectBId)),
        updatedAt: new Date().toISOString(),
      }
    : candidate);
  const referencedProcedureIds = new Set(nextVariants.flatMap((candidate) => candidate.channels.map((channel) => channel.procedureId)));
  const now = new Date().toISOString();
  return {
    ...plan,
    procedures: [
      ...plan.procedures.filter((procedure) => !oldProcedureIds.has(procedure.id) || referencedProcedureIds.has(procedure.id)),
      instantiated.procedure,
    ],
    variants: nextVariants,
    intentionalRelationships: plan.intentionalRelationships.filter((relationship) => !removedRelationshipIds.has(relationship.id)),
    audit: [
      ...plan.audit,
      {
        id: crypto.randomUUID(),
        at: now,
        actorId: "local-clinician",
        action: "configure_simplified_reconstruction",
        entityType: "ProcedureInstance",
        entityId: instantiated.procedure.id,
        rationale: `Replaced the active ${selection.procedure} geometry with the clinician's sequential technique choices.`,
      },
    ],
    updatedAt: now,
  };
}
