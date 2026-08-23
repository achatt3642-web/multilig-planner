import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChannelPlan, PlanCase, ProcedureIdentity } from "./domain/types";
import { CURRENT_PLAN_SCHEMA_VERSION } from "./domain/schema";
import { MatViewerV2Adapter } from "./viewer/MatViewerV2Adapter";
import type {
  StandardView,
  ViewerHandleChange,
  ViewerLayer,
  ViewerMeshPayload,
  ViewerPlanningScene,
} from "./viewer/types";
import {
  DEFAULT_LAYER_VISIBILITY,
  buildSyntheticAnatomyMeshes,
  buildViewerScene,
} from "./app/channelGeometry";
import {
  applyChannelDepthGeometryEdit,
  applySurfaceConstrainedHandleCommit,
} from "./app/channelHandleEdit";
import { isGuidePinSocketGeometry, resolvedTrajectoryControlMode } from "./app/channelTrajectorySemantics";
import { resolvedChannelGuidePinDiameterMm } from "./app/resolvedChannelGeometry";
import { initializePendingChannelSurfacePlacements } from "./app/channelSurfaceInitialization";
import {
  autoConfigureSimplifiedProcedure,
  configuredSimplifiedSelection,
  simplifiedTechniqueSelectionsEqual,
} from "./app/configureSimplifiedProcedure";
import { activeVariant, procedureLabel, updateChannel } from "./app/planOperations";
import {
  toggleProcedureVisibility,
  withoutGraftPreviewsForProcedure,
} from "./app/procedureVisibility";
import { graftPreviewTitle } from "./app/graftPreviewPresentation";
import {
  SIMPLIFIED_PROCEDURES,
  GENERIC_SOCKET_GUIDE_PIN_WARNING,
  createEmptySimplifiedSelection,
  flowStepsFor,
  readSimplifiedSelection,
  selectedRootLocations,
  toggleRootLocation,
  validateSimplifiedSelection,
  validateSimplifiedStep,
  type PreparationChoice,
  type SimplifiedBoneChoice,
  type SimplifiedProcedureIdentity,
  type SimplifiedTechniqueSelection,
} from "./app/simplifiedTechniqueFlow";
import {
  loadSimplifiedWorkspaceDefaults,
  saveSimplifiedWorkspaceDefaults,
} from "./app/simplifiedWorkspacePersistence";
import {
  commitPlan,
  createPlanHistory,
  loadPlanLocally,
  redoPlan,
  savePlanLocally,
  stablePlanHash,
  undoPlan,
} from "./store/planHistory";
import { downloadText, planToJson } from "./export/exporters";
import {
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
import { publicAssetPath } from "./publicAssetPath";
import {
  createBundledDemoWorkspaceDefaults,
  loadBundledDemoAnatomy,
  usesBundledDemoAnatomy,
} from "./demo/bundledDemo";
import {
  deriveAnatomicReferenceFrame,
  measureChannelStartPoint,
  measureChannelTrajectoryAngles,
  type ChannelStartPointMeasurement,
  type ChannelTrajectoryAngleMeasurement,
} from "./geometry/anatomicReferencePlanes";
import {
  ImportDialog,
  LOCAL_PLAN_KEY,
  deidentifiedLocalSnapshot,
  loadBundledInitialPlan,
  normalizeLoadedPlan,
  type SegmentationUiState,
} from "./App";

const SEGMENTATION_BONE_COLORS: Record<"femur" | "tibia" | "fibula", string> = {
  femur: "#d4dddf",
  tibia: "#bbc9cc",
  fibula: "#c6d2d4",
};
const MAT_XRAY_BONE_OPACITY = 0.22;
const SIMPLE_LAYERS: readonly [ViewerLayer, string][] = [
  ["bones", "Bones"],
  ["boneRemoval", "Tunnels / sockets"],
  ["pins", "Guide pins"],
  ["hardware", "Fixation points"],
];

const simpleDefaultLayerVisibility = (): ViewerPlanningScene["layerVisibility"] => ({
  ...DEFAULT_LAYER_VISIBILITY,
  landmarks: false,
  mri: false,
  access: false,
  deployment: false,
  grafts: true,
  previous: false,
  safety: false,
  measurements: true,
});

function matSourceKind(file: File): MatNnunetSourceKind | null {
  const format = classifyImagingFile(file.name);
  if (format === "dicom_archive") return "dicom_tar_gz";
  if (format === "nifti") return "nifti";
  return null;
}

function mergeById<T extends { id: string }>(existing: readonly T[], additions: readonly T[]): T[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  additions.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function channelDiameter(channel: ChannelPlan): number | null {
  if (channel.diameterMm !== undefined) return channel.diameterMm;
  return channel.crossSection.kind === "circle" ? channel.crossSection.diameterMm : null;
}

function withDiameter(channel: ChannelPlan, diameterMm: number): ChannelPlan {
  return {
    ...channel,
    diameterMm,
    crossSection: channel.crossSection.kind === "circle"
      ? { ...channel.crossSection, diameterMm }
      : channel.crossSection,
    verificationState: channel.geometryType === "anchor_pilot" ? "needs_instrument_chain" : channel.verificationState,
  };
}

const CLINICIAN_GUIDE_PIN_WARNING =
  "Guide-pin diameter is a clinician-entered planning value; no exact pin or compatible instrument chain has been selected or verified.";

function withGuidePinDiameter(channel: ChannelPlan, diameterMm: number): ChannelPlan {
  return {
    ...channel,
    guidePin: { diameterMm, provenance: "clinician_entered_planning_value" },
    instrumentChain: {
      ...channel.instrumentChain,
      userVerified: false,
      verification: null,
      completionState: channel.instrumentChain.completionState === "complete"
        ? "warning"
        : channel.instrumentChain.completionState,
    },
    verificationState: "needs_instrument_chain",
    warnings: [
      ...channel.warnings.filter((warning) =>
        warning !== GENERIC_SOCKET_GUIDE_PIN_WARNING && warning !== CLINICIAN_GUIDE_PIN_WARNING),
      CLINICIAN_GUIDE_PIN_WARNING,
    ],
  };
}

function ChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return <button type="button" className={`simple-choice ${active ? "active" : ""}`} aria-pressed={active} onClick={onClick}>{children}</button>;
}

function NumericChoice({
  label,
  value,
  step = 0.5,
  integer = false,
  onChange,
}: {
  label: string;
  value: number | null;
  step?: number;
  integer?: boolean;
  onChange: (value: number | null) => void;
}) {
  return <label className="simple-number"><span>{label}</span><div><input type="number" min={integer ? 1 : 0.1} step={integer ? 1 : step} value={value ?? ""} onChange={(event) => {
    const next = event.currentTarget.value === "" ? null : Number(event.currentTarget.value);
    onChange(next !== null && Number.isFinite(next) ? next : null);
  }} />{integer ? null : <small>mm</small>}</div></label>;
}

function ChannelDimensionControl({
  channelLabel,
  dimension,
  value,
  min,
  max,
  step,
  onChange,
  onFocus,
}: {
  channelLabel: string;
  dimension: "Diameter" | "Depth" | "Pin diameter";
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onFocus: () => void;
}) {
  const accessibleDimension = dimension.toLowerCase();
  const commitValue = (candidate: number) => {
    if (Number.isFinite(candidate) && candidate > 0) onChange(candidate);
  };
  return <div className="simple-dimension-control">
    <div className="simple-dimension-heading">
      <span>{dimension}</span>
      <label>
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          aria-label={`${channelLabel} ${accessibleDimension} mm`}
          onFocus={onFocus}
          onChange={(event) => commitValue(Number(event.currentTarget.value))}
        />
        <small>mm</small>
      </label>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={Math.min(max, Math.max(min, value))}
      aria-label={`${channelLabel} ${accessibleDimension}`}
      aria-valuetext={`${value.toFixed(1)} mm`}
      onFocus={onFocus}
      onChange={(event) => commitValue(Number(event.currentTarget.value))}
    />
  </div>;
}

function preparationOptions(
  procedure: SimplifiedProcedureIdentity,
  bone: "femur" | "tibia",
): readonly { value: PreparationChoice; label: string; detail?: string }[] {
  if (procedure === "ACL") return [
    { value: "socket_with_guide_pin", label: "Socket + guide pin" },
    { value: "full_tunnel", label: "Full tunnel" },
  ];
  if (procedure === "PCL") return bone === "tibia" ? [
    { value: "socket_with_guide_pin", label: "Socket + guide pin" },
    { value: "full_tunnel", label: "Full tunnel" },
    { value: "onlay_fixation_point", label: "Onlay point", detail: "Point only; no tunnel" },
  ] : [
    { value: "socket_with_guide_pin", label: "Socket + guide pin" },
    { value: "full_tunnel", label: "Full tunnel" },
  ];
  if (procedure === "MEDIAL_ROOT" || procedure === "LATERAL_ROOT") return [
    { value: "suture_anchor_location", label: "Suture anchor location" },
    { value: "socket_with_guide_pin", label: "Socket + guide pin" },
    { value: "full_tunnel", label: "Full tunnel" },
  ];
  if (procedure === "PLC_FCL" && bone === "tibia") return [
    { value: "none", label: "No tibial preparation" },
    { value: "laprade_full_tunnel", label: "LaPrade full tunnel" },
    { value: "posterior_socket_with_guide_pin", label: "Posterior socket + guide pin" },
  ];
  return [
    { value: "anchor", label: "Anchor" },
    { value: "socket_with_guide_pin", label: "Socket" },
  ];
}

const REFERENCE_DISTANCE_ZERO_EPSILON_MM = 0.05;

function finiteReferenceDistance(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function signedReferenceDistance(
  valueMm: number,
  positiveDirection: string,
  negativeDirection: string,
  reference: string,
): string {
  const magnitude = Math.abs(valueMm) < REFERENCE_DISTANCE_ZERO_EPSILON_MM ? 0 : Math.abs(valueMm);
  if (magnitude === 0) return `0.0 mm from ${reference}`;
  const direction = valueMm > 0 ? positiveDirection : negativeDirection;
  return `${magnitude.toFixed(1)} mm ${direction} from ${reference}`;
}

export function StartPointReadout({
  bone,
  measurement,
  trajectoryMeasurement,
}: {
  bone: "femur" | "tibia";
  measurement: ChannelStartPointMeasurement | null;
  trajectoryMeasurement: ChannelTrajectoryAngleMeasurement | null;
}) {
  const boneLabel = `${bone[0].toUpperCase()}${bone.slice(1)}`;
  const hasCompleteMeasurement = measurement?.evaluationState === "evaluated" &&
    finiteReferenceDistance(measurement.jointLineSignedMm) &&
    finiteReferenceDistance(measurement.posteriorCondylarSignedMm) &&
    (measurement.lateralityVerified
      ? finiteReferenceDistance(measurement.midlineSignedMm)
      : finiteReferenceDistance(measurement.midlineUnsignedMm));
  const unavailableReason = !measurement
    ? "Select a channel with a defined Start point on this bone."
    : measurement.evaluationState === "not_evaluated"
      ? measurement.reason ?? "Reference-plane measurements are unavailable."
      : "One or more reference-plane distances are unavailable.";

  return <section className="simple-start-point-readout" aria-label={`${boneLabel} start point reference measurements`} aria-live="polite">
    <div className="simple-start-point-heading">
      <strong>{boneLabel} Start Point</strong>
    </div>
    {!hasCompleteMeasurement ? <div className="simple-start-point-unavailable">
      <strong>Not evaluated</strong>
      <span>{unavailableReason}</span>
    </div> : <>
      <div className="simple-reference-distance-list">
        <div><span>{signedReferenceDistance(measurement.jointLineSignedMm!, "superior", "inferior", "joint line")}</span></div>
        <div><span>{measurement.lateralityVerified
          ? signedReferenceDistance(measurement.midlineSignedMm!, "lateral", "medial", "midline")
          : `${measurement.midlineUnsignedMm!.toFixed(1)} mm from midline`}</span></div>
        <div><span>{signedReferenceDistance(measurement.posteriorCondylarSignedMm!, "anterior", "posterior", "posterior condylar axis")}</span></div>
      </div>
    </>}
    {trajectoryMeasurement ? <div className="simple-trajectory-readout">
      <div className="simple-trajectory-heading">
        <strong>Trajectory Angles</strong>
      </div>
      {trajectoryMeasurement.evaluationState === "evaluated" ? <div className="simple-trajectory-angle-list">
        <div><span>Sagittal to tibial plateau axis</span><strong>{finiteReferenceDistance(trajectoryMeasurement.sagittalToTibialPlateauDeg)
          ? `${trajectoryMeasurement.sagittalToTibialPlateauDeg.toFixed(1)}°`
          : "Not evaluated"}</strong></div>
        <div><span>Coronal to tibial plateau axis</span><strong>{finiteReferenceDistance(trajectoryMeasurement.coronalToTibialPlateauDeg)
          ? `${trajectoryMeasurement.coronalToTibialPlateauDeg.toFixed(1)}°`
          : "Not evaluated"}</strong></div>
        <div><span>Axial to posterior condylar axis</span><strong>{finiteReferenceDistance(trajectoryMeasurement.axialToPosteriorCondylarDeg)
          ? `${trajectoryMeasurement.axialToPosteriorCondylarDeg.toFixed(1)}°`
          : "Not evaluated"}</strong></div>
      </div> : <div className="simple-trajectory-unavailable">Not evaluated</div>}
    </div> : null}
  </section>;
}

export function TechniquePanel({
  draft,
  stepIndex,
  channels,
  selectedChannelId,
  startPointMeasurement,
  trajectoryMeasurement,
  geometryMatchesDraft,
  onDraft,
  onStep,
  onSelectChannel,
  onNumericChannel,
}: {
  draft: SimplifiedTechniqueSelection | null;
  stepIndex: number;
  channels: ChannelPlan[];
  selectedChannelId: string | null;
  startPointMeasurement?: ChannelStartPointMeasurement | null;
  trajectoryMeasurement?: ChannelTrajectoryAngleMeasurement | null;
  geometryMatchesDraft: boolean;
  onDraft: (draft: SimplifiedTechniqueSelection, bone: "femur" | "tibia") => void;
  onStep: (step: number) => void;
  onSelectChannel: (id: string) => void;
  onNumericChannel: (channelId: string, field: "diameterMm" | "depthMm" | "pinDiameterMm", value: number) => void;
}) {
  if (!draft) return <aside className="right-panel simple-right" aria-label="Plan"><div className="simple-empty"><strong>Select a structure</strong><span>Choose one or more structures on the left. The focused structure will be planned here.</span></div></aside>;
  const steps = flowStepsFor(draft);
  const safeStepIndex = Math.max(0, Math.min(stepIndex, steps.length - 1));
  const step = steps[safeStepIndex];
  const choice = step.bone === "femur" ? draft.femur! : draft.tibia!;
  const errors = validateSimplifiedStep(draft, safeStepIndex);
  const allErrors = validateSimplifiedSelection(draft);
  const label = SIMPLIFIED_PROCEDURES.find((item) => item.id === draft.procedure)?.label ?? procedureLabel(draft.procedure);
  const updateChoice = (patch: Partial<SimplifiedBoneChoice>) => {
    const updated = { ...choice, ...patch };
    onDraft({ ...draft, [step.bone]: updated }, step.bone);
  };
  const siteChannels = geometryMatchesDraft
    ? channels.filter((channel) => channel.bone === step.bone)
    : [];
  const activeStartPointMeasurement = startPointMeasurement &&
    startPointMeasurement.channelId === selectedChannelId &&
    siteChannels.some((channel) => channel.id === startPointMeasurement.channelId)
    ? startPointMeasurement
    : null;
  const activeTrajectoryMeasurement = trajectoryMeasurement &&
    trajectoryMeasurement.channelId === selectedChannelId &&
    siteChannels.some((channel) => channel.id === trajectoryMeasurement.channelId)
    ? trajectoryMeasurement
    : null;
  const adjustableSiteChannels = siteChannels.filter((channel) => !channel.noLargeTunnel);
  const requiresCount = (
    draft.procedure === "PLC_FCL" && step.bone === "femur" && ["anchor", "socket_with_guide_pin"].includes(choice.preparation ?? "")
  ) || (
    draft.procedure === "MCL_POL_PMC" && choice.preparation === "anchor"
  );
  const pointOnly = choice.preparation === "onlay_fixation_point";
  const needsInitialAnchorDimensions = choice.preparation === "anchor" && adjustableSiteChannels.length === 0;

  return <aside className="right-panel simple-right" aria-label={`${label} plan`}>
    <div className="simple-technique-header">
      <span>Technique &amp; geometry</span>
      <strong>{label} Plan</strong>
      <div className="simple-bone-toggle" role="group" aria-label={`${label} bone plan`}>
        {steps.map((item, index) => <button
          key={item.bone}
          type="button"
          className={index === safeStepIndex ? "active" : ""}
          aria-pressed={index === safeStepIndex}
          onClick={() => {
            onStep(index);
            const firstSiteChannel = geometryMatchesDraft
              ? channels.find((channel) => channel.bone === item.bone)
              : null;
            if (firstSiteChannel) onSelectChannel(firstSiteChannel.id);
          }}
        >{item.title}</button>)}
      </div>
    </div>
    <div className="simple-technique-scroll">
      {(draft.procedure === "MEDIAL_ROOT" || draft.procedure === "LATERAL_ROOT") ? <section className="simple-prompt-section">
        <h3>Root location</h3>
        <div className="simple-choice-grid two" role="group" aria-label="Root locations">
          <ChoiceButton
            active={selectedRootLocations(draft.rootLocation).includes("anterior")}
            onClick={() => onDraft({ ...draft, rootLocation: toggleRootLocation(draft.rootLocation, "anterior") }, step.bone)}
          >Anterior</ChoiceButton>
          <ChoiceButton
            active={selectedRootLocations(draft.rootLocation).includes("posterior")}
            onClick={() => onDraft({ ...draft, rootLocation: toggleRootLocation(draft.rootLocation, "posterior") }, step.bone)}
          >Posterior</ChoiceButton>
        </div>
      </section> : null}

      {(draft.procedure === "ACL" || draft.procedure === "PCL") ? <section className="simple-prompt-section">
        <h3>Bundle plan</h3>
        <div className="simple-choice-grid two">
          <ChoiceButton active={choice.bundle === "single_bundle"} onClick={() => updateChoice({ bundle: "single_bundle" })}>Single bundle</ChoiceButton>
          <ChoiceButton active={choice.bundle === "double_bundle"} onClick={() => updateChoice({ bundle: "double_bundle" })}>Double bundle</ChoiceButton>
        </div>
      </section> : null}

      <section className="simple-prompt-section">
        <h3>{step.bone === "femur" ? "Femoral" : "Tibial"} preparation</h3>
        <div className="simple-choice-grid">
          {preparationOptions(draft.procedure, step.bone).map((option) => <ChoiceButton key={option.value} active={choice.preparation === option.value} onClick={() => updateChoice({ preparation: option.value })}>
            <strong>{option.label}</strong>{option.detail ? <span>{option.detail}</span> : null}
          </ChoiceButton>)}
        </div>
      </section>

      {choice.preparation === "anchor" && (needsInitialAnchorDimensions || requiresCount) ? <section className="simple-prompt-section compact">
        <h3>Anchor preparation</h3>
        <div className="simple-number-grid">
          {needsInitialAnchorDimensions ? <>
            <NumericChoice label="Diameter" value={choice.diameterMm} step={0.1} onChange={(diameterMm) => updateChoice({ diameterMm })} />
            <NumericChoice label="Length / drill depth" value={choice.depthMm} onChange={(depthMm) => updateChoice({ depthMm })} />
          </> : null}
          {requiresCount ? <NumericChoice label="Number of anchors" value={choice.count} integer onChange={(count) => updateChoice({ count })} /> : null}
        </div>
        {needsInitialAnchorDimensions ? <p>Geometry appears automatically once all required choices have valid values.</p> : null}
      </section> : null}

      {choice.preparation === "socket_with_guide_pin" && requiresCount ? <section className="simple-prompt-section compact">
        <NumericChoice label="Number of sockets" value={choice.count} integer onChange={(count) => updateChoice({ count })} />
      </section> : null}

      {pointOnly ? <div className="simple-inline-note">This creates a movable fixation location on the bone surface, without a drilled volume.</div> : null}
      {choice.preparation === "none" ? <div className="simple-inline-note">No tibial drilled geometry is planned for this technique.</div> : null}

      {allErrors.length > 0 ? <div className="simple-validation" role="status">
        {errors.length > 0
          ? `Complete the ${step.title.toLowerCase()} choices. Geometry updates automatically when the plan is valid.`
          : "Complete the other bone plan. Geometry updates automatically when all required choices are valid."}
      </div> : !geometryMatchesDraft ? <div className="simple-auto-status" role="status">Updating geometry…</div> : null}

      {siteChannels.length ? <section className="simple-site-geometry" aria-label={`${step.title} planned geometry`}>
        <h3>{step.title} geometry</h3>
        {siteChannels.map((channel) => channel.noLargeTunnel
          ? <button
              key={channel.id}
              type="button"
              className={`simple-point-geometry ${selectedChannelId === channel.id ? "active" : ""}`}
              aria-label={`Select ${channel.label}`}
              aria-pressed={selectedChannelId === channel.id}
              onClick={() => onSelectChannel(channel.id)}
            >
              <strong>{channel.label}</strong>
              <span>Movable fixation point · no drilled volume</span>
            </button>
          : <article key={channel.id} className={`simple-channel-controls ${selectedChannelId === channel.id ? "active" : ""}`}>
              <button
                type="button"
                className="simple-channel-select"
                aria-label={`Select ${channel.label}`}
                aria-pressed={selectedChannelId === channel.id}
                onClick={() => onSelectChannel(channel.id)}
              ><span>{channel.label}</span><i aria-hidden="true" /></button>
              <ChannelDimensionControl
                channelLabel={channel.label}
                dimension={channel.geometryType === "rigid_pin" ? "Pin diameter" : "Diameter"}
                value={channelDiameter(channel) ?? 1}
                min={1}
                max={15}
                step={0.5}
                onFocus={() => onSelectChannel(channel.id)}
                onChange={(value) => onNumericChannel(channel.id, "diameterMm", value)}
              />
              <ChannelDimensionControl
                channelLabel={channel.label}
                dimension="Depth"
                value={channel.depthMm ?? 3}
                min={3}
                max={60}
                step={0.5}
                onFocus={() => onSelectChannel(channel.id)}
                onChange={(value) => onNumericChannel(channel.id, "depthMm", value)}
              />
              {isGuidePinSocketGeometry(channel) ? <ChannelDimensionControl
                channelLabel={channel.label}
                dimension="Pin diameter"
                value={resolvedChannelGuidePinDiameterMm(channel) ?? 3.5}
                min={1}
                max={6}
                step={0.1}
                onFocus={() => onSelectChannel(channel.id)}
                onChange={(value) => onNumericChannel(channel.id, "pinDiameterMm", value)}
              /> : null}
              <p>{channel.geometryType === "rigid_pin"
                ? "Drag the Start point on the bone surface and the exterior Trajectory handle to change the guide-pin axis."
                : channel.geometryType === "anchor_pilot"
                ? "Drag the Start point on the bone surface and the exterior Trajectory handle to change the anchor axis."
                : resolvedTrajectoryControlMode(channel) === "blind_socket_tip"
                  ? "Drag Entry on the ipsilateral cortex and the inner Start to steer the coaxial socket and guide pin."
                  : "Drag the entry and start points along their assigned bone surfaces to change the tunnel or socket axis."}</p>
            </article>)}
      </section> : null}
    </div>
    <StartPointReadout
      bone={step.bone}
      measurement={activeStartPointMeasurement?.bone === step.bone ? activeStartPointMeasurement : null}
      trajectoryMeasurement={activeTrajectoryMeasurement?.bone === step.bone ? activeTrajectoryMeasurement : null}
    />
  </aside>;
}

export default function SimplifiedApp() {
  // The public demo always opens from the deployed, repository-owned fixture.
  // Browser-saved sessions remain available only through the explicit reload
  // control and can never replace the published opening configuration.
  const [history, setHistory] = useState(() => createPlanHistory(loadBundledInitialPlan()));
  const plan = history.present.snapshot;
  const variant = activeVariant(plan);
  const initialWorkspace = useRef(
    usesBundledDemoAnatomy(plan) ? createBundledDemoWorkspaceDefaults(plan) : null,
  ).current;
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(initialWorkspace?.selectedChannelId ?? null);
  const selectedChannel = variant.channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const [focusedProcedure, setFocusedProcedure] = useState<SimplifiedProcedureIdentity | null>(initialWorkspace?.focusedProcedure ?? null);
  const [highlightedProcedures, setHighlightedProcedures] = useState<SimplifiedProcedureIdentity[]>(initialWorkspace?.highlightedProcedures ?? []);
  const [visibleGraftVisibilityKeys, setVisibleGraftVisibilityKeys] = useState<string[]>(
    initialWorkspace?.visibleGraftVisibilityKeys ?? [],
  );
  const [drafts, setDrafts] = useState<Partial<Record<SimplifiedProcedureIdentity, SimplifiedTechniqueSelection>>>(initialWorkspace?.drafts ?? {});
  const [stepIndex, setStepIndex] = useState(initialWorkspace?.stepIndex ?? 0);
  const [pendingConfiguredProcedure, setPendingConfiguredProcedure] = useState<{
    procedure: SimplifiedProcedureIdentity;
    bone: "femur" | "tibia";
    semanticKey: string | null;
  } | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<ViewerPlanningScene["layerVisibility"]>(() => ({
    ...simpleDefaultLayerVisibility(),
    ...(initialWorkspace?.layerVisibility ?? {}),
    grafts: true,
    measurements: true,
  }));
  const [globalOpacity, setGlobalOpacity] = useState(initialWorkspace?.globalOpacity ?? 1);
  const [standardView, setStandardView] = useState<{ view: StandardView; nonce: number }>({ view: "focus", nonce: 0 });
  const [bundledDemoLoadNonce, setBundledDemoLoadNonce] = useState(0);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
    () => plan.imaging.segmentationRuns.length || usesBundledDemoAnatomy(plan) ? [] : null,
  );
  const syntheticAnatomyMeshes = useMemo(() => buildSyntheticAnatomyMeshes(), []);
  const interactionAnatomyMeshes = patientAnatomyMeshes ?? syntheticAnatomyMeshes;
  const anatomicReferenceFrame = useMemo(() => deriveAnatomicReferenceFrame(
    interactionAnatomyMeshes,
    {
      laterality: plan.laterality,
      lateralityVerified: plan.lateralityVerified,
      scaleVerified: plan.scaleVerified,
    },
  ), [interactionAnatomyMeshes, plan.laterality, plan.lateralityVerified, plan.scaleVerified]);
  const selectedStartPointMeasurement = useMemo(() => selectedChannel
    ? measureChannelStartPoint(selectedChannel, anatomicReferenceFrame, interactionAnatomyMeshes)
    : null, [anatomicReferenceFrame, interactionAnatomyMeshes, selectedChannel]);
  const selectedTrajectoryMeasurement = useMemo(() => selectedChannel
    ? measureChannelTrajectoryAngles(selectedChannel, anatomicReferenceFrame)
    : null, [anatomicReferenceFrame, selectedChannel]);
  const highlightedSet = useMemo<ReadonlySet<ProcedureIdentity>>(
    () => new Set<ProcedureIdentity>(highlightedProcedures),
    [highlightedProcedures],
  );
  const visibleGraftVisibilitySet = useMemo<ReadonlySet<string>>(
    () => new Set(visibleGraftVisibilityKeys),
    [visibleGraftVisibilityKeys],
  );
  const procedureById = useMemo(
    () => Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
    [plan.procedures],
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
          audit: [...candidate.audit, {
            id: crypto.randomUUID(),
            at,
            actorId: "local-clinician",
            action: reason,
            entityType: "PlanRevision",
            entityId: candidate.activeVariantId,
            beforeHash,
            afterHash,
          }],
        };
      }, reason);
      if (options.persistDeidentifiedSnapshot) {
        savePlanLocally(LOCAL_PLAN_KEY, deidentifiedLocalSnapshot(next.present.snapshot));
      }
      return next;
    });
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? null : current), 2800);
  }, []);

  const activeDraft = focusedProcedure ? drafts[focusedProcedure] ?? null : null;
  const focusedProcedureIds = new Set(
    plan.procedures.filter((procedure) => procedure.structure === focusedProcedure).map((procedure) => procedure.id),
  );
  const focusedChannels = focusedProcedure
    ? variant.channels.filter((channel) => focusedProcedureIds.has(channel.procedureId))
    : [];
  const activeConfiguredSelection = focusedProcedure
    ? configuredSimplifiedSelection(plan, focusedProcedure)
    : null;
  const geometryMatchesDraft = simplifiedTechniqueSelectionsEqual(activeConfiguredSelection, activeDraft);

  const ensureDraft = useCallback((identity: SimplifiedProcedureIdentity) => {
    setDrafts((current) => {
      if (current[identity]) return current;
      const procedureIds = new Set(
        plan.procedures.filter((procedure) => procedure.structure === identity).map((procedure) => procedure.id),
      );
      const currentProcedureId = variant.channels.find((channel) => procedureIds.has(channel.procedureId))?.procedureId;
      const currentProcedure = plan.procedures.find((procedure) => procedure.id === currentProcedureId);
      return {
        ...current,
        [identity]: readSimplifiedSelection(currentProcedure) ?? createEmptySimplifiedSelection(identity),
      };
    });
  }, [plan.procedures, variant.channels]);

  const toggleProcedure = (identity: SimplifiedProcedureIdentity) => {
    ensureDraft(identity);
    setStepIndex(0);
    const transition = toggleProcedureVisibility(highlightedProcedures, focusedProcedure, identity);
    if (transition.action !== "focus") {
      setVisibleGraftVisibilityKeys((current) => withoutGraftPreviewsForProcedure(current, identity));
    }
    setHighlightedProcedures(transition.highlighted as SimplifiedProcedureIdentity[]);
    const nextFocusedProcedure = transition.action === "hide"
      ? (transition.highlighted.at(-1) as SimplifiedProcedureIdentity | undefined) ?? null
      : transition.focused as SimplifiedProcedureIdentity;
    setFocusedProcedure(nextFocusedProcedure);
    if (transition.action === "hide" && selectedChannel && procedureById[selectedChannel.procedureId] === identity) {
      setSelectedChannelId(null);
    }
  };

  const selectChannel = useCallback((channelId: string) => {
    const channel = variant.channels.find((candidate) => candidate.id === channelId);
    if (!channel) return;
    const identity = procedureById[channel.procedureId];
    if (!identity || !SIMPLIFIED_PROCEDURES.some((item) => item.id === identity)) return;
    const simplifiedIdentity = identity as SimplifiedProcedureIdentity;
    ensureDraft(simplifiedIdentity);
    if (!highlightedSet.has(simplifiedIdentity)) {
      setVisibleGraftVisibilityKeys((current) => withoutGraftPreviewsForProcedure(current, simplifiedIdentity));
    }
    setHighlightedProcedures((current) => current.includes(simplifiedIdentity) ? current : [...current, simplifiedIdentity]);
    setFocusedProcedure(simplifiedIdentity);
    setSelectedChannelId(channelId);
    const boneStepIndex = flowStepsFor(simplifiedIdentity).findIndex((step) => step.bone === channel.bone);
    if (boneStepIndex >= 0) setStepIndex(boneStepIndex);
  }, [ensureDraft, highlightedSet, procedureById, variant.channels]);

  const viewerModel = useMemo(() => buildViewerScene({
    revision: history.present.sequence,
    channels: variant.channels,
    procedureById,
    visibleProcedureIdentities: highlightedSet,
    visibleGraftVisibilityKeys: visibleGraftVisibilitySet,
    selectedChannelId,
    layerVisibility,
    globalOpacity,
    anatomyMeshes: interactionAnatomyMeshes,
    laterality: plan.laterality,
    lateralityVerified: plan.lateralityVerified,
  }), [globalOpacity, highlightedSet, history.present.sequence, interactionAnatomyMeshes, layerVisibility, plan.laterality, plan.lateralityVerified, procedureById, selectedChannelId, variant.channels, visibleGraftVisibilitySet]);

  const handleViewerChange = useCallback((change: ViewerHandleChange) => {
    if (change.phase !== "commit") return;
    const channel = variant.channels.find((candidate) => candidate.id === change.channelId);
    if (!channel) return;
    commit((current) => updateChannel(current, change.channelId, (currentChannel) => applySurfaceConstrainedHandleCommit(
      currentChannel,
      procedureById[currentChannel.procedureId],
      change,
      interactionAnatomyMeshes,
    )), `Moved ${channel.label} ${change.kind}`);
  }, [commit, interactionAnatomyMeshes, procedureById, variant.channels]);

  const updateChannelNumber = (channelId: string, field: "diameterMm" | "depthMm" | "pinDiameterMm", value: number) => {
    const channel = variant.channels.find((candidate) => candidate.id === channelId);
    if (!channel || !Number.isFinite(value) || value <= 0) return;
    setSelectedChannelId(channelId);
    commit((current) => updateChannel(current, channelId, (currentChannel) => field === "diameterMm"
      ? withDiameter(currentChannel, value)
      : field === "pinDiameterMm"
        ? withGuidePinDiameter(currentChannel, value)
        : applyChannelDepthGeometryEdit(currentChannel, value)), `Changed ${channel.label} ${field}`);
  };

  const updateTechniqueDraft = (
    selection: SimplifiedTechniqueSelection,
    bone: "femur" | "tibia",
  ) => {
    setDrafts((current) => ({ ...current, [selection.procedure]: selection }));
    const configured = autoConfigureSimplifiedProcedure(plan, selection, interactionAnatomyMeshes);
    if (!configured) return;
    const hadGeometry = focusedChannels.length > 0;
    const selectedSemanticKey = selectedChannel &&
      procedureById[selectedChannel.procedureId] === selection.procedure &&
      selectedChannel.bone === bone
      ? selectedChannel.semanticKey ?? null
      : null;
    commit(configured.plan, `Updated ${selection.procedure} plan geometry automatically`);
    setPendingConfiguredProcedure({ procedure: selection.procedure, bone, semanticKey: selectedSemanticKey });
    if (!hadGeometry) {
      setLayerVisibility((current) => ({
        ...current,
        bones: true,
        boneRemoval: true,
        pins: true,
        grafts: true,
        hardware: true,
        measurements: true,
      }));
    }
  };

  useEffect(() => {
    if (!pendingConfiguredProcedure) return;
    const procedureIds = new Set(
      plan.procedures
        .filter((procedure) => procedure.structure === pendingConfiguredProcedure.procedure)
        .map((procedure) => procedure.id),
    );
    const siteChannels = variant.channels.filter((candidate) =>
      procedureIds.has(candidate.procedureId) && candidate.bone === pendingConfiguredProcedure.bone,
    );
    const channel = siteChannels.find((candidate) =>
      pendingConfiguredProcedure.semanticKey !== null && candidate.semanticKey === pendingConfiguredProcedure.semanticKey,
    ) ?? siteChannels[0];
    setSelectedChannelId(channel?.id ?? null);
    setPendingConfiguredProcedure(null);
  }, [pendingConfiguredProcedure, plan.procedures, variant.channels]);

  useEffect(() => {
    if (!selectedChannelId) return;
    if (!selectedChannel || !highlightedSet.has(procedureById[selectedChannel.procedureId])) setSelectedChannelId(null);
  }, [highlightedSet, procedureById, selectedChannel, selectedChannelId]);

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
    }), "Imported immutable imaging source metadata");
    showToast(`${imported.length} imaging source${imported.length === 1 ? "" : "s"} imported for review.`);
  };

  const selectMatSegmentationSource = (fileList: FileList | null) => {
    const files = fileList ? [...fileList] : [];
    if (files.length !== 1 || !matSourceKind(files[0])) {
      setSegmentationUi({ status: "failed", progress: 0, message: "Select one DICOM .tar.gz archive or NIfTI MRI volume.", file: null, jobId: null });
      return;
    }
    const file = files[0];
    setSegmentationUi({
      status: "selected",
      progress: 0,
      message: `${matSourceKind(file) === "dicom_tar_gz" ? "DICOM archive" : "NIfTI MRI"} selected (${(file.size / 1024 / 1024).toFixed(1)} MiB).`,
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
    const options = {
      id: artifact.assetId,
      name: `${artifact.bone[0].toUpperCase()}${artifact.bone.slice(1)} · MAT nnUNetv2 research output`,
      color: SEGMENTATION_BONE_COLORS[artifact.bone],
      opacity: MAT_XRAY_BONE_OPACITY,
      layer: "bones" as const,
    };
    if (artifact.mediaType === "application/json") {
      return { ...parseMatViewerMeshArtifactBytes(bytes, { ...options, expectedBone: artifact.bone }), anatomyBone: artifact.bone };
    }
    if (artifact.mediaType === "model/stl") {
      const frame = patch.coordinateFramesToAdd.find((candidate) => candidate.id === artifact.coordinateFrameId);
      if (!frame) throw new Error(`Coordinate frame for ${artifact.bone} is unavailable`);
      return { ...parseStlToViewerMesh(bytes, { ...options, transformToPatientRas: frame.transformToPatientRas }), anatomyBone: artifact.bone };
    }
    throw new Error(`Unsupported viewer mesh media type for ${artifact.bone}`);
  };

  const applyCompletedSegmentation = async (job: MatNnunetJob, signal?: AbortSignal) => {
    if (job.status !== "completed" || !job.result) throw new Error("Segmentation result is incomplete");
    const generation = ++anatomyLoadGenerationRef.current;
    const patch = segmentationPlanPatch(job.result);
    const resolved = await Promise.allSettled(patch.artifacts.filter((artifact) => artifact.kind === "surface_mesh").map(async (artifact) => ({
      artifact,
      mesh: await resolveSegmentationMesh(artifact, patch, signal),
    })));
    if (generation !== anatomyLoadGenerationRef.current) return;
    const availableAssetIds = new Set(resolved.flatMap((result) => result.status === "fulfilled" ? [result.value.artifact.assetId] : []));
    const meshes = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value.mesh] : []);
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
    commit((current) => initializePendingChannelSurfacePlacements({
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
          surfacePlacement: { state: "pending_default", method: "migration_pending", meshIds: [], endpointMethod: "not_available" },
        })),
      })),
      imaging: {
        ...current.imaging,
        sources: mergeById(current.imaging.sources, [patch.sourceToAdd]),
        derivedAssets: mergeById(current.imaging.derivedAssets, derivedAssets),
        segmentationRuns: mergeById(current.imaging.segmentationRuns, [{
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
    }, meshes), "Imported MAT nnUNetv2 segmentation and placed planning geometry on its surfaces", { persistDeidentifiedSnapshot: true });
    setPatientAnatomyMeshes(meshes);
    setLayerVisibility((current) => ({ ...current, bones: true, boneRemoval: true, pins: true }));
    setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }));
    setSegmentationUi({
      status: "completed",
      progress: 1,
      message: `${meshes.length} MRI-derived bone mesh${meshes.length === 1 ? "" : "es"} loaded. Laterality, scale, orientation, and identity review remain required.`,
      file: segmentationUi.file,
      jobId: job.jobId,
    });
    showToast("MRI-derived bone segmentation loaded in Viewer v2.");
  };

  const runMatSegmentation = async () => {
    const file = segmentationUi.file;
    const sourceKind = file ? matSourceKind(file) : null;
    if (!file || !sourceKind) return;
    segmentationAbortRef.current?.abort();
    const controller = new AbortController();
    segmentationAbortRef.current = controller;
    try {
      setSegmentationUi((current) => ({ ...current, status: "checking", progress: 0.01, message: "Checking the local MAT nnUNetv2 runtime…" }));
      const capabilities = await segmentationClient.getCapabilities(controller.signal);
      if (!capabilities.accepts.includes(sourceKind)) throw new Error("The local MAT service does not accept this source type");
      if (file.size > capabilities.maxUploadBytes) throw new Error("The MRI source exceeds the local service upload limit");
      if (!capabilities.models.some((model) => model.status === "available")) throw new Error("No MAT nnUNetv2 model checkpoint is available");
      setSegmentationUi((current) => ({ ...current, status: "uploading", progress: 0.03, message: "Uploading the immutable source to the local service…" }));
      let job = await segmentationClient.createJob({ source: file, sourceKind, signal: controller.signal });
      setSegmentationUi((current) => ({ ...current, status: "running", progress: job.progress ?? 0.05, jobId: job.jobId, message: "MAT nnUNetv2 inference is running locally…" }));
      if (job.status !== "completed" && job.status !== "failed") {
        job = await segmentationClient.waitForTerminalJob(job.jobId, {
          signal: controller.signal,
          onUpdate: (update) => setSegmentationUi((current) => ({
            ...current,
            status: "running",
            progress: update.progress ?? current.progress,
            jobId: update.jobId,
            message: "MAT nnUNetv2 inference is running locally…",
          })),
        });
      }
      if (job.status === "failed") throw new Error(job.error?.message ?? "MAT segmentation failed");
      await applyCompletedSegmentation(job, controller.signal);
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      setSegmentationUi((current) => ({
        ...current,
        status: aborted ? "selected" : "failed",
        message: aborted ? "Stopped waiting for the local job." : `Segmentation was not loaded: ${error instanceof Error ? error.message : "unknown error"}`,
      }));
    } finally {
      if (segmentationAbortRef.current === controller) segmentationAbortRef.current = null;
    }
  };

  const rehydratePatientAnatomy = useCallback(async (targetPlan: PlanCase) => {
    const generation = ++anatomyLoadGenerationRef.current;
    const activeRun = targetPlan.imaging.segmentationRuns.at(-1);
    const activeArtifactIds = new Set(activeRun?.artifactIds ?? []);
    const assets = targetPlan.imaging.derivedAssets.filter((asset) => asset.kind === "surface_mesh" && activeArtifactIds.has(asset.id));
    if (!assets.length) {
      if (generation === anatomyLoadGenerationRef.current) setPatientAnatomyMeshes(targetPlan.imaging.segmentationRuns.length ? [] : null);
      return;
    }
    setSegmentationUi((current) => ({ ...current, status: "checking", progress: 0.25, message: "Reconnecting MRI-derived bone meshes…" }));
    const resolved = await Promise.allSettled(assets.map(async (asset): Promise<ViewerMeshPayload> => {
      const bytes = await segmentationClient.getArtifact({ artifactId: asset.serviceArtifactId, expectedSha256: asset.sha256, expectedByteLength: asset.byteLength });
      const options = {
        id: asset.id,
        name: `${asset.boneIdentity[0].toUpperCase()}${asset.boneIdentity.slice(1)} · MAT nnUNetv2 research output`,
        color: SEGMENTATION_BONE_COLORS[asset.boneIdentity],
        opacity: MAT_XRAY_BONE_OPACITY,
        layer: "bones" as const,
      };
      if (asset.mediaType === "application/json") return { ...parseMatViewerMeshArtifactBytes(bytes, { ...options, expectedBone: asset.boneIdentity }), anatomyBone: asset.boneIdentity };
      if (asset.mediaType === "model/stl") {
        const frame = targetPlan.coordinateFrames.find((candidate) => candidate.id === asset.coordinateFrameId);
        if (!frame) throw new Error(`Coordinate frame for ${asset.boneIdentity} is unavailable`);
        return { ...parseStlToViewerMesh(bytes, { ...options, transformToPatientRas: frame.transformToPatientRas }), anatomyBone: asset.boneIdentity };
      }
      throw new Error(`Unsupported persisted mesh media type for ${asset.boneIdentity}`);
    }));
    if (generation !== anatomyLoadGenerationRef.current) return;
    const meshes = resolved.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    setPatientAnatomyMeshes(meshes);
    if (meshes.length) {
      commit((current) => initializePendingChannelSurfacePlacements(current, meshes), "Reconnected MRI-derived surfaces", { persistDeidentifiedSnapshot: true });
      setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }));
    }
    setSegmentationUi({
      status: meshes.length === assets.length ? "completed" : "failed",
      progress: assets.length ? meshes.length / assets.length : 0,
      message: meshes.length === assets.length ? `${meshes.length} MRI-derived bone meshes reconnected.` : `${meshes.length} of ${assets.length} meshes reconnected.`,
      file: null,
      jobId: activeRun?.id ?? null,
    });
  }, [commit, segmentationClient]);

  useEffect(() => {
    const activeRunId = plan.imaging.segmentationRuns.at(-1)?.id ?? null;
    const bundledDemo = usesBundledDemoAnatomy(plan);
    const anatomySignature = bundledDemo ? `bundled-demo-anatomy:v1:${bundledDemoLoadNonce}` : activeRunId;
    if (displayedAnatomySignatureRef.current === anatomySignature) return;
    displayedAnatomySignatureRef.current = anatomySignature;
    if (bundledDemo) {
      const generation = ++anatomyLoadGenerationRef.current;
      setPatientAnatomyMeshes([]);
      setSegmentationUi((current) => ({
        ...current,
        status: "checking",
        progress: 0.25,
        message: "Loading the de-identified MRI-derived demo surfaces…",
      }));
      void loadBundledDemoAnatomy().then((meshes) => {
        if (generation !== anatomyLoadGenerationRef.current) return;
        setPatientAnatomyMeshes(meshes);
        setLayerVisibility((current) => ({ ...current, bones: true }));
        setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }));
        setSegmentationUi({
          status: "completed",
          progress: 1,
          message: "De-identified MRI-derived femur and tibia demo surfaces loaded. Review remains required.",
          file: null,
          jobId: null,
        });
      }).catch((error: unknown) => {
        if (generation !== anatomyLoadGenerationRef.current) return;
        setPatientAnatomyMeshes([]);
        setSegmentationUi({
          status: "failed",
          progress: 0,
          message: `Demo anatomy was not loaded: ${error instanceof Error ? error.message : "unknown error"}`,
          file: null,
          jobId: null,
        });
      });
      return;
    }
    if (!activeRunId) {
      anatomyLoadGenerationRef.current += 1;
      setPatientAnatomyMeshes(null);
      return;
    }
    setPatientAnatomyMeshes([]);
    void rehydratePatientAnatomy(plan);
  }, [bundledDemoLoadNonce, plan, rehydratePatientAnatomy]);

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
    }, "Updated imaging review");
  };

  const hasBundledDemoAnatomy = usesBundledDemoAnatomy(plan);

  const saveCurrentSession = () => {
    savePlanLocally(LOCAL_PLAN_KEY, deidentifiedLocalSnapshot(plan));
    saveSimplifiedWorkspaceDefaults(localStorage, plan, {
      highlightedProcedures,
      focusedProcedure,
      selectedChannelId,
      visibleGraftVisibilityKeys,
      drafts,
      stepIndex,
      layerVisibility: { ...layerVisibility, grafts: true },
      globalOpacity,
    });
    showToast("Session saved in this browser only. Published initial parameters are unchanged.");
  };

  const reloadInitialSession = () => {
    const loaded = loadPlanLocally<PlanCase>(LOCAL_PLAN_KEY);
    if (!loaded) { showToast("No browser-saved session found."); return; }
    const normalized = normalizeLoadedPlan(loaded);
    const workspace = loadSimplifiedWorkspaceDefaults(localStorage, normalized)
      ?? (usesBundledDemoAnatomy(normalized) ? createBundledDemoWorkspaceDefaults(normalized) : null);
    displayedAnatomySignatureRef.current = null;
    setHistory(createPlanHistory(normalized));
    setSelectedChannelId(workspace?.selectedChannelId ?? null);
    setFocusedProcedure(workspace?.focusedProcedure ?? null);
    setHighlightedProcedures(workspace?.highlightedProcedures ?? []);
    setVisibleGraftVisibilityKeys(workspace?.visibleGraftVisibilityKeys ?? []);
    setDrafts(workspace?.drafts ?? {});
    setStepIndex(workspace?.stepIndex ?? 0);
    setLayerVisibility({
      ...(workspace?.layerVisibility ?? simpleDefaultLayerVisibility()),
      grafts: true,
      measurements: true,
    });
    setGlobalOpacity(workspace?.globalOpacity ?? 1);
    setPatientAnatomyMeshes(
      normalized.imaging.segmentationRuns.length || usesBundledDemoAnatomy(normalized) ? [] : null,
    );
    showToast("Browser-saved session and Viewer settings reloaded.");
  };

  return <div className="app-shell simplified-app">
    <header className="command-bar simple-command-bar">
      <div className="brand"><img className="brand-mark" src={publicAssetPath("multilig-planner-logo.png")} alt="" aria-hidden="true" draggable={false} /><div><div className="brand-name">Multilig Planner</div><div className="brand-sub">Clinician-directed 3D planning</div></div></div>
      <div className="toolbar-actions">
        <button className="cmd-btn icon-only" aria-label="Undo" title="Undo" disabled={!history.past.length} onClick={() => setHistory(undoPlan)}>↶</button>
        <button className="cmd-btn icon-only" aria-label="Redo" title="Redo" disabled={!history.future.length} onClick={() => setHistory(redoPlan)}>↷</button>
        <button className="cmd-btn" onClick={() => setShowImport(true)}>Import MRI</button>
        <button className="cmd-btn" title="Save this plan in this browser without changing the published initial parameters" onClick={saveCurrentSession}>Save session</button>
        <button className="cmd-btn" onClick={reloadInitialSession}>Reload initial session</button>
        <button className="cmd-btn" onClick={() => downloadText("multilig-plan.deidentified.json", planToJson(deidentifiedLocalSnapshot(plan)), "application/json")}>Export JSON</button>
      </div>
    </header>

    <main id="planner-workspace" className="simple-workspace" tabIndex={-1}>
      <aside className="left-panel simple-left" aria-label="Renderings">
        <div className="panel-heading"><span>Renderings</span></div>
        <div className="simple-left-body">
          <p>Select any combination. Click a selected structure to focus it; click the focused structure again to hide it.</p>
          <div className="simple-procedure-grid" role="group" aria-label="Structures rendered in 3D">
            {SIMPLIFIED_PROCEDURES.map((item) => <button
              key={item.id}
              type="button"
              aria-pressed={highlightedSet.has(item.id)}
              className={`${highlightedSet.has(item.id) ? "active" : ""} ${focusedProcedure === item.id ? "focused" : ""}`}
              onClick={() => toggleProcedure(item.id)}
            ><span>{item.label}</span><i aria-hidden="true" /></button>)}
          </div>
          <div className="simple-left-layer-toggle" aria-label="Individual graft visibility">
            <div className="simple-graft-list-heading"><strong>Graft previews</strong><span>Toggle on/off graft preview</span></div>
            {viewerModel.grafts.length ? viewerModel.grafts.map((graft) => {
              const requested = visibleGraftVisibilitySet.has(graft.visibilityKey);
              const visible = requested && graft.rendered;
              const title = graftPreviewTitle(graft);
              return <button
                key={graft.visibilityKey}
                type="button"
                className={`simple-graft-toggle ${requested ? "active" : ""}`}
                aria-pressed={requested}
                aria-label={`${title} graft preview`}
                title={graft.unavailableReason ?? "Reconstructed ligament planning preview; not a biomechanical simulation"}
                onClick={() => setVisibleGraftVisibilityKeys((current) => current.includes(graft.visibilityKey)
                  ? current.filter((key) => key !== graft.visibilityKey)
                  : [...current, graft.visibilityKey])}
              >
                <span><strong>{title}</strong><small>{visible ? "Visible" : requested && graft.unavailableReason ? "Not available" : "Hidden"}</small></span>
                <i aria-hidden="true"><b /></i>
              </button>;
            }) : <div className="simple-graft-empty">A graft toggle appears after a highlighted procedure has two valid fixation attachments.</div>}
          </div>
        </div>
      </aside>

      <section className="viewer-column simple-viewer" aria-label="MAT Planner Viewer v2 canvas">
        <div className="viewer-toolbar simple-viewer-toolbar">
          <div className="tool-group">{SIMPLE_LAYERS.map(([layer, label]) => <button
            key={layer}
            className={`tool-button ${layerVisibility[layer] ? "active" : ""}`}
            aria-pressed={layerVisibility[layer]}
            title={layer === "grafts" ? "Reconstructed ligament planning preview; not a biomechanical simulation" : undefined}
            onClick={() => setLayerVisibility((current) => ({ ...current, [layer]: !current[layer] }))}
          >{label}</button>)}</div>
          <label className="simple-opacity"><span>Opacity</span><input aria-label="Viewer opacity" type="range" min="0.2" max="1" step="0.05" value={globalOpacity} onChange={(event) => setGlobalOpacity(Number(event.currentTarget.value))} /></label>
        </div>
        <div className="viewer-stage">
          <MatViewerV2Adapter scene={viewerModel.scene} standardView={standardView} onHandleChange={handleViewerChange} onSelectChannel={selectChannel} onReady={() => setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }))} />
          {hasBundledDemoAnatomy
            && patientAnatomyMeshes?.length === 0
            && (segmentationUi.status === "checking" || segmentationUi.status === "failed")
            ? <div className={`demo-anatomy-status ${segmentationUi.status}`} role="status">
                <strong>{segmentationUi.status === "checking" ? "Loading knee study…" : "Knee study could not be loaded"}</strong>
                <span>{segmentationUi.message}</span>
                {segmentationUi.status === "failed" ? <button type="button" onClick={() => setBundledDemoLoadNonce((value) => value + 1)}>Retry</button> : null}
              </div>
            : null}
          <div className="viewer-overlay-top"><div className="orientation-pad" aria-label="Standard anatomical views">
            <button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+z", nonce: current.nonce + 1 }))}>+SI</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+y", nonce: current.nonce + 1 }))}>+AP</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-z", nonce: current.nonce + 1 }))}>-SI</button>
            <button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-x", nonce: current.nonce + 1 }))}>-ML</button><button className="view-btn center" onClick={() => setStandardView((current) => ({ view: "focus", nonce: current.nonce + 1 }))}>FIT</button><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "+x", nonce: current.nonce + 1 }))}>+ML</button>
            <button className="view-btn" /><button className="view-btn" onClick={() => setStandardView((current) => ({ view: "-y", nonce: current.nonce + 1 }))}>-AP</button><button className="view-btn" />
          </div></div>
        </div>
      </section>

      <TechniquePanel
        draft={activeDraft}
        stepIndex={stepIndex}
        channels={focusedChannels}
        selectedChannelId={selectedChannelId}
        startPointMeasurement={selectedStartPointMeasurement}
        trajectoryMeasurement={selectedTrajectoryMeasurement}
        geometryMatchesDraft={geometryMatchesDraft}
        onDraft={updateTechniqueDraft}
        onStep={setStepIndex}
        onSelectChannel={selectChannel}
        onNumericChannel={updateChannelNumber}
      />
    </main>

    {showImport ? <ImportDialog
      sources={plan.imaging.sources as ImmutableImagingSource[]}
      anatomy={plan.anatomy}
      review={plan.imaging.review}
      onReview={updateImagingReview}
      inputRef={fileInputRef}
      segmentationInputRef={segmentationInputRef}
      segmentationUi={segmentationUi}
      onFiles={importFiles}
      onSegmentationSource={selectMatSegmentationSource}
      onRunSegmentation={() => void runMatSegmentation()}
      onStopSegmentation={() => segmentationAbortRef.current?.abort()}
      onClose={() => setShowImport(false)}
    /> : null}
    {toast ? <div className="toast" role="status">{toast}</div> : null}
  </div>;
}
