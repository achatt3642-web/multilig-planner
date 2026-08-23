import type {
  ChannelPlan,
  InstrumentChain,
  PlanCase,
  PlanVariant,
  ProcedureIdentity,
  SequenceStep,
} from "../domain/types";
import {
  getTechniquePreset,
  instantiateTechniquePreset,
} from "../presets/techniquePresets";

const now = () => new Date().toISOString();

const LEGACY_PIN_OVERSHOOT_WARNING = "Posterior pin exit and overshoot require review before reaming.";
const PIN_EXIT_WARNING = "Posterior pin exit requires review before reaming.";
const LEGACY_ANCHOR_TEMPLATE_MARKER = "MAT-style generic anchor visual template migration applied.";

function legacyAnchorTemplate(channel: ChannelPlan): { diameterMm: number; depthMm: number } | null {
  const range = channel.genericSeed.diameterMm ?? channel.genericSeed.pilotDiameterMm;
  if (!range) return null;
  if (range[0] <= 4.75 && range[1] >= 4.75) return { diameterMm: 4.75, depthMm: 22 };
  if (range[0] <= 2.6 && range[1] >= 2.6) return { diameterMm: 2.6, depthMm: 20 };
  return null;
}

/**
 * One-time migration for anchor presets saved before they had a visible socket
 * template. The marker prevents a later clinician-cleared value from being
 * silently restored on another reload.
 */
export function restoreLegacyAnchorVisualTemplates(plan: PlanCase): PlanCase {
  let changed = false;
  const variants = plan.variants.map((variant) => {
    let variantChanged = false;
    const channels = variant.channels.map((channel) => {
      if (
        channel.geometryType !== "anchor_pilot" ||
        channel.depthMm !== null ||
        channel.diameterMm !== undefined ||
        channel.crossSection.kind !== "circle" ||
        channel.warnings.includes(LEGACY_ANCHOR_TEMPLATE_MARKER)
      ) return channel;
      const template = legacyAnchorTemplate(channel);
      if (!template) return channel;
      changed = true;
      variantChanged = true;
      return {
        ...channel,
        depthMm: template.depthMm,
        diameterMm: template.diameterMm,
        crossSection: { kind: "circle" as const, diameterMm: template.diameterMm },
        genericSeed: {
          ...channel.genericSeed,
          diameterMm: channel.genericSeed.diameterMm ?? channel.genericSeed.pilotDiameterMm,
          depthMm: channel.genericSeed.depthMm ?? [4, 30] as const,
        },
        verificationState: "needs_dimensions" as const,
        warnings: [
          ...channel.warnings,
          LEGACY_ANCHOR_TEMPLATE_MARKER,
          `The displayed ${template.diameterMm} × ${template.depthMm} mm socket is an editable generic visual planning seed, not a selected or device-verified preparation.`,
        ],
      };
    });
    return variantChanged ? { ...variant, channels } : variant;
  });
  if (!changed) return plan;
  return {
    ...plan,
    variants,
    audit: [
      ...plan.audit,
      {
        id: `anchor-template-migration-${plan.id}`,
        at: now(),
        actorId: "local-application",
        action: "restore_generic_anchor_visual_template",
        entityType: "PlanCase",
        entityId: plan.id,
        rationale: "Added a visible MAT-style generic anchor socket template while keeping dimensions and the exact device chain unresolved.",
      },
    ],
  };
}

/**
 * Clears the retired planning input while preserving the nullable field that
 * older plan documents still contain. This helper deliberately does not add
 * an audit event or change timestamps: callers use it while normalizing a
 * versioned document and own that migration provenance.
 */
export function removePinTipOvershootFromPlan(plan: PlanCase): PlanCase {
  let changed = false;
  const variants = plan.variants.map((variant) => {
    let variantChanged = false;
    const channels = variant.channels.map((channel) => {
      const hasLegacyWarning = channel.warnings.includes(LEGACY_PIN_OVERSHOOT_WARNING);
      if (channel.tipOvershootMm === null && !hasLegacyWarning) return channel;
      changed = true;
      variantChanged = true;
      return {
        ...channel,
        tipOvershootMm: null,
        warnings: hasLegacyWarning
          ? [...new Set(channel.warnings.map((warning) => warning === LEGACY_PIN_OVERSHOOT_WARNING ? PIN_EXIT_WARNING : warning))]
          : channel.warnings,
      };
    });
    return variantChanged ? { ...variant, channels } : variant;
  });
  return changed ? { ...plan, variants } : plan;
}

export function activeVariant(plan: PlanCase): PlanVariant {
  const variant = plan.variants.find((candidate) => candidate.id === plan.activeVariantId);
  if (!variant) throw new Error(`Active variant ${plan.activeVariantId} is missing`);
  return variant;
}

export function updateActiveVariant(
  plan: PlanCase,
  update: (variant: PlanVariant) => PlanVariant,
): PlanCase {
  const variants = plan.variants.map((variant) =>
    variant.id === plan.activeVariantId ? update(structuredClone(variant)) : variant,
  );
  return { ...plan, variants, updatedAt: now() };
}

export function updateChannel(
  plan: PlanCase,
  channelId: string,
  update: (channel: ChannelPlan) => ChannelPlan,
): PlanCase {
  return updateActiveVariant(plan, (variant) => ({
    ...variant,
    channels: variant.channels.map((channel) =>
      channel.id === channelId ? update(structuredClone(channel)) : channel,
    ),
    updatedAt: now(),
  }));
}

function makeSequenceSteps(channels: ChannelPlan[], startOrder: number): SequenceStep[] {
  const steps: SequenceStep[] = [];
  channels.forEach((channel) => {
    steps.push({
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "pin",
      label: `Place ${channel.label} virtual pin`,
      order: startOrder + steps.length,
      completed: false,
    });
  });
  steps.push({
    id: crypto.randomUUID(),
    kind: "inspect",
    label: `Inspect ${channels.length === 1 ? "virtual pin" : "all new virtual pins"} before reaming`,
    order: startOrder + steps.length,
    completed: false,
  });
  channels.forEach((channel) => {
    steps.push({
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "ream",
      label: `Prepare ${channel.label}`,
      order: startOrder + steps.length,
      completed: false,
    });
  });
  channels.forEach((channel) => {
    steps.push({
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "graft_pass",
      label: `Pass clinician-selected graft or repair construct for ${channel.label}`,
      order: startOrder + steps.length,
      completed: false,
    });
    steps.push({
      id: crypto.randomUUID(),
      channelId: channel.id,
      kind: "fixation",
      label: `Place clinician-selected fixation for ${channel.label}`,
      order: startOrder + steps.length,
      completed: false,
    });
  });
  return steps;
}

export function addTechniquePreset(plan: PlanCase, presetId: string): PlanCase {
  const preset = getTechniquePreset(presetId);
  if (!preset) throw new Error(`Unknown technique preset ${presetId}`);
  const instantiated = instantiateTechniquePreset(preset, {
    catalogVersion: plan.catalogVersion,
    geometryGeneratorVersion: plan.geometryGeneratorVersion,
  });
  const variant = activeVariant(plan);
  const addedSteps = makeSequenceSteps(instantiated.channels, variant.sequence.length);
  const existingPins = variant.sequence.filter((step) => step.kind === "pin");
  const addedPins = addedSteps.filter((step) => step.kind === "pin");
  const inspectStep = variant.sequence.find((step) => step.kind === "inspect")
    ?? addedSteps.find((step) => step.kind === "inspect");
  const remainingExisting = variant.sequence.filter((step) => step.kind !== "pin" && step.kind !== "inspect");
  const addedPreparation = addedSteps.filter((step) => step.kind !== "pin" && step.kind !== "inspect");
  const sequence = [
    ...existingPins,
    ...addedPins,
    ...(inspectStep ? [{ ...inspectStep, label: "Inspect all virtual pins and predicted exits before reaming" }] : []),
    ...remainingExisting,
    ...addedPreparation,
  ].map((step, order) => ({ ...step, order }));
  return {
    ...plan,
    procedures: [...plan.procedures, instantiated.procedure],
    variants: plan.variants.map((candidate) =>
      candidate.id === plan.activeVariantId
        ? {
            ...candidate,
            channels: [...candidate.channels, ...instantiated.channels],
            sequence,
            updatedAt: now(),
          }
        : candidate,
    ),
    audit: [
      ...plan.audit,
      {
        id: crypto.randomUUID(),
        at: now(),
        actorId: "local-clinician",
        action: "instantiate_technique_preset",
        entityType: "ProcedureInstance",
        entityId: instantiated.procedure.id,
        rationale: `${preset.name} used as an editable preset; no devices or dimensions selected.`,
      },
    ],
    updatedAt: now(),
  };
}

export function procedureLabel(procedure: ProcedureIdentity): string {
  return {
    ACL: "ACL",
    PCL: "PCL",
    PLC_FCL: "PLC/FCL",
    MCL_POL_PMC: "MCL/POL/PMC",
    ALL: "ALL",
    LET: "LET",
    MEDIAL_ROOT: "Medial Root",
    LATERAL_ROOT: "Lateral Root",
    CUSTOM: "Custom",
  }[procedure];
}

export function cloneActiveVariant(plan: PlanCase, name: string): PlanCase {
  const source = activeVariant(plan);
  const variantId = crypto.randomUUID();
  const clone: PlanVariant = {
    ...structuredClone(source),
    id: variantId,
    name,
    parentVariantId: source.id,
    createdAt: now(),
    updatedAt: now(),
  };
  return {
    ...plan,
    variants: [...plan.variants, clone],
    activeVariantId: variantId,
    audit: [
      ...plan.audit,
      {
        id: crypto.randomUUID(),
        at: now(),
        actorId: "local-clinician",
        action: "clone_plan_variant",
        entityType: "PlanVariant",
        entityId: variantId,
        rationale: `Cloned from ${source.name}`,
      },
    ],
    updatedAt: now(),
  };
}

export function setActiveVariant(plan: PlanCase, variantId: string): PlanCase {
  if (!plan.variants.some((variant) => variant.id === variantId)) return plan;
  return { ...plan, activeVariantId: variantId, updatedAt: now() };
}

export function reorderSequence(plan: PlanCase, fromIndex: number, toIndex: number): PlanCase {
  return updateActiveVariant(plan, (variant) => {
    if (fromIndex < 0 || fromIndex >= variant.sequence.length || toIndex < 0 || toIndex >= variant.sequence.length) {
      return variant;
    }
    const sequence = [...variant.sequence];
    const [moved] = sequence.splice(fromIndex, 1);
    sequence.splice(toIndex, 0, moved);
    return { ...variant, sequence: sequence.map((step, order) => ({ ...step, order })), updatedAt: now() };
  });
}

export const missingChainSelections = (chain: InstrumentChain): string[] => {
  const missing: string[] = [];
  if (!chain.regionInstitutionSetId) missing.push("region/institution set");
  if (!chain.manufacturerId) missing.push("manufacturer or Generic/Institution Defined");
  if (!chain.productFamilyId) missing.push("product family");
  if (!chain.productVariantId) missing.push("exact product/model/SKU");
  if (!chain.guideInstrumentId || !chain.guideSide) missing.push("guide and side");
  if (
    !chain.hookArmOffsetAngle.hookOrArmId ||
    chain.hookArmOffsetAngle.offsetMm === null ||
    !Number.isFinite(chain.hookArmOffsetAngle.offsetMm) ||
    chain.hookArmOffsetAngle.angleDeg === null ||
    !Number.isFinite(chain.hookArmOffsetAngle.angleDeg)
  ) missing.push("hook/arm/offset/angle");
  if (
    !chain.sleeveBulletDepthStop.sleeveOrBulletId ||
    chain.sleeveBulletDepthStop.depthStopMm === null ||
    !Number.isFinite(chain.sleeveBulletDepthStop.depthStopMm) ||
    chain.sleeveBulletDepthStop.depthStopMm < 0
  ) missing.push("sleeve/bullet/depth stop");
  if (!chain.pinInstrumentId) missing.push("pin");
  if (!chain.cutterInstrumentId) missing.push("drill/reamer/cutter/dilator/punch/tap");
  if (!chain.exactSizeOrProfileId) missing.push("exact size/profile");
  if (
    !chain.depthOrFullTunnelSetting.mode ||
    (chain.depthOrFullTunnelSetting.mode === "depth" && (
      chain.depthOrFullTunnelSetting.depthMm === null ||
      !Number.isFinite(chain.depthOrFullTunnelSetting.depthMm) ||
      chain.depthOrFullTunnelSetting.depthMm <= 0
    ))
  ) missing.push("depth/full-tunnel setting");
  if (!chain.graftSelectionId) missing.push("graft");
  if (!chain.fixationImplantIds.length || !chain.fixationPreparationInstrumentIds.length) missing.push("fixation implant and preparation");
  return missing;
};

export function finalizeChainState(chain: InstrumentChain): InstrumentChain {
  const missingSelections = missingChainSelections(chain);
  const isComplete = missingSelections.length === 0;
  return {
    ...chain,
    missingSelections,
    completionState: isComplete ? (chain.userVerified ? "complete" : "warning") : "incomplete",
  };
}
