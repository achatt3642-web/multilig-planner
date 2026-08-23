import type { ChannelPlan, CrossSection, ProcedureIdentity, Vector3 } from "../domain/types";
import { INSTRUMENTS, PRODUCT_VARIANTS } from "../catalog/deviceCatalog";
import { assessCatalogChain, instrumentChainSelectionHash } from "../catalog/chainValidation";
import {
  generateGeometry,
  segmentAlong,
  unavailableGeometry,
  type GeneratedGeometry,
  type GeometryRecipe,
} from "../geometry/recipes";
import {
  deterministicPerpendicular,
  type ProfileDefinition,
  type TriangleMesh,
  type Vec3,
} from "../geometry/mesh";
import type {
  ViewerHandlePayload,
  ViewerLabelPayload,
  ViewerLayer,
  ViewerLinePayload,
  ViewerMeshPayload,
  ViewerPlanningScene,
} from "../viewer/types";
import { classifyChannelEntryTether } from "./channelEntryTether";
import {
  buildReconstructedLigamentPayloads,
  type ReconstructedLigamentDescriptor,
} from "./reconstructedLigamentGeometry";
import {
  resolvedChannelDepthMm,
  resolvedChannelDiameterMm,
  resolvedChannelGuidePinDiameterMm,
} from "./resolvedChannelGeometry";
import {
  anchorTrajectoryRodEnd,
  resolveChannelStartPointPatientRas,
  resolvedTrajectoryControlMode,
} from "./channelTrajectorySemantics";

export {
  ANCHOR_TRAJECTORY_ROD_LENGTH_MM,
  anchorTrajectoryRodEnd,
} from "./channelTrajectorySemantics";

const PROCEDURE_COLORS: Record<string, string> = {
  ACL: "#5eb5e8",
  PCL: "#e5484d",
  PLC_FCL: "#8b5cf6",
  MCL_POL_PMC: "#f28c28",
  ALL: "#166534",
  LET: "#ec8fb3",
  MEDIAL_ROOT: "#8b949e",
  LATERAL_ROOT: "#f8fafc",
  CUSTOM: "#c5cdd2",
};

const LAYER_MAP: Record<string, ViewerLayer> = {
  boneRemovalOrCompaction: "boneRemoval",
  pinTractAndOvershoot: "pins",
  instrumentAccessSweptVolume: "access",
  cutterDeploymentRetraction: "deployment",
  graftOrBoneBlock: "grafts",
  retainedFixation: "hardware",
  surfaceHardwareAndFlipDeployment: "hardware",
  safetyMargin: "safety",
};

const LAYER_COLOR: Record<ViewerLayer, string> = {
  bones: "#c8d3d5",
  landmarks: "#f4d35e",
  mri: "#61a7c7",
  boneRemoval: "#43d8cf",
  pins: "#f6d56b",
  access: "#5eb5e8",
  deployment: "#f093c2",
  grafts: "#b78ef4",
  hardware: "#efb54c",
  previous: "#d8c4a2",
  safety: "#f16f76",
  measurements: "#e8f0f2",
  ghost: "#8f9dab",
};

const DEFAULT_LAYER_VISIBILITY: ViewerPlanningScene["layerVisibility"] = {
  bones: true,
  landmarks: true,
  mri: false,
  boneRemoval: true,
  pins: true,
  access: true,
  deployment: true,
  grafts: false,
  hardware: true,
  previous: true,
  safety: true,
  measurements: true,
  ghost: true,
};

/**
 * Presentation-only radius for a fixation/suture location that deliberately
 * has no drilled volume. It matches Viewer v2's Entry marker radius, but is
 * never included in deterministic collision geometry.
 */
export const POINT_ONLY_LOCATION_MARKER_RADIUS_MM = 1.93;

export function tupleToVec3(value: Vector3): Vec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

export function vec3ToTuple(value: Vec3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function crossSectionProfile(crossSection: CrossSection): ProfileDefinition | null {
  switch (crossSection.kind) {
    case "circle":
      return crossSection.diameterMm === null
        ? null
        : { kind: "ellipse", widthMm: crossSection.diameterMm, heightMm: crossSection.diameterMm };
    case "ellipse":
      return crossSection.majorMm === null || crossSection.minorMm === null
        ? null
        : { kind: "ellipse", widthMm: crossSection.majorMm, heightMm: crossSection.minorMm };
    case "stadium":
      return crossSection.widthMm === null || crossSection.heightMm === null
        ? null
        : { kind: "stadium", widthMm: crossSection.widthMm, heightMm: crossSection.heightMm };
    case "rectangle":
      return crossSection.widthMm === null || crossSection.heightMm === null
        ? null
        : { kind: "rectangle", widthMm: crossSection.widthMm, heightMm: crossSection.heightMm };
    case "rounded_rectangle":
      return crossSection.widthMm === null || crossSection.heightMm === null || crossSection.cornerRadiusMm === null
        ? null
        : { kind: "roundedRectangle", widthMm: crossSection.widthMm, heightMm: crossSection.heightMm, cornerRadiusMm: crossSection.cornerRadiusMm };
    case "c_profile":
      return crossSection.outerRadiusMm === null || crossSection.innerRadiusMm === null || crossSection.openingDeg === null
        ? null
        : { kind: "cProfile", outerRadiusMm: crossSection.outerRadiusMm, innerRadiusMm: crossSection.innerRadiusMm, gapAngleDeg: crossSection.openingDeg };
    case "slot_ribbon":
      return crossSection.widthMm === null || crossSection.thicknessMm === null
        ? null
        : { kind: "ribbon", widthMm: crossSection.widthMm, thicknessMm: crossSection.thicknessMm };
    case "polygon":
      return crossSection.pointsMm.length < 3
        ? null
        : { kind: "polygon", points: crossSection.pointsMm.map(([x, y]) => ({ x, y })) };
    case "imported_profile":
      return !crossSection.assetId.trim() || crossSection.scaleMmPerUnit === null || crossSection.scaleMmPerUnit <= 0 || crossSection.pointsSourceUnits.length < 3
        ? null
        : {
          kind: "importedProfile",
          sourceId: crossSection.assetId,
          points: crossSection.pointsSourceUnits.map(([x, y]) => ({
            x: x * crossSection.scaleMmPerUnit!,
            y: y * crossSection.scaleMmPerUnit!,
          })),
        };
  }
}

const measuredDiameter = resolvedChannelDiameterMm;
const measuredDepth = resolvedChannelDepthMm;

function isPointOnlyNoLargeTunnel(channel: ChannelPlan): boolean {
  if (channel.geometryType !== "onlay_no_large_tunnel") return false;
  // `preparationMode: none` is the persisted semantic signal that the channel
  // represents a location only. Ignore any stale/default numeric values rather
  // than turning them into an unrequested pilot cylinder.
  if (channel.preparationMode === "none") return true;
  const diameterMm = measuredDiameter(channel);
  const depthMm = measuredDepth(channel);
  return diameterMm === null || diameterMm <= 0 || depthMm === null || depthMm <= 0;
}

function persistedOuterCortexStart(channel: ChannelPlan): [number, number, number] | null {
  const attachment = channel.endpointSurfaceAttachment;
  if (
    !attachment ||
    attachment.coordinateSpace !== "patient_ras" ||
    attachment.units !== "mm" ||
    attachment.bone !== channel.bone ||
    attachment.targetKind !== "whole_bone_surface" ||
    !attachment.attachedPointPatientRasMm.every(Number.isFinite)
  ) return null;
  return [
    attachment.attachedPointPatientRasMm[0],
    attachment.attachedPointPatientRasMm[1],
    attachment.attachedPointPatientRasMm[2],
  ];
}

function unavailable(channel: ChannelPlan, reason: string): GeneratedGeometry {
  const type = channel.geometryType === "onlay_no_large_tunnel" ? "noLargeTunnel" : "fullTunnel";
  return unavailableGeometry(channel.id, type, reason);
}

export function channelToGeometry(channel: ChannelPlan): GeneratedGeometry {
  const chainGeometry = assessCatalogChain(channel.instrumentChain);
  if (isPointOnlyNoLargeTunnel(channel)) {
    if (!channel.aperture.every(Number.isFinite)) {
      return unavailable(channel, "valid point-only fixation location");
    }
    return generateGeometry({
      id: channel.id,
      type: "noLargeTunnel",
      noLargeTunnel: true,
      smallPilots: [],
      retainedFixation: [],
      provenanceHash: `${instrumentChainSelectionHash(channel.instrumentChain)}:point-only:${channel.aperture.join(",")}`,
    });
  }
  const depthMm = measuredDepth(channel);
  if (depthMm === null || depthMm <= 0) return unavailable(channel, "depthMm");
  const start = tupleToVec3(channel.aperture);
  let axis;
  try {
    axis = segmentAlong(start, tupleToVec3(channel.vector), depthMm);
  } catch {
    return unavailable(channel, "valid aperture and vector");
  }
  const diameter = measuredDiameter(channel);
  const profile = crossSectionProfile(channel.crossSection);
  const variantDimensions = chainGeometry.selectedVariantDimensionsMm;
  const dimension = (...keys: string[]): number | null => {
    for (const key of keys) {
      const local = channel.dimensionsMm?.[key];
      if (local !== undefined && Number.isFinite(local) && local > 0) return local;
      const catalog = variantDimensions[key];
      if (catalog !== null && catalog !== undefined && Number.isFinite(catalog) && catalog > 0) return catalog;
    }
    return null;
  };
  const safetyMarginMm = dimension("safetyMarginMm") ?? undefined;
  const pinDiameter = resolvedChannelGuidePinDiameterMm(channel)
    ?? variantDimensions.guideWireDiameterMm
    ?? variantDimensions.kWireDiameterMm
    ?? variantDimensions.pinPathwayDiameterMm
    ?? null;
  const trajectoryControlMode = resolvedTrajectoryControlMode(channel);
  const persistedStart = trajectoryControlMode === "outer_cortex_surface"
    ? persistedOuterCortexStart(channel)
    : null;
  const guidePinTract = pinDiameter === null
    ? null
    : trajectoryControlMode === "blind_socket_tip"
      ? axis
      : persistedStart
        ? { start, end: tupleToVec3(persistedStart) }
        : axis;
  const corticalChannelDiameter = variantDimensions.antegradeChannelDiameterMm
    ?? variantDimensions.pinPathwayDiameterMm
    ?? pinDiameter;
  const fixationVariant = PRODUCT_VARIANTS.find((variant) => channel.instrumentChain.fixationImplantIds.includes(variant.id));
  const fixationDiameter = fixationVariant
    ? fixationVariant.dimensionsMm.anchorDiameterMm
      ?? fixationVariant.dimensionsMm.outerDiameterMm
      ?? fixationVariant.dimensionsMm.postDiameterMm
      ?? null
    : null;
  let recipe: GeometryRecipe;

  switch (channel.geometryType) {
    case "rigid_pin":
      recipe = { id: channel.id, type: "rigidPin", tract: axis, diameterMm: diameter, tipOvershootMm: 0 };
      break;
    case "flexible_pin":
      recipe = {
        id: channel.id,
        type: "flexiblePin",
        path: channel.centerline.kind === "flexible" && channel.centerline.accessControlPointsPatientRasMm.length > 1
          ? channel.centerline.accessControlPointsPatientRasMm.map(tupleToVec3)
          : [axis.start, axis.end],
        diameterMm: diameter,
        tipOvershootMm: 0,
        minimumBendRadiusMm: channel.centerline.kind === "flexible" ? channel.centerline.minimumBendRadiusMm : null,
      };
      break;
    case "round_full_tunnel":
      recipe = { id: channel.id, type: "fullTunnel", tunnel: axis, diameterMm: diameter, pinDiameterMm: pinDiameter, tipOvershootMm: 0, safetyMarginMm };
      break;
    case "antegrade_blind_socket":
      recipe = {
        id: channel.id,
        type: "blindSocket",
        socket: axis,
        socketDiameterMm: diameter,
        ...(guidePinTract ? { pilot: { tract: guidePinTract, diameterMm: pinDiameter } } : {}),
        safetyMarginMm,
      };
      break;
    case "retrograde_socket": {
      const pilotLengthMm = dimension("pilotLengthMm");
      const corticalChannelLengthMm = dimension("corticalChannelLengthMm");
      const deploymentLengthMm = dimension("deploymentLengthMm", "cutterDeploymentLengthMm");
      const pilot = pilotLengthMm === null
        ? null
        : segmentAlong(start, tupleToVec3(channel.vector), pilotLengthMm);
      const corticalChannel = corticalChannelLengthMm === null ? null : segmentAlong(start, tupleToVec3(channel.vector), corticalChannelLengthMm);
      const deployment = deploymentLengthMm === null ? null : segmentAlong(axis.end, tupleToVec3(channel.vector), deploymentLengthMm);
      recipe = {
        id: channel.id,
        type: "retroSocket",
        pilot,
        guidePin: guidePinTract,
        pilotDiameterMm: pinDiameter,
        socket: axis,
        socketDiameterMm: diameter,
        corticalChannel,
        corticalChannelDiameterMm: corticalChannelDiameter,
        deployment,
        deployedCutterDiameterMm: chainGeometry.exactSizeMm,
        safetyMarginMm,
      };
      break;
    }
    case "stepped_button_tunnel":
      recipe = {
        id: channel.id,
        type: "steppedButtonTunnel",
        graftSocket: axis,
        graftDiameterMm: diameter,
        corticalChannel: axis,
        corticalChannelDiameterMm: corticalChannelDiameter,
        flipEnvelope: { path: axis, diameterMm: dimension("flipEnvelopeDiameterMm") },
        safetyMarginMm,
      };
      break;
    case "flexible_reamed_socket": {
      const accessReachMm = dimension("accessReachMm");
      const accessLiftMm = dimension("accessLiftMm");
      const normal = deterministicPerpendicular(tupleToVec3(channel.vector));
      const accessPath = channel.centerline.kind === "flexible" && channel.centerline.accessControlPointsPatientRasMm.length > 1
        ? channel.centerline.accessControlPointsPatientRasMm.map(tupleToVec3)
        : accessReachMm !== null && accessLiftMm !== null
          ? [
            { x: start.x - normal.x * accessReachMm, y: start.y - normal.y * accessReachMm, z: start.z - normal.z * accessReachMm },
            { x: start.x - normal.x * accessReachMm / 2, y: start.y - normal.y * accessReachMm / 2, z: start.z - normal.z * accessReachMm / 2 + accessLiftMm },
            start,
          ]
          : [];
      recipe = {
        id: channel.id,
        type: "flexibleReamedSocket",
        socket: axis,
        socketDiameterMm: diameter,
        accessPath,
        accessDiameterMm: chainGeometry.cutterShaftDiameterMm,
        minimumBendRadiusMm: channel.centerline.kind === "flexible"
          ? channel.centerline.minimumBendRadiusMm
          : variantDimensions.minimumBendRadiusMm ?? null,
        safetyMarginMm,
      };
      break;
    }
    case "noncircular_tunnel":
      recipe = { id: channel.id, type: "profileTunnel", tunnel: axis, profile, orientationDeg: channel.orientationDeg, safetyMarginMm };
      break;
    case "overlapping_holes_dilator": {
      const perpendicular = deterministicPerpendicular(tupleToVec3(channel.vector));
      const pilotOffsetMm = dimension("pilotHoleOffsetMm");
      const offsetForDisplay = pilotOffsetMm ?? 0;
      const shiftedStart = { x: start.x + perpendicular.x * offsetForDisplay, y: start.y + perpendicular.y * offsetForDisplay, z: start.z + perpendicular.z * offsetForDisplay };
      recipe = {
        id: channel.id,
        type: "overlappingDilator",
        pilotHoles: [
          { tract: axis, diameterMm: pinDiameter },
          { tract: segmentAlong(shiftedStart, tupleToVec3(channel.vector), depthMm), diameterMm: pinDiameter },
        ],
        finalTunnel: axis,
        finalProfile: profile,
        orientationDeg: channel.orientationDeg,
        finalPreparation: "dilated",
        pilotOffsetMm,
        dilatorAccess: { segment: axis, profile },
        safetyMarginMm,
      };
      break;
    }
    case "sequential_dilated_tunnel": {
      const firstStageDiameterMm = dimension("firstStageDiameterMm");
      recipe = {
        id: channel.id,
        type: "sequentialDilated",
        tunnel: axis,
        stages: [
          { profile: firstStageDiameterMm === null ? null : { kind: "ellipse", widthMm: firstStageDiameterMm, heightMm: firstStageDiameterMm }, label: "Clinician-selected first dilation stage" },
          { profile, label: "Clinician-selected final profile" },
        ],
        orientationDeg: channel.orientationDeg,
        mode: "compacted",
        safetyMarginMm,
      };
      break;
    }
    case "coring_trephine":
      recipe = { id: channel.id, type: "coringTrephine", cut: axis, innerDiameterMm: dimension("innerDiameterMm"), outerDiameterMm: diameter, coreState: "separable", distalPredrill: { tract: axis, diameterMm: pinDiameter }, safetyMarginMm };
      break;
    case "anchor_pilot": {
      const preparation = INSTRUMENTS.filter((instrument) => channel.instrumentChain.fixationPreparationInstrumentIds.includes(instrument.id));
      const punchDiameterMm = preparation.find((instrument) => instrument.kind === "punch")?.dimensionsMm.diameterMm ?? dimension("punchDiameterMm");
      const tapMajorDiameterMm = preparation.find((instrument) => instrument.kind === "tap")?.dimensionsMm.majorDiameterMm ?? dimension("tapMajorDiameterMm");
      recipe = { id: channel.id, type: "anchor", pilot: axis, pilotDiameterMm: diameter, punchDiameterMm, tapMajorDiameterMm, anchor: { body: axis, diameterMm: fixationDiameter }, safetyMarginMm };
      break;
    }
    case "interference_fixation":
      recipe = { id: channel.id, type: "interferenceScrew", screw: axis, screwOuterDiameterMm: fixationDiameter, screwCoreDiameterMm: fixationVariant?.dimensionsMm.coreDiameterMm ?? null, graft: { body: axis, diameterMm: channel.graft?.diameterMm ?? null }, safetyMarginMm };
      break;
    case "cortical_button_plate": {
      const buttonLengthMm = dimension("plateLengthMm", "buttonLengthMm");
      const buttonWidthMm = dimension("plateWidthMm", "buttonWidthMm");
      const buttonThicknessMm = dimension("plateThicknessMm", "buttonThicknessMm");
      if (buttonLengthMm === null || buttonWidthMm === null || buttonThicknessMm === null) return unavailable(channel, "button plate length, width, and thickness");
      recipe = {
        id: channel.id,
        type: "corticalButton",
        channel: axis,
        channelDiameterMm: diameter,
        button: {
          body: segmentAlong(axis.end, deterministicPerpendicular(tupleToVec3(channel.vector)), buttonThicknessMm),
          profile: { kind: "roundedRectangle", widthMm: buttonLengthMm, heightMm: buttonWidthMm, cornerRadiusMm: Math.min(buttonWidthMm / 2, dimension("plateCornerRadiusMm") ?? 0) },
        },
        flipEnvelope: { path: axis, diameterMm: dimension("flipEnvelopeDiameterMm") },
        safetyMarginMm,
      };
      break;
    }
    case "post_washer_staple": {
      if (channel.hardwareSubtype === "staple") {
        const legSpacingMm = dimension("stapleLegSpacingMm");
        const legDiameterMm = dimension("stapleLegDiameterMm");
        const bridgeWidthMm = dimension("stapleBridgeWidthMm");
        const bridgeThicknessMm = dimension("stapleBridgeThicknessMm");
        if (legSpacingMm === null || legDiameterMm === null || bridgeWidthMm === null || bridgeThicknessMm === null) return unavailable(channel, "staple leg spacing/diameter and bridge width/thickness");
        const perpendicular = deterministicPerpendicular(tupleToVec3(channel.vector));
        const firstStart = { x: start.x + perpendicular.x * legSpacingMm / 2, y: start.y + perpendicular.y * legSpacingMm / 2, z: start.z + perpendicular.z * legSpacingMm / 2 };
        const secondStart = { x: start.x - perpendicular.x * legSpacingMm / 2, y: start.y - perpendicular.y * legSpacingMm / 2, z: start.z - perpendicular.z * legSpacingMm / 2 };
        const firstLeg = segmentAlong(firstStart, tupleToVec3(channel.vector), depthMm);
        const secondLeg = segmentAlong(secondStart, tupleToVec3(channel.vector), depthMm);
        recipe = {
          id: channel.id,
          type: "staple",
          legPilots: [{ tract: firstLeg, diameterMm: diameter }, { tract: secondLeg, diameterMm: diameter }],
          retainedLegs: [{ body: firstLeg, diameterMm: legDiameterMm }, { body: secondLeg, diameterMm: legDiameterMm }],
          bridge: { body: { start: firstStart, end: secondStart }, profile: { kind: "rectangle", widthMm: bridgeWidthMm, heightMm: bridgeThicknessMm } },
          safetyMarginMm,
        };
        break;
      }
      const washerDiameterMm = dimension("washerDiameterMm");
      const washerThicknessMm = dimension("washerThicknessMm");
      if (washerDiameterMm === null || washerThicknessMm === null) return unavailable(channel, "washer diameter and thickness");
      recipe = {
        id: channel.id,
        type: "postWasher",
        pilot: axis,
        pilotDiameterMm: diameter,
        post: axis,
        postDiameterMm: fixationDiameter,
        washer: {
          body: segmentAlong(axis.start, deterministicPerpendicular(tupleToVec3(channel.vector)), washerThicknessMm),
          profile: { kind: "ellipse", widthMm: washerDiameterMm, heightMm: washerDiameterMm },
        },
        safetyMarginMm,
      };
      break;
    }
    case "pcl_inlay_trough":
      recipe = { id: channel.id, type: "trough", recess: axis, profile, orientationDeg: channel.orientationDeg, wallSlopeDeg: dimension("wallSlopeDeg"), accessEnvelope: { path: [axis.start, axis.end], diameterMm: dimension("accessEnvelopeDiameterMm") }, safetyMarginMm };
      break;
    case "chamfer_notch_keyhole":
      recipe = { id: channel.id, type: "chamfer", cut: axis, apertureDiameterMm: diameter, innerDiameterMm: dimension("innerDiameterMm"), accessEnvelope: { path: axis, diameterMm: dimension("accessEnvelopeDiameterMm") }, safetyMarginMm };
      break;
    case "onlay_no_large_tunnel":
      recipe = {
        id: channel.id,
        type: "noLargeTunnel",
        noLargeTunnel: true,
        smallPilots: [{ tract: axis, diameterMm: diameter }],
        retainedFixation: fixationVariant
          ? [{ body: axis, diameterMm: fixationDiameter, label: fixationVariant.name }]
          : [],
        safetyMarginMm,
      };
      break;
    case "custom":
      recipe = profile
        ? { id: channel.id, type: "profileTunnel", tunnel: axis, profile, orientationDeg: channel.orientationDeg, safetyMarginMm }
        : { id: channel.id, type: "fullTunnel", tunnel: axis, diameterMm: diameter, safetyMarginMm };
      break;
  }
  return generateGeometry({ ...recipe, provenanceHash: instrumentChainSelectionHash(channel.instrumentChain) });
}

function meshToPayload(
  mesh: TriangleMesh,
  id: string,
  name: string,
  layer: ViewerLayer,
  color: string,
  opacity: number,
  channelId?: string,
): ViewerMeshPayload {
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    vertices.push([mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2]]);
  }
  for (let index = 0; index < mesh.indices.length; index += 3) {
    faces.push([mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]]);
  }
  return { id, name, vertices, faces, color, opacity, layer, channelId };
}

function ellipsoid(
  id: string,
  center: [number, number, number],
  radii: [number, number, number],
  color: string,
  opacity: number,
  anatomyBone: NonNullable<ViewerMeshPayload["anatomyBone"]>,
  layer: ViewerLayer = "bones",
): ViewerMeshPayload {
  const lat = 18;
  const lon = 28;
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (let row = 0; row <= lat; row += 1) {
    const phi = (row / lat) * Math.PI;
    for (let column = 0; column <= lon; column += 1) {
      const theta = (column / lon) * Math.PI * 2;
      vertices.push([
        center[0] + radii[0] * Math.sin(phi) * Math.cos(theta),
        center[1] + radii[1] * Math.sin(phi) * Math.sin(theta),
        center[2] + radii[2] * Math.cos(phi),
      ]);
    }
  }
  for (let row = 0; row < lat; row += 1) {
    for (let column = 0; column < lon; column += 1) {
      const a = row * (lon + 1) + column;
      const b = a + lon + 1;
      faces.push([a, b, a + 1], [b, b + 1, a + 1]);
    }
  }
  return { id, name: id, vertices, faces, color, opacity, layer, anatomyBone };
}

function pointOnlyLocationMarker(
  channel: ChannelPlan,
  color: string,
  selected: boolean,
): ViewerMeshPayload {
  const lat = 14;
  const lon = 20;
  const vertices: number[][] = [];
  const faces: number[][] = [];
  const radius = POINT_ONLY_LOCATION_MARKER_RADIUS_MM;
  for (let row = 0; row <= lat; row += 1) {
    const phi = (row / lat) * Math.PI;
    for (let column = 0; column <= lon; column += 1) {
      const theta = (column / lon) * Math.PI * 2;
      vertices.push([
        channel.aperture[0] + radius * Math.sin(phi) * Math.cos(theta),
        channel.aperture[1] + radius * Math.sin(phi) * Math.sin(theta),
        channel.aperture[2] + radius * Math.cos(phi),
      ]);
    }
  }
  for (let row = 0; row < lat; row += 1) {
    for (let column = 0; column < lon; column += 1) {
      const a = row * (lon + 1) + column;
      const b = a + lon + 1;
      faces.push([a, b, a + 1], [b, b + 1, a + 1]);
    }
  }
  return {
    id: `${channel.id}-point-only-location`,
    name: `${channel.label} · point-only fixation location`,
    vertices,
    faces,
    color,
    opacity: selected ? 0.96 : 0.78,
    layer: "hardware",
    channelId: channel.id,
  };
}

export function buildSyntheticAnatomyMeshes(): ViewerMeshPayload[] {
  return [
    ellipsoid("femur-shaft", [0, 0, 64], [13, 12, 34], "#c8d2d4", 0.33, "femur"),
    ellipsoid("femur-medial-condyle", [-9, -1, 38], [12, 17, 13], "#d4dddf", 0.42, "femur"),
    ellipsoid("femur-lateral-condyle", [9, 1, 38], [12, 17, 13], "#cbd6d8", 0.42, "femur"),
    ellipsoid("tibia-plateau", [0, 0, 15], [19, 15, 10], "#bbc9cc", 0.38, "tibia"),
    ellipsoid("tibia-shaft", [0, 1, -12], [11, 9, 30], "#aebfc3", 0.31, "tibia"),
    ellipsoid("fibula-head", [25, 1, 13], [7, 6, 8], "#c6d2d4", 0.42, "fibula"),
    ellipsoid("fibula-shaft", [26, 2, -13], [4.2, 4.2, 29], "#aabcc0", 0.3, "fibula"),
  ];
}

export interface BuildViewerSceneOptions {
  revision: number;
  channels: ChannelPlan[];
  procedureById: Record<string, ProcedureIdentity>;
  selectedChannelId: string | null;
  /**
   * Ephemeral procedure visibility selected in the planning workspace.
   * Omitting this property preserves the legacy behavior of rendering every
   * channel; an empty set renders anatomy/ghost layers only. Visibility never
   * removes a channel from deterministic geometry generation or analysis.
   */
  visibleProcedureIdentities?: ReadonlySet<ProcedureIdentity>;
  /** Ephemeral per-graft visibility; keys come from graft descriptors. */
  hiddenGraftVisibilityKeys?: ReadonlySet<string>;
  /**
   * Ephemeral, decimated anatomy meshes resolved from the local imaging asset
   * service. Full-resolution clinical assets are deliberately not persisted in
   * the plan or sent through browser storage.
   */
  anatomyMeshes?: ViewerMeshPayload[];
  layerVisibility?: Partial<ViewerPlanningScene["layerVisibility"]>;
  globalOpacity?: number;
  clipping?: ViewerPlanningScene["clipping"];
  crossSection?: ViewerPlanningScene["crossSection"];
  ghostMeshes?: ViewerMeshPayload[];
  laterality?: "left" | "right" | "unverified";
  lateralityVerified?: boolean;
}

export function buildViewerScene(options: BuildViewerSceneOptions): {
  scene: ViewerPlanningScene;
  geometry: Map<string, GeneratedGeometry>;
  grafts: ReconstructedLigamentDescriptor[];
} {
  const geometry = new Map<string, GeneratedGeometry>();
  const meshes = options.anatomyMeshes === undefined
    ? buildSyntheticAnatomyMeshes()
    : options.anatomyMeshes.map((mesh) => ({ ...mesh, layer: "bones" as const }));
  const lines: ViewerLinePayload[] = [];
  const labels: ViewerLabelPayload[] = [];
  const isChannelVisible = (channel: ChannelPlan): boolean => {
    if (options.visibleProcedureIdentities === undefined) return true;
    const procedureIdentity = options.procedureById[channel.procedureId];
    return procedureIdentity !== undefined && options.visibleProcedureIdentities.has(procedureIdentity);
  };
  for (const channel of options.channels) {
    let generated: GeneratedGeometry;
    try {
      generated = channelToGeometry(channel);
    } catch (error) {
      generated = unavailable(channel, `valid geometry parameters (${error instanceof Error ? error.message : "unknown error"})`);
    }
    geometry.set(channel.id, generated);
    if (!isChannelVisible(channel)) continue;
    const procedure = options.procedureById[channel.procedureId] ?? "CUSTOM";
    const procedureColor = PROCEDURE_COLORS[procedure] ?? PROCEDURE_COLORS.CUSTOM;
    const pointOnly = isPointOnlyNoLargeTunnel(channel);
    for (const layer of generated.layers) {
      if (!layer.renderable || layer.mesh.indices.length === 0) continue;
      const viewerLayer = LAYER_MAP[layer.type] ?? "boneRemoval";
      const isSelected = options.selectedChannelId === channel.id;
      const usesProcedureIdentityColor = viewerLayer === "boneRemoval" ||
        viewerLayer === "pins" || viewerLayer === "hardware";
      meshes.push(
        meshToPayload(
          layer.mesh,
          layer.id,
          `${channel.label} · ${layer.label}`,
          viewerLayer,
          usesProcedureIdentityColor ? procedureColor : LAYER_COLOR[viewerLayer],
          viewerLayer === "safety" ? 0.12 : isSelected ? 0.82 : 0.58,
          channel.id,
        ),
      );
    }
    if (pointOnly && channel.aperture.every(Number.isFinite)) {
      meshes.push(pointOnlyLocationMarker(
        channel,
        procedureColor,
        options.selectedChannelId === channel.id,
      ));
      labels.push({
        id: `${channel.id}-point-only-location-label`,
        text: channel.label,
        position: [
          channel.aperture[0],
          channel.aperture[1],
          channel.aperture[2] + POINT_ONLY_LOCATION_MARKER_RADIUS_MM + 1.5,
        ],
        color: procedureColor,
        opacity: options.selectedChannelId === channel.id ? 0.88 : 0.66,
        sizeMm: options.selectedChannelId === channel.id ? 4.8 : 4.1,
        layer: "hardware",
        channelId: channel.id,
      });
    }
    const start = tupleToVec3(channel.aperture);
    const eligibleStartSurfaceMeshIds = new Set(meshes
      .filter((mesh) => mesh.layer === "bones" && mesh.anatomyBone === channel.bone)
      .map((mesh) => mesh.id));
    const resolvedStart = resolveChannelStartPointPatientRas(channel, {
      eligibleSurfaceMeshIds: eligibleStartSurfaceMeshIds,
    });
    const guidePinEnd = resolvedStart?.source === "outer_cortex_surface_attachment" ||
      resolvedStart?.source === "blind_socket_tip"
      ? resolvedStart.pointPatientRasMm
      : null;
    if (guidePinEnd && !pointOnly) {
      lines.push({
        id: `${channel.id}-pin-trajectory`,
        points: [vec3ToTuple(start), [guidePinEnd[0], guidePinEnd[1], guidePinEnd[2]]],
        color: procedureColor,
        opacity: 0.92,
        layer: "pins",
        channelId: channel.id,
      });
    }
    const channelDepthMm = measuredDepth(channel);
    if (!pointOnly && channelDepthMm !== null && channelDepthMm > 0) {
      try {
        const axis = segmentAlong(start, tupleToVec3(channel.vector), channelDepthMm);
        lines.push({ id: `${channel.id}-axis`, points: [vec3ToTuple(axis.start), vec3ToTuple(axis.end)], color: procedureColor, opacity: 0.8, layer: "measurements", channelId: channel.id });
        if (generated.layers.some((layer) => layer.renderable && layer.type === "boneRemovalOrCompaction")) {
          labels.push({
            id: `${channel.id}-tunnel-label`,
            text: channel.label,
            position: [
              (axis.start.x + axis.end.x) / 2,
              (axis.start.y + axis.end.y) / 2,
              (axis.start.z + axis.end.z) / 2 + 3,
            ],
            color: procedureColor,
            opacity: options.selectedChannelId === channel.id ? 0.88 : 0.62,
            sizeMm: options.selectedChannelId === channel.id ? 4.8 : 4.1,
            layer: "boneRemoval",
            channelId: channel.id,
          });
        }
      } catch { /* invalid vectors are disclosed as incomplete geometry */ }
    }
  }
  const reconstructedLigaments = buildReconstructedLigamentPayloads({
    channels: options.channels.filter(isChannelVisible),
    procedureById: options.procedureById,
    anatomyMeshes: meshes.filter((mesh) => mesh.layer === "bones"),
    selectedChannelId: options.selectedChannelId,
  });
  const visibleGraftIds = new Set(reconstructedLigaments.grafts
    .filter((graft) => !options.hiddenGraftVisibilityKeys?.has(graft.visibilityKey))
    .map((graft) => graft.id));
  meshes.push(...reconstructedLigaments.meshes.filter((mesh) => visibleGraftIds.has(mesh.id)));
  labels.push(...reconstructedLigaments.labels.filter((label) =>
    visibleGraftIds.has(label.id.endsWith(":label") ? label.id.slice(0, -6) : label.id)));
  if (options.ghostMeshes) meshes.push(...options.ghostMeshes);

  const selected = options.channels.find((channel) =>
    channel.id === options.selectedChannelId && isChannelVisible(channel),
  );
  const handles: ViewerHandlePayload[] = [];
  if (selected && selected.aperture.every(Number.isFinite)) {
    const start = tupleToVec3(selected.aperture);
    const selectedProcedure = options.procedureById[selected.procedureId];
    const selectedProcedureColor = PROCEDURE_COLORS[selectedProcedure ?? "CUSTOM"] ?? PROCEDURE_COLORS.CUSTOM;
    const tether = classifyChannelEntryTether(selected, selectedProcedure);
    const eligibleBoneMeshIds = meshes
      .filter((mesh) => mesh.layer === "bones" && mesh.anatomyBone === tether.bone)
      .map((mesh) => mesh.id);
    const apertureSurfaceConstraint = eligibleBoneMeshIds.length
      ? {
          meshIds: eligibleBoneMeshIds,
          mode: tether.kind === "intra_articular_tibial_plateau"
            ? "tibial_superior_envelope" as const
            : "nearest_surface" as const,
        }
      : undefined;
    const apertureSurfaceAttachment = selected.apertureSurfaceAttachment;
    const apertureSurfaceNormal = apertureSurfaceAttachment?.surfaceNormalPatientRas;
    const validApertureSurfaceNormal = apertureSurfaceAttachment &&
      apertureSurfaceAttachment.coordinateSpace === "patient_ras" &&
      apertureSurfaceAttachment.units === "mm" &&
      apertureSurfaceAttachment.bone === tether.bone &&
      eligibleBoneMeshIds.includes(apertureSurfaceAttachment.meshId) &&
      apertureSurfaceNormal?.every(Number.isFinite) &&
      Math.hypot(...apertureSurfaceNormal) > 1e-9
      ? [...apertureSurfaceNormal] as [number, number, number]
      : undefined;
    const trajectoryControlMode = resolvedTrajectoryControlMode(selected);
    const anchorTrajectoryControl = trajectoryControlMode === "exterior_rod";
    const resolvedStart = isPointOnlyNoLargeTunnel(selected)
      ? null
      : resolveChannelStartPointPatientRas(selected, {
          eligibleSurfaceMeshIds: new Set(eligibleBoneMeshIds),
        });
    const anchorSurfaceStart = anchorTrajectoryControl &&
      resolvedStart?.source === "anchor_aperture_surface_attachment"
      ? [...resolvedStart.pointPatientRasMm] as [number, number, number]
      : vec3ToTuple(start);
    handles.push({
      id: `${selected.id}-aperture`,
      channelId: selected.id,
      kind: "aperture",
      semanticRole: anchorTrajectoryControl ? "start" : "entry",
      position: anchorTrajectoryControl ? anchorSurfaceStart : vec3ToTuple(start),
      color: selectedProcedureColor,
      label: `${anchorTrajectoryControl ? "Start" : "Entry"} point - ${selected.label}`,
      ...(validApertureSurfaceNormal
        ? { surfaceNormalPatientRas: validApertureSurfaceNormal }
        : {}),
      ...(apertureSurfaceConstraint ? { surfaceConstraint: apertureSurfaceConstraint } : {}),
    });

    const anchorTrajectoryEnd = anchorTrajectoryControl
      ? anchorTrajectoryRodEnd(selected)
      : null;
    if (anchorTrajectoryEnd) {
      handles.push({
        id: `${selected.id}-endpoint`,
        channelId: selected.id,
        kind: "endpoint",
        semanticRole: "trajectory",
        position: [...anchorTrajectoryEnd],
        color: selectedProcedureColor,
        label: `Trajectory - ${selected.label}`,
        trajectoryPivotPatientRas: anchorSurfaceStart,
        trajectoryRadiusMm: 1,
      });
    } else if (resolvedStart?.source === "blind_socket_tip") {
      handles.push({
        id: `${selected.id}-endpoint`,
        channelId: selected.id,
        kind: "endpoint",
        semanticRole: "start",
        position: [...resolvedStart.pointPatientRasMm],
        color: selectedProcedureColor,
        label: `Start point - ${selected.label}`,
      });
    } else if (resolvedStart?.source === "outer_cortex_surface_attachment") {
      const endpointSurfaceConstraint = eligibleBoneMeshIds.length
        ? { meshIds: eligibleBoneMeshIds, mode: "nearest_surface" as const }
        : undefined;
      handles.push({
        id: `${selected.id}-endpoint`,
        channelId: selected.id,
        kind: "endpoint",
        semanticRole: "start",
        position: [...resolvedStart.pointPatientRasMm],
        color: selectedProcedureColor,
        label: `Start point - ${selected.label}`,
        ...(endpointSurfaceConstraint ? { surfaceConstraint: endpointSurfaceConstraint } : {}),
      });
    }
  }

  return {
    geometry,
    grafts: reconstructedLigaments.grafts,
    scene: {
      type: "multilig_planning_scene",
      revision: options.revision,
      meshes,
      lines,
      handles,
      labels,
      layerVisibility: { ...DEFAULT_LAYER_VISIBILITY, ...options.layerVisibility },
      globalOpacity: options.globalOpacity ?? 1,
      clipping: options.clipping ?? { enabled: false, axis: "z", offsetMm: 0, invert: false },
      crossSection: options.crossSection ?? { enabled: false, axis: "z", offsetMm: 0 },
      orientationMarkers: options.laterality
        ? { laterality: options.laterality, verified: options.lateralityVerified ?? false }
        : undefined,
      selectedChannelId: options.selectedChannelId,
    },
  };
}

export { DEFAULT_LAYER_VISIBILITY, LAYER_COLOR, PROCEDURE_COLORS };
