import { stableHash } from "./hash";
import {
  GEOMETRY_EPSILON,
  add3,
  assertNonNegative,
  assertPositive,
  createAnnulusMesh,
  createCylinderMesh,
  createExtrusionMesh,
  createFrustumMesh,
  createPolylineTubeMesh,
  distance3,
  emptyMesh,
  extendSegmentEnd,
  mergeMeshes,
  normalize3,
  resolveProfile,
  scale3,
  segmentLength,
  sub3,
  type ProfileDefinition,
  type Segment3,
  type TriangleMesh,
  type Vec3,
} from "./mesh";

export const GEOMETRY_GENERATOR_VERSION = "1.2.0";

export const GEOMETRY_LAYER_TYPES = [
  "boneRemovalOrCompaction",
  "pinTractAndOvershoot",
  "instrumentAccessSweptVolume",
  "cutterDeploymentRetraction",
  "graftOrBoneBlock",
  "retainedFixation",
  "surfaceHardwareAndFlipDeployment",
  "safetyMargin",
] as const;

export type GeometryLayerType = (typeof GEOMETRY_LAYER_TYPES)[number];

export type GeometryOperation =
  | "boneRemoval"
  | "boneCompaction"
  | "transientInstrument"
  | "graft"
  | "retainedImplant"
  | "safetyEnvelope";

export type PrimitiveKind = "capsule" | "supportExtrusion" | "annulus";

export interface AnalyticPrimitive {
  id: string;
  kind: PrimitiveKind;
  /** A polyline is represented as its complete set of finite segments. */
  segments: Segment3[];
  /** Exact radius for capsules; conservative radial support for other extrusions. */
  supportRadiusMm: number;
  innerRadiusMm?: number;
  analysisMode: "exactCapsule" | "conservativeSupportRadius";
  sourceComponent: string;
}

export interface GeometryLayer {
  id: string;
  type: GeometryLayerType;
  label: string;
  operation: GeometryOperation;
  mesh: TriangleMesh;
  primitives: AnalyticPrimitive[];
  renderable: boolean;
  analyzable: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface GeneratedGeometry {
  id: string;
  recipeType: GeometryRecipe["type"];
  generatorVersion: string;
  coordinateSpace: "patient";
  units: "mm";
  layers: GeometryLayer[];
  complete: boolean;
  missingDimensions: string[];
  geometryHash: string;
  metadata?: Record<string, string | number | boolean | null>;
}

interface RecipeBase {
  id: string;
  label?: string;
  /** Include catalog/override provenance when it must invalidate analysis. */
  provenanceHash?: string;
  safetyMarginMm?: number | null;
}

export interface RigidPinRecipe extends RecipeBase {
  type: "rigidPin";
  tract: Segment3;
  diameterMm: number | null;
  tipOvershootMm: number | null;
}

export interface FlexiblePinRecipe extends RecipeBase {
  type: "flexiblePin";
  path: Vec3[];
  diameterMm: number | null;
  tipOvershootMm: number | null;
  minimumBendRadiusMm?: number | null;
}

export interface FullTunnelRecipe extends RecipeBase {
  type: "fullTunnel";
  tunnel: Segment3;
  diameterMm: number | null;
  /** When present, the pin is an independently analyzable layer. */
  pinDiameterMm?: number | null;
  tipOvershootMm?: number | null;
}

export interface BlindSocketRecipe extends RecipeBase {
  type: "blindSocket";
  socket: Segment3;
  socketDiameterMm: number | null;
  pilot?: { tract: Segment3; diameterMm: number | null };
}

export interface RetroSocketRecipe extends RecipeBase {
  type: "retroSocket";
  pilot: Segment3 | null;
  /** Independently rendered coaxial pin; omitted recipes reuse the pilot path. */
  guidePin?: Segment3 | null;
  pilotDiameterMm: number | null;
  socket: Segment3;
  socketDiameterMm: number | null;
  corticalChannel: Segment3 | null;
  corticalChannelDiameterMm: number | null;
  deployment: Segment3 | null;
  deployedCutterDiameterMm: number | null;
}

export interface SteppedButtonTunnelRecipe extends RecipeBase {
  type: "steppedButtonTunnel";
  graftSocket: Segment3;
  graftDiameterMm: number | null;
  corticalChannel: Segment3;
  corticalChannelDiameterMm: number | null;
  flipEnvelope?: { path: Segment3; diameterMm: number | null };
}

export interface FlexibleReamedSocketRecipe extends RecipeBase {
  type: "flexibleReamedSocket";
  socket: Segment3;
  socketDiameterMm: number | null;
  accessPath: Vec3[];
  accessDiameterMm: number | null;
  minimumBendRadiusMm?: number | null;
}

export interface ProfileTunnelRecipe extends RecipeBase {
  type: "profileTunnel";
  tunnel: Segment3;
  profile: ProfileDefinition | null;
  orientationDeg: number;
  twistDeg?: number;
}

export interface OverlappingDilatorRecipe extends RecipeBase {
  type: "overlappingDilator";
  pilotHoles: Array<{ tract: Segment3; diameterMm: number | null }>;
  finalTunnel: Segment3;
  finalProfile: ProfileDefinition | null;
  orientationDeg: number;
  finalPreparation: "dilated" | "compacted";
  pilotOffsetMm?: number | null;
  dilatorAccess?: { segment: Segment3; profile: ProfileDefinition | null };
}

export interface SequentialDilatedRecipe extends RecipeBase {
  type: "sequentialDilated";
  tunnel: Segment3;
  stages: Array<{ profile: ProfileDefinition | null; label?: string }>;
  orientationDeg: number;
  mode: "dilated" | "compacted";
}

export interface CoringTrephineRecipe extends RecipeBase {
  type: "coringTrephine";
  cut: Segment3;
  innerDiameterMm: number | null;
  outerDiameterMm: number | null;
  coreState: "removed" | "retained" | "separable";
  distalPredrill?: { tract: Segment3; diameterMm: number | null };
}

export interface AnchorRecipe extends RecipeBase {
  type: "anchor";
  pilot: Segment3;
  pilotDiameterMm: number | null;
  punchDiameterMm?: number | null;
  tapMajorDiameterMm?: number | null;
  anchor?: { body: Segment3; diameterMm: number | null };
  accessPath?: { points: Vec3[]; diameterMm: number | null };
}

export interface InterferenceScrewRecipe extends RecipeBase {
  type: "interferenceScrew";
  screw: Segment3;
  screwOuterDiameterMm: number | null;
  screwCoreDiameterMm?: number | null;
  sheath?: { body: Segment3; outerDiameterMm: number | null };
  graft?: {
    body: Segment3;
    diameterMm: number | null;
    offsetMm?: number;
    offsetDirection?: Vec3;
  };
}

export interface CorticalButtonRecipe extends RecipeBase {
  type: "corticalButton";
  channel: Segment3;
  channelDiameterMm: number | null;
  button: { body: Segment3; profile: ProfileDefinition | null };
  flipEnvelope: { path: Segment3; diameterMm: number | null };
}

export interface PostWasherRecipe extends RecipeBase {
  type: "postWasher";
  pilot: Segment3;
  pilotDiameterMm: number | null;
  post: Segment3;
  postDiameterMm: number | null;
  washer: { body: Segment3; profile: ProfileDefinition | null };
}

export interface StapleRecipe extends RecipeBase {
  type: "staple";
  legPilots: Array<{ tract: Segment3; diameterMm: number | null }>;
  retainedLegs: Array<{ body: Segment3; diameterMm: number | null }>;
  bridge: { body: Segment3; profile: ProfileDefinition | null };
}

export interface TroughRecipe extends RecipeBase {
  type: "trough";
  recess: Segment3;
  profile: ProfileDefinition | null;
  orientationDeg: number;
  wallSlopeDeg?: number | null;
  accessEnvelope?: { path: Vec3[]; diameterMm: number | null };
}

export interface ChamferRecipe extends RecipeBase {
  type: "chamfer";
  cut: Segment3;
  apertureDiameterMm: number | null;
  innerDiameterMm: number | null;
  accessEnvelope?: { path: Segment3; diameterMm: number | null };
}

export interface NoLargeTunnelRecipe extends RecipeBase {
  type: "noLargeTunnel";
  noLargeTunnel: true;
  smallPilots: Array<{ tract: Segment3; diameterMm: number | null }>;
  retainedFixation?: Array<{ body: Segment3; diameterMm: number | null; label?: string }>;
}

export type GeometryRecipe =
  | RigidPinRecipe
  | FlexiblePinRecipe
  | FullTunnelRecipe
  | BlindSocketRecipe
  | RetroSocketRecipe
  | SteppedButtonTunnelRecipe
  | FlexibleReamedSocketRecipe
  | ProfileTunnelRecipe
  | OverlappingDilatorRecipe
  | SequentialDilatedRecipe
  | CoringTrephineRecipe
  | AnchorRecipe
  | InterferenceScrewRecipe
  | CorticalButtonRecipe
  | PostWasherRecipe
  | StapleRecipe
  | TroughRecipe
  | ChamferRecipe
  | NoLargeTunnelRecipe;

interface LayerPart {
  mesh: TriangleMesh;
  primitive: AnalyticPrimitive;
}

class GeometryBuilder {
  readonly layers: GeometryLayer[] = [];
  readonly missing = new Set<string>();

  constructor(private readonly recipeId: string) {}

  markMissing(path: string): void {
    this.missing.add(path);
  }

  addLayer(
    suffix: string,
    type: GeometryLayerType,
    label: string,
    operation: GeometryOperation,
    parts: LayerPart[],
    metadata?: GeometryLayer["metadata"],
    analyzable = true,
  ): void {
    if (parts.length === 0) return;
    this.layers.push({
      id: `${this.recipeId}:${suffix}`,
      type,
      label,
      operation,
      mesh: mergeMeshes(parts.map((part) => part.mesh)),
      primitives: parts.map((part) => part.primitive),
      renderable: true,
      analyzable,
      metadata,
    });
  }
}

export function generateGeometry(recipe: GeometryRecipe): GeneratedGeometry {
  if (!recipe.id.trim()) throw new Error("geometry recipe id is required");
  const builder = new GeometryBuilder(recipe.id);

  switch (recipe.type) {
    case "rigidPin":
      buildRigidPin(builder, recipe);
      break;
    case "flexiblePin":
      buildFlexiblePin(builder, recipe);
      break;
    case "fullTunnel":
      buildFullTunnel(builder, recipe);
      break;
    case "blindSocket":
      buildBlindSocket(builder, recipe);
      break;
    case "retroSocket":
      buildRetroSocket(builder, recipe);
      break;
    case "steppedButtonTunnel":
      buildSteppedTunnel(builder, recipe);
      break;
    case "flexibleReamedSocket":
      buildFlexibleSocket(builder, recipe);
      break;
    case "profileTunnel":
      addProfileLayer(
        builder,
        "profile-tunnel",
        "boneRemovalOrCompaction",
        `${profileName(recipe.profile)} tunnel`,
        "boneRemoval",
        recipe.tunnel,
        recipe.profile,
        "profile",
        recipe.orientationDeg,
        recipe.twistDeg ?? 0,
      );
      break;
    case "overlappingDilator":
      buildOverlappingDilator(builder, recipe);
      break;
    case "sequentialDilated":
      buildSequentialDilated(builder, recipe);
      break;
    case "coringTrephine":
      buildCoringTrephine(builder, recipe);
      break;
    case "anchor":
      buildAnchor(builder, recipe);
      break;
    case "interferenceScrew":
      buildInterferenceScrew(builder, recipe);
      break;
    case "corticalButton":
      buildCorticalButton(builder, recipe);
      break;
    case "postWasher":
      buildPostWasher(builder, recipe);
      break;
    case "staple":
      buildStaple(builder, recipe);
      break;
    case "trough":
      buildTrough(builder, recipe);
      break;
    case "chamfer":
      buildChamfer(builder, recipe);
      break;
    case "noLargeTunnel":
      buildNoLargeTunnel(builder, recipe);
      break;
  }

  addSafetyMargin(builder, recipe.safetyMarginMm);
  const missingDimensions = [...builder.missing].sort();
  return {
    id: recipe.id,
    recipeType: recipe.type,
    generatorVersion: GEOMETRY_GENERATOR_VERSION,
    coordinateSpace: "patient",
    units: "mm",
    layers: builder.layers,
    complete: missingDimensions.length === 0,
    missingDimensions,
    geometryHash: stableHash({ generatorVersion: GEOMETRY_GENERATOR_VERSION, recipe }),
    metadata: recipe.type === "noLargeTunnel" ? { noLargeTunnel: true } : undefined,
  };
}

function buildRigidPin(builder: GeometryBuilder, recipe: RigidPinRecipe): void {
  const tract = cylinderPart(builder, `${recipe.id}:pin-tract`, recipe.tract, recipe.diameterMm, "diameterMm", "pin tract");
  const parts = tract ? [tract] : [];
  const overshoot = overshootPart(builder, recipe.id, recipe.tract, recipe.diameterMm, recipe.tipOvershootMm);
  if (overshoot) parts.push(overshoot);
  builder.addLayer("pin", "pinTractAndOvershoot", "Rigid guide pin and overshoot", "boneRemoval", parts);
}

function buildFullTunnel(builder: GeometryBuilder, recipe: FullTunnelRecipe): void {
  addCylinderLayer(builder, "tunnel", "boneRemovalOrCompaction", "Full tunnel", "boneRemoval", recipe.tunnel, recipe.diameterMm, "diameterMm");
  if (!("pinDiameterMm" in recipe) && !("tipOvershootMm" in recipe)) return;
  const tract = cylinderPart(builder, `${recipe.id}:guide-pin`, recipe.tunnel, recipe.pinDiameterMm ?? null, "pinDiameterMm", "guide pin tract");
  const parts = tract ? [tract] : [];
  const overshoot = overshootPart(builder, `${recipe.id}:guide-pin`, recipe.tunnel, recipe.pinDiameterMm ?? null, recipe.tipOvershootMm ?? null);
  if (overshoot) parts.push(overshoot);
  builder.addLayer("guide-pin", "pinTractAndOvershoot", "Guide pin tract and predicted overshoot", "boneRemoval", parts);
}

function buildFlexiblePin(builder: GeometryBuilder, recipe: FlexiblePinRecipe): void {
  const path = polylinePart(builder, `${recipe.id}:flexible-pin`, recipe.path, recipe.diameterMm, "diameterMm", "flexible pin");
  const parts = path ? [path] : [];
  if (recipe.path.length >= 2) {
    const lastSegment = { start: recipe.path[recipe.path.length - 2], end: recipe.path[recipe.path.length - 1] };
    const overshoot = overshootPart(builder, recipe.id, lastSegment, recipe.diameterMm, recipe.tipOvershootMm);
    if (overshoot) parts.push(overshoot);
  } else {
    builder.markMissing("path");
  }
  if (recipe.minimumBendRadiusMm === null) builder.markMissing("minimumBendRadiusMm");
  else if (recipe.minimumBendRadiusMm !== undefined) assertPositive(recipe.minimumBendRadiusMm, "minimum bend radius");
  builder.addLayer(
    "flexible-pin",
    "pinTractAndOvershoot",
    "Flexible guide pin and overshoot",
    "boneRemoval",
    parts,
    { minimumBendRadiusMm: recipe.minimumBendRadiusMm ?? null },
  );
}

function overshootPart(
  builder: GeometryBuilder,
  recipeId: string,
  tract: Segment3,
  diameterMm: number | null,
  overshootMm: number | null,
): LayerPart | undefined {
  if (overshootMm === null) {
    builder.markMissing("tipOvershootMm");
    return undefined;
  }
  assertNonNegative(overshootMm, "tip overshoot");
  if (overshootMm <= GEOMETRY_EPSILON || diameterMm === null) return undefined;
  const extended = extendSegmentEnd(tract, overshootMm);
  const segment = { start: tract.end, end: extended.end };
  return cylinderPart(builder, `${recipeId}:tip-overshoot`, segment, diameterMm, "diameterMm", "tip overshoot");
}

function buildBlindSocket(builder: GeometryBuilder, recipe: BlindSocketRecipe): void {
  addCylinderLayer(
    builder,
    "socket",
    "boneRemovalOrCompaction",
    "Antegrade blind socket",
    "boneRemoval",
    recipe.socket,
    recipe.socketDiameterMm,
    "socketDiameterMm",
  );
  if (recipe.pilot) {
    addCylinderLayer(
      builder,
      "pilot",
      "pinTractAndOvershoot",
      "Socket pilot tract",
      "boneRemoval",
      recipe.pilot.tract,
      recipe.pilot.diameterMm,
      "pilot.diameterMm",
    );
  }
}

function buildRetroSocket(builder: GeometryBuilder, recipe: RetroSocketRecipe): void {
  const boneParts: LayerPart[] = [];
  if (recipe.pilot === null) builder.markMissing("pilotLengthMm");
  if (recipe.corticalChannel === null) builder.markMissing("corticalChannelLengthMm");
  const pilot = recipe.pilot === null ? undefined : cylinderPart(builder, `${recipe.id}:retro-pilot`, recipe.pilot, recipe.pilotDiameterMm, "pilotDiameterMm", "retro pilot");
  const socket = cylinderPart(builder, `${recipe.id}:retro-socket`, recipe.socket, recipe.socketDiameterMm, "socketDiameterMm", "retro socket");
  const cortical = recipe.corticalChannel === null ? undefined : cylinderPart(
    builder,
    `${recipe.id}:cortical-channel`,
    recipe.corticalChannel,
    recipe.corticalChannelDiameterMm,
    "corticalChannelDiameterMm",
    "cortical channel",
  );
  if (pilot) boneParts.push(pilot);
  if (socket) boneParts.push(socket);
  if (cortical) boneParts.push(cortical);
  builder.addLayer("retro-bone", "boneRemovalOrCompaction", "Retro pilot, socket, and cortical channel", "boneRemoval", boneParts);
  const guidePin = recipe.guidePin === undefined ? recipe.pilot : recipe.guidePin;
  if (guidePin) {
    addCylinderLayer(
      builder,
      "retro-guide-pin",
      "pinTractAndOvershoot",
      "Retro socket coaxial guide pin",
      "transientInstrument",
      guidePin,
      recipe.pilotDiameterMm,
      "pilotDiameterMm",
    );
  }
  if (recipe.deployment === null) builder.markMissing("deploymentLengthMm");
  const deployment = recipe.deployment === null ? undefined : cylinderPart(
      builder,
      `${recipe.id}:deployment`,
      recipe.deployment,
      recipe.deployedCutterDiameterMm,
      "deployedCutterDiameterMm",
      "cutter deployment",
    );
  builder.addLayer(
    "retro-deployment",
    "cutterDeploymentRetraction",
    "Retro cutter deployment and retraction",
    "transientInstrument",
    deployment ? [deployment] : [],
  );
}

function buildSteppedTunnel(builder: GeometryBuilder, recipe: SteppedButtonTunnelRecipe): void {
  const parts: LayerPart[] = [];
  const socket = cylinderPart(builder, `${recipe.id}:graft-socket`, recipe.graftSocket, recipe.graftDiameterMm, "graftDiameterMm", "graft socket");
  const channel = cylinderPart(
    builder,
    `${recipe.id}:button-channel`,
    recipe.corticalChannel,
    recipe.corticalChannelDiameterMm,
    "corticalChannelDiameterMm",
    "button channel",
  );
  if (socket) parts.push(socket);
  if (channel) parts.push(channel);
  builder.addLayer("stepped-tunnel", "boneRemovalOrCompaction", "Stepped graft socket and button channel", "boneRemoval", parts);
  if (recipe.flipEnvelope) {
    addCylinderLayer(
      builder,
      "flip-envelope",
      "surfaceHardwareAndFlipDeployment",
      "Button flip envelope",
      "transientInstrument",
      recipe.flipEnvelope.path,
      recipe.flipEnvelope.diameterMm,
      "flipEnvelope.diameterMm",
    );
  }
}

function buildFlexibleSocket(builder: GeometryBuilder, recipe: FlexibleReamedSocketRecipe): void {
  addCylinderLayer(
    builder,
    "flexible-socket",
    "boneRemovalOrCompaction",
    "Flexible-reamed straight intraosseous socket",
    "boneRemoval",
    recipe.socket,
    recipe.socketDiameterMm,
    "socketDiameterMm",
  );
  const access = polylinePart(
    builder,
    `${recipe.id}:curved-access`,
    recipe.accessPath,
    recipe.accessDiameterMm,
    "accessDiameterMm",
    "curved access",
  );
  if (recipe.minimumBendRadiusMm === null) builder.markMissing("minimumBendRadiusMm");
  else if (recipe.minimumBendRadiusMm !== undefined) assertPositive(recipe.minimumBendRadiusMm, "minimum bend radius");
  builder.addLayer(
    "curved-access",
    "instrumentAccessSweptVolume",
    "Flexible shaft curved access envelope",
    "transientInstrument",
    access ? [access] : [],
    { minimumBendRadiusMm: recipe.minimumBendRadiusMm ?? null },
  );
}

function buildOverlappingDilator(builder: GeometryBuilder, recipe: OverlappingDilatorRecipe): void {
  if (recipe.pilotOffsetMm === null) builder.markMissing("pilotOffsetMm");
  const pilotParts = recipe.pilotHoles.flatMap((hole, index) => {
    const part = cylinderPart(
      builder,
      `${recipe.id}:overlap-hole-${index + 1}`,
      hole.tract,
      hole.diameterMm,
      `pilotHoles[${index}].diameterMm`,
      `overlap hole ${index + 1}`,
    );
    return part ? [part] : [];
  });
  if (recipe.pilotHoles.length === 0) builder.markMissing("pilotHoles");
  builder.addLayer("overlap-holes", "boneRemovalOrCompaction", "Overlapping reamed holes", "boneRemoval", pilotParts);
  addProfileLayer(
    builder,
    "dilated-profile",
    "boneRemovalOrCompaction",
    `Final ${profileName(recipe.finalProfile)} ${recipe.finalPreparation} profile`,
    "boneCompaction",
    recipe.finalTunnel,
    recipe.finalProfile,
    "finalProfile",
    recipe.orientationDeg,
    0,
    { preparation: recipe.finalPreparation },
  );
  if (recipe.dilatorAccess) {
    addProfileLayer(
      builder,
      "dilator-access",
      "instrumentAccessSweptVolume",
      "Shape-specific dilator swept volume",
      "transientInstrument",
      recipe.dilatorAccess.segment,
      recipe.dilatorAccess.profile,
      "dilatorAccess.profile",
      recipe.orientationDeg,
    );
  }
}

function buildSequentialDilated(builder: GeometryBuilder, recipe: SequentialDilatedRecipe): void {
  if (recipe.stages.length === 0) builder.markMissing("stages");
  recipe.stages.forEach((stage, index) => {
    addProfileLayer(
      builder,
      `dilation-stage-${index + 1}`,
      "boneRemovalOrCompaction",
      stage.label ?? `Sequential ${recipe.mode} stage ${index + 1}`,
      "boneCompaction",
      recipe.tunnel,
      stage.profile,
      `stages[${index}].profile`,
      recipe.orientationDeg,
      0,
      { stage: index + 1, preparation: recipe.mode, final: index === recipe.stages.length - 1 },
    );
  });
}

function buildCoringTrephine(builder: GeometryBuilder, recipe: CoringTrephineRecipe): void {
  const inner = requiredDimension(builder, recipe.innerDiameterMm, "innerDiameterMm");
  const outer = requiredDimension(builder, recipe.outerDiameterMm, "outerDiameterMm");
  if (inner !== undefined && outer !== undefined) {
    if (inner >= outer) throw new Error("coring inner diameter must be smaller than outer diameter");
    const primitive = primitiveForSegments(
      `${recipe.id}:annular-kerf`,
      "annulus",
      [recipe.cut],
      outer / 2,
      "annular kerf",
      inner / 2,
    );
    builder.addLayer(
      "annular-kerf",
      "boneRemovalOrCompaction",
      "Coring trephine annular kerf",
      "boneRemoval",
      [{ mesh: createAnnulusMesh(recipe.cut, inner / 2, outer / 2), primitive }],
    );
    const core = makeCylinderPart(`${recipe.id}:core`, recipe.cut, inner, "separable core");
    builder.addLayer(
      "core",
      "graftOrBoneBlock",
      `Coring reamer core (${recipe.coreState})`,
      "graft",
      [core],
      { coreState: recipe.coreState },
      recipe.coreState !== "removed",
    );
  }
  if (recipe.distalPredrill) {
    addCylinderLayer(
      builder,
      "distal-predrill",
      "boneRemovalOrCompaction",
      "Coring distal predrill",
      "boneRemoval",
      recipe.distalPredrill.tract,
      recipe.distalPredrill.diameterMm,
      "distalPredrill.diameterMm",
    );
  }
}

function buildAnchor(builder: GeometryBuilder, recipe: AnchorRecipe): void {
  const pilotParts: LayerPart[] = [];
  const pilot = cylinderPart(builder, `${recipe.id}:anchor-pilot`, recipe.pilot, recipe.pilotDiameterMm, "pilotDiameterMm", "anchor pilot");
  if (pilot) pilotParts.push(pilot);
  for (const [field, value] of [["punchDiameterMm", recipe.punchDiameterMm], ["tapMajorDiameterMm", recipe.tapMajorDiameterMm]] as const) {
    if (value === undefined) continue;
    const part = cylinderPart(builder, `${recipe.id}:${field}`, recipe.pilot, value, field, field);
    if (part) pilotParts.push(part);
  }
  builder.addLayer("anchor-pilot", "boneRemovalOrCompaction", "Anchor drill, punch, and tap pilot", "boneRemoval", pilotParts);
  if (recipe.anchor) {
    addCylinderLayer(
      builder,
      "retained-anchor",
      "retainedFixation",
      "Retained anchor envelope",
      "retainedImplant",
      recipe.anchor.body,
      recipe.anchor.diameterMm,
      "anchor.diameterMm",
    );
  }
  if (recipe.accessPath) {
    const access = polylinePart(
      builder,
      `${recipe.id}:anchor-access`,
      recipe.accessPath.points,
      recipe.accessPath.diameterMm,
      "accessPath.diameterMm",
      "anchor access",
    );
    builder.addLayer("anchor-access", "instrumentAccessSweptVolume", "Anchor guide access envelope", "transientInstrument", access ? [access] : []);
  }
}

function buildInterferenceScrew(builder: GeometryBuilder, recipe: InterferenceScrewRecipe): void {
  addCylinderLayer(
    builder,
    "interference-screw",
    "retainedFixation",
    "Interference screw thread envelope",
    "retainedImplant",
    recipe.screw,
    recipe.screwOuterDiameterMm,
    "screwOuterDiameterMm",
    { screwCoreDiameterMm: recipe.screwCoreDiameterMm ?? null },
  );
  if (recipe.screwCoreDiameterMm === null) builder.markMissing("screwCoreDiameterMm");
  else if (recipe.screwCoreDiameterMm !== undefined) assertPositive(recipe.screwCoreDiameterMm, "screw core diameter");
  if (recipe.sheath) {
    addCylinderLayer(
      builder,
      "sheath",
      "retainedFixation",
      "Interference sheath envelope",
      "retainedImplant",
      recipe.sheath.body,
      recipe.sheath.outerDiameterMm,
      "sheath.outerDiameterMm",
    );
  }
  if (recipe.graft) {
    let graftBody = recipe.graft.body;
    if (recipe.graft.offsetMm !== undefined) {
      assertNonNegative(Math.abs(recipe.graft.offsetMm), "graft offset");
      if (!recipe.graft.offsetDirection) builder.markMissing("graft.offsetDirection");
      else {
        const offset = scale3(normalize3(recipe.graft.offsetDirection, "graft offset direction"), recipe.graft.offsetMm);
        graftBody = { start: add3(graftBody.start, offset), end: add3(graftBody.end, offset) };
      }
    }
    addCylinderLayer(
      builder,
      "graft",
      "graftOrBoneBlock",
      "Graft volume",
      "graft",
      graftBody,
      recipe.graft.diameterMm,
      "graft.diameterMm",
    );
  }
}

function buildCorticalButton(builder: GeometryBuilder, recipe: CorticalButtonRecipe): void {
  addCylinderLayer(
    builder,
    "button-channel",
    "boneRemovalOrCompaction",
    "Cortical button passing channel",
    "boneRemoval",
    recipe.channel,
    recipe.channelDiameterMm,
    "channelDiameterMm",
  );
  addProfileLayer(
    builder,
    "button",
    "surfaceHardwareAndFlipDeployment",
    "Cortical button or plate",
    "retainedImplant",
    recipe.button.body,
    recipe.button.profile,
    "button.profile",
  );
  addCylinderLayer(
    builder,
    "button-flip",
    "surfaceHardwareAndFlipDeployment",
    "Button flip and deployment envelope",
    "transientInstrument",
    recipe.flipEnvelope.path,
    recipe.flipEnvelope.diameterMm,
    "flipEnvelope.diameterMm",
  );
}

function buildPostWasher(builder: GeometryBuilder, recipe: PostWasherRecipe): void {
  addCylinderLayer(builder, "post-pilot", "boneRemovalOrCompaction", "Post screw pilot", "boneRemoval", recipe.pilot, recipe.pilotDiameterMm, "pilotDiameterMm");
  addCylinderLayer(builder, "post", "retainedFixation", "Retained post screw", "retainedImplant", recipe.post, recipe.postDiameterMm, "postDiameterMm");
  addProfileLayer(builder, "washer", "surfaceHardwareAndFlipDeployment", "Washer surface footprint", "retainedImplant", recipe.washer.body, recipe.washer.profile, "washer.profile");
}

function buildStaple(builder: GeometryBuilder, recipe: StapleRecipe): void {
  const pilots = recipe.legPilots.flatMap((pilot, index) => {
    const part = cylinderPart(builder, `${recipe.id}:staple-pilot-${index + 1}`, pilot.tract, pilot.diameterMm, `legPilots[${index}].diameterMm`, `staple pilot ${index + 1}`);
    return part ? [part] : [];
  });
  if (recipe.legPilots.length === 0) builder.markMissing("legPilots");
  builder.addLayer("staple-pilots", "boneRemovalOrCompaction", "Staple leg pilots", "boneRemoval", pilots);
  const legs = recipe.retainedLegs.flatMap((leg, index) => {
    const part = cylinderPart(builder, `${recipe.id}:staple-leg-${index + 1}`, leg.body, leg.diameterMm, `retainedLegs[${index}].diameterMm`, `staple leg ${index + 1}`);
    return part ? [part] : [];
  });
  builder.addLayer("staple-legs", "retainedFixation", "Retained staple legs", "retainedImplant", legs);
  addProfileLayer(builder, "staple-bridge", "surfaceHardwareAndFlipDeployment", "Staple surface bridge", "retainedImplant", recipe.bridge.body, recipe.bridge.profile, "bridge.profile");
}

function buildTrough(builder: GeometryBuilder, recipe: TroughRecipe): void {
  addProfileLayer(
    builder,
    "trough",
    "boneRemovalOrCompaction",
    "PCL inlay trough or bone-block recess",
    "boneRemoval",
    recipe.recess,
    recipe.profile,
    "profile",
    recipe.orientationDeg,
    0,
    { wallSlopeDeg: recipe.wallSlopeDeg ?? null },
  );
  if (recipe.wallSlopeDeg === null) builder.markMissing("wallSlopeDeg");
  if (recipe.accessEnvelope) {
    const access = polylinePart(builder, `${recipe.id}:trough-access`, recipe.accessEnvelope.path, recipe.accessEnvelope.diameterMm, "accessEnvelope.diameterMm", "trough tool access");
    builder.addLayer("trough-access", "instrumentAccessSweptVolume", "Saw, burr, or osteotome access envelope", "transientInstrument", access ? [access] : []);
  }
}

function buildChamfer(builder: GeometryBuilder, recipe: ChamferRecipe): void {
  const apertureDiameter = requiredDimension(builder, recipe.apertureDiameterMm, "apertureDiameterMm");
  const innerDiameter = requiredDimension(builder, recipe.innerDiameterMm, "innerDiameterMm");
  if (apertureDiameter !== undefined && innerDiameter !== undefined) {
    const supportRadius = Math.max(apertureDiameter, innerDiameter) / 2;
    const primitive = primitiveForSegments(
      `${recipe.id}:chamfer`,
      "supportExtrusion",
      [recipe.cut],
      supportRadius,
      "aperture chamfer",
    );
    builder.addLayer(
      "chamfer",
      "boneRemovalOrCompaction",
      "Aperture chamfer, notch, or keyhole",
      "boneRemoval",
      [{ mesh: createFrustumMesh(recipe.cut, apertureDiameter / 2, innerDiameter / 2), primitive }],
    );
  }
  if (recipe.accessEnvelope) {
    addCylinderLayer(builder, "chamfer-access", "instrumentAccessSweptVolume", "Chamfer tool access envelope", "transientInstrument", recipe.accessEnvelope.path, recipe.accessEnvelope.diameterMm, "accessEnvelope.diameterMm");
  }
}

function buildNoLargeTunnel(builder: GeometryBuilder, recipe: NoLargeTunnelRecipe): void {
  const pilots = recipe.smallPilots.flatMap((pilot, index) => {
    const part = cylinderPart(builder, `${recipe.id}:small-pilot-${index + 1}`, pilot.tract, pilot.diameterMm, `smallPilots[${index}].diameterMm`, `small fixation pilot ${index + 1}`);
    return part ? [part] : [];
  });
  builder.addLayer(
    "small-pilots",
    "boneRemovalOrCompaction",
    "No-large-tunnel construct: actual small fixation pilots",
    "boneRemoval",
    pilots,
    { noLargeTunnel: true },
  );
  const retained = (recipe.retainedFixation ?? []).flatMap((fixation, index) => {
    const part = cylinderPart(builder, `${recipe.id}:small-fixation-${index + 1}`, fixation.body, fixation.diameterMm, `retainedFixation[${index}].diameterMm`, fixation.label ?? `small fixation ${index + 1}`);
    return part ? [part] : [];
  });
  builder.addLayer("retained-small-fixation", "retainedFixation", "No-large-tunnel retained fixation", "retainedImplant", retained, { noLargeTunnel: true });
}

function addCylinderLayer(
  builder: GeometryBuilder,
  suffix: string,
  type: GeometryLayerType,
  label: string,
  operation: GeometryOperation,
  segment: Segment3,
  diameterMm: number | null,
  missingPath: string,
  metadata?: GeometryLayer["metadata"],
): void {
  const part = cylinderPart(builder, `${suffix}:${missingPath}`, segment, diameterMm, missingPath, label);
  builder.addLayer(suffix, type, label, operation, part ? [part] : [], metadata);
}

function addProfileLayer(
  builder: GeometryBuilder,
  suffix: string,
  type: GeometryLayerType,
  label: string,
  operation: GeometryOperation,
  segment: Segment3,
  profile: ProfileDefinition | null,
  missingPath: string,
  orientationDeg = 0,
  twistDeg = 0,
  metadata?: GeometryLayer["metadata"],
): void {
  if (profile === null) {
    builder.markMissing(missingPath);
    return;
  }
  const resolved = resolveProfile(profile);
  const primitive = primitiveForSegments(
    `${suffix}:${missingPath}`,
    "supportExtrusion",
    [segment],
    resolved.supportRadiusMm,
    label,
  );
  builder.addLayer(
    suffix,
    type,
    label,
    operation,
    [{ mesh: createExtrusionMesh(resolved, segment, orientationDeg, twistDeg), primitive }],
    { ...metadata, profileKind: profile.kind, orientationDeg, twistDeg },
  );
}

function cylinderPart(
  builder: GeometryBuilder,
  id: string,
  segment: Segment3,
  diameterMm: number | null,
  missingPath: string,
  sourceComponent: string,
): LayerPart | undefined {
  const diameter = requiredDimension(builder, diameterMm, missingPath);
  if (diameter === undefined) return undefined;
  return makeCylinderPart(id, segment, diameter, sourceComponent);
}

function makeCylinderPart(id: string, segment: Segment3, diameterMm: number, sourceComponent: string): LayerPart {
  assertPositive(diameterMm, `${sourceComponent} diameter`);
  if (segmentLength(segment) <= GEOMETRY_EPSILON) throw new Error(`${sourceComponent} segment must have length`);
  return {
    mesh: createCylinderMesh(segment, diameterMm / 2),
    primitive: primitiveForSegments(id, "capsule", [segment], diameterMm / 2, sourceComponent),
  };
}

function polylinePart(
  builder: GeometryBuilder,
  id: string,
  points: Vec3[],
  diameterMm: number | null,
  missingPath: string,
  sourceComponent: string,
): LayerPart | undefined {
  const diameter = requiredDimension(builder, diameterMm, missingPath);
  if (diameter === undefined) return undefined;
  if (points.length < 2) {
    builder.markMissing(`${missingPath}.path`);
    return undefined;
  }
  const segments: Segment3[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (distance3(points[index], points[index + 1]) > GEOMETRY_EPSILON) {
      segments.push({ start: points[index], end: points[index + 1] });
    }
  }
  if (segments.length === 0) {
    builder.markMissing(`${missingPath}.path`);
    return undefined;
  }
  return {
    mesh: createPolylineTubeMesh(points, diameter / 2),
    primitive: primitiveForSegments(id, "capsule", segments, diameter / 2, sourceComponent),
  };
}

function primitiveForSegments(
  id: string,
  kind: PrimitiveKind,
  segments: Segment3[],
  supportRadiusMm: number,
  sourceComponent: string,
  innerRadiusMm?: number,
): AnalyticPrimitive {
  assertPositive(supportRadiusMm, `${sourceComponent} support radius`);
  return {
    id,
    kind,
    segments,
    supportRadiusMm,
    innerRadiusMm,
    // Rendered bores have finite flat caps; the analytic capsule/support bound is
    // intentionally classified conservative until an exact mesh/BVH backend is connected.
    analysisMode: "conservativeSupportRadius",
    sourceComponent,
  };
}

function requiredDimension(
  builder: GeometryBuilder,
  value: number | null,
  path: string,
): number | undefined {
  if (value === null) {
    builder.markMissing(path);
    return undefined;
  }
  assertPositive(value, path);
  return value;
}

function profileName(profile: ProfileDefinition | null): string {
  return profile?.kind ?? "incomplete-profile";
}

function addSafetyMargin(builder: GeometryBuilder, requestedMargin: number | null | undefined): void {
  if (requestedMargin === undefined || requestedMargin === 0) return;
  if (requestedMargin === null) {
    builder.markMissing("safetyMarginMm");
    return;
  }
  assertPositive(requestedMargin, "safety margin");
  const physicalLayers = builder.layers.filter((layer) => layer.type !== "safetyMargin" && layer.analyzable);
  const parts: LayerPart[] = [];
  for (const layer of physicalLayers) {
    for (const primitive of layer.primitives) {
      const expandedRadius = primitive.supportRadiusMm + requestedMargin;
      const expanded: AnalyticPrimitive = {
        ...primitive,
        id: `${primitive.id}:safety-${requestedMargin}`,
        kind: "supportExtrusion",
        supportRadiusMm: expandedRadius,
        analysisMode: "conservativeSupportRadius",
        sourceComponent: `${primitive.sourceComponent} safety margin`,
      };
      const meshes = primitive.segments.map((segment) => createCylinderMesh(segment, expandedRadius, 16));
      parts.push({ mesh: mergeMeshes(meshes), primitive: expanded });
    }
  }
  builder.addLayer(
    `safety-${requestedMargin}`,
    "safetyMargin",
    `${requestedMargin} mm safety margin`,
    "safetyEnvelope",
    parts,
    { marginMm: requestedMargin },
  );
}

/** Convenience helper used by editing handles and fixtures. */
export function segmentAlong(start: Vec3, direction: Vec3, lengthMm: number): Segment3 {
  assertPositive(lengthMm, "length");
  return { start, end: add3(start, scale3(normalize3(direction), lengthMm)) };
}

/** Reverses a socket axis without changing its patient-space endpoints. */
export function reverseSegment(segment: Segment3): Segment3 {
  return { start: { ...segment.end }, end: { ...segment.start } };
}

/** Returns an empty, explicitly incomplete geometry for adapter failures. */
export function unavailableGeometry(id: string, recipeType: GeometryRecipe["type"], reason: string): GeneratedGeometry {
  return {
    id,
    recipeType,
    generatorVersion: GEOMETRY_GENERATOR_VERSION,
    coordinateSpace: "patient",
    units: "mm",
    layers: [{
      id: `${id}:unavailable`,
      type: "boneRemovalOrCompaction",
      label: "Geometry unavailable",
      operation: "boneRemoval",
      mesh: emptyMesh(),
      primitives: [],
      renderable: false,
      analyzable: false,
      metadata: { reason },
    }],
    complete: false,
    missingDimensions: [reason],
    geometryHash: stableHash({ generatorVersion: GEOMETRY_GENERATOR_VERSION, id, recipeType, reason }),
  };
}

/** Returns a unit direction and measured length for numeric editing UIs. */
export function describeAxis(segment: Segment3): { direction: Vec3; lengthMm: number } {
  const delta = sub3(segment.end, segment.start);
  return { direction: normalize3(delta), lengthMm: segmentLength(segment) };
}
