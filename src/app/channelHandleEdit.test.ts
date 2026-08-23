import { describe, expect, it } from "vitest";
import type {
  ChannelPlan,
  ChannelSurfaceAttachment,
  PlanCase,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import type { ViewerHandleChange, ViewerMeshPayload } from "../viewer/types";
import { deserializePlan, serializePlan } from "../store/planHistory";
import { createSyntheticDemoCase } from "./caseFactory";
import { channelToGeometry } from "./channelGeometry";
import {
  applyChannelDepthGeometryEdit,
  applyNumericVectorComponentEdit,
  applySurfaceConstrainedHandleCommit,
  TIBIAL_SUPERIOR_ENVELOPE_WARNING,
} from "./channelHandleEdit";

function demoChannel(id: string): ChannelPlan {
  const channel = createSyntheticDemoCase().variants[0].channels.find((item) => item.id === id);
  if (!channel) throw new Error(`Missing test channel ${id}`);
  return structuredClone(channel);
}

function planeMesh(
  id: string,
  anatomyBone: NonNullable<ViewerMeshPayload["anatomyBone"]>,
  z: number,
): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices: [
      [-20, -20, z],
      [20, -20, z],
      [20, 20, z],
      [-20, 20, z],
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    color: "#ffffff",
    opacity: 0.22,
    layer: "bones",
    anatomyBone,
  };
}

function commit(
  channel: ChannelPlan,
  kind: "aperture" | "endpoint",
  position: Vector3,
): ViewerHandleChange {
  return { channelId: channel.id, kind, position: [...position], phase: "commit" };
}

function surfaceAttachment(
  bone: ChannelPlan["bone"],
  meshId: string,
  point: Vector3,
): ChannelSurfaceAttachment {
  return {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone,
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId,
    requestedPointPatientRasMm: point,
    attachedPointPatientRasMm: point,
    distanceFromRequestedPointMm: 0,
    triangleStableId: `${meshId}:face:0`,
    faceStableId: `${meshId}:face:0`,
    faceIndex: 0,
    vertexIndices: [0, 1, 2],
    vertexStableIds: [`${meshId}:vertex:0`, `${meshId}:vertex:1`, `${meshId}:vertex:2`],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [0, 0, 1],
    reviewState: "surface_review_not_evaluated",
  };
}

function expectEndpoint(channel: ChannelPlan, endpoint: Vector3): void {
  expect(channel.aperture[0] + channel.vector[0] * channel.depthMm!).toBeCloseTo(endpoint[0], 8);
  expect(channel.aperture[1] + channel.vector[1] * channel.depthMm!).toBeCloseTo(endpoint[1], 8);
  expect(channel.aperture[2] + channel.vector[2] * channel.depthMm!).toBeCloseTo(endpoint[2], 8);
}

describe("surface-constrained channel handle commits", () => {
  it("projects an intra-articular aperture to the highest tibia Z at X/Y and records the derived-rule provenance", () => {
    const channel = demoChannel("acl-tibial");
    const original = structuredClone(channel);
    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "aperture", [3, 1, 3]),
      [planeMesh("tibia-far", "tibia", 14), planeMesh("tibia-near", "tibia", 2)],
    );

    expect(channel).toEqual(original);
    expect(result.aperture[0]).toBeCloseTo(3, 10);
    expect(result.aperture[1]).toBeCloseTo(1, 10);
    expect(result.aperture[2]).toBeCloseTo(14, 10);
    expect(result.apertureSurfaceAttachment).toMatchObject({
      coordinateSpace: "patient_ras",
      units: "mm",
      bone: "tibia",
      targetKind: "tibial_superior_envelope",
      targetRegionId: null,
      meshId: "tibia-far",
      requestedPointPatientRasMm: [3, 1, 3],
      triangleStableId: "tibia-far:face:0",
      faceStableId: "tibia-far:face:0",
      faceIndex: 0,
      vertexIndices: [0, 1, 2],
      vertexStableIds: [
        "tibia-far:vertex:0",
        "tibia-far:vertex:1",
        "tibia-far:vertex:2",
      ],
      reviewState: "user_defined_not_clinician_approved",
      constraintProvenance: {
        rule: "maximum_patient_ras_z_at_requested_xy",
        ruleVersion: "1",
        sourceGeometryRole: "viewer_display_surface",
        resolution: "vertical_intersection",
        xyFallbackDistanceMm: 0,
      },
    });
    expect(result.apertureSurfaceAttachment?.attachedPointPatientRasMm[2]).toBeCloseTo(14, 10);
    expect(result.apertureSurfaceAttachment?.distanceFromRequestedPointMm).toBeCloseTo(11, 10);
    expect(result.apertureSurfaceAttachment?.barycentric).toHaveLength(3);
    expect(result.apertureSurfaceAttachment?.surfaceNormalPatientRas).toEqual([0, 0, 1]);
    expect(result.warnings).toContain(TIBIAL_SUPERIOR_ENVELOPE_WARNING);

    const repeated = applySurfaceConstrainedHandleCommit(
      result,
      "ACL",
      commit(result, "aperture", [4, 1, 3]),
      [planeMesh("tibia-near", "tibia", 2)],
    );
    expect(repeated.warnings.filter((warning) => warning === TIBIAL_SUPERIOR_ENVELOPE_WARNING)).toHaveLength(1);
  });

  it("preserves a full tunnel's prior cortical endpoint when its rigid aperture moves and synchronizes an explicit depth setting", () => {
    const channel = demoChannel("pcl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [0, 0, -1],
    };
    channel.endpointSurfaceAttachment = surfaceAttachment("tibia", "tibia-exit", [0, 0, -12]);
    channel.instrumentChain = {
      ...channel.instrumentChain,
      productVariantId: "explicit-product-must-remain",
      depthOrFullTunnelSetting: { mode: "depth", depthMm: 12 },
      userVerified: true,
      verification: {
        verifiedAt: "2026-08-02T12:00:00Z",
        verifiedBy: "clinician",
        selectionHash: "prior-selection-hash",
        catalogVersion: channel.instrumentChain.catalogVersion,
        marketOrRegion: "US",
        sourceIds: [],
      },
      completionState: "complete",
    };

    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "aperture", [2, 3, 4]),
      [planeMesh("tibia-surface", "tibia", 2), planeMesh("tibia-exit", "tibia", -12)],
    );

    expect(result.aperture[0]).toBeCloseTo(2, 10);
    expect(result.aperture[1]).toBeCloseTo(3, 10);
    expect(result.aperture[2]).toBeCloseTo(2, 10);
    expectEndpoint(result, [0, 0, -12]);
    expect(result.centerline).toMatchObject({
      kind: "rigid",
      directionPatientRas: result.vector,
    });
    if (result.centerline.kind !== "rigid") throw new Error("Expected rigid centerline");
    expect(result.centerline.aperturePatientRasMm[0]).toBeCloseTo(2, 10);
    expect(result.centerline.aperturePatientRasMm[1]).toBeCloseTo(3, 10);
    expect(result.centerline.aperturePatientRasMm[2]).toBeCloseTo(2, 10);
    expect(result.instrumentChain.depthOrFullTunnelSetting).toEqual({
      mode: "depth",
      depthMm: result.depthMm,
    });
    expect(result.instrumentChain.productVariantId).toBe("explicit-product-must-remain");
    expect(result.instrumentChain.userVerified).toBe(false);
    expect(result.instrumentChain.verification).toBeNull();
    expect(result.instrumentChain.completionState).toBe("warning");
  });

  it("projects a full-thickness endpoint to its bone and recomputes the rigid axis without changing a full-tunnel instrument mode", () => {
    const channel = demoChannel("pcl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [0, 0, -1],
    };
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "full_tunnel", depthMm: null };
    const settingBefore = structuredClone(channel.instrumentChain.depthOrFullTunnelSetting);

    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "endpoint", [4, 0, -9]),
      [planeMesh("tibia-cortex", "tibia", -10)],
    );

    expectEndpoint(result, [4, 0, -10]);
    expect(result.centerline).toMatchObject({
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: result.vector,
    });
    expect(result.endpointSurfaceAttachment).toMatchObject({
      targetKind: "whole_bone_surface",
      meshId: "tibia-cortex",
      attachedPointPatientRasMm: [4, 0, -10],
      reviewState: "surface_review_not_evaluated",
    });
    expect(result.instrumentChain.depthOrFullTunnelSetting).toEqual(settingBefore);
  });

  it("projects a blind-socket Start to cortex while preserving its clinician-selected socket depth", () => {
    const channel = demoChannel("acl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [0, 0, -1],
    };
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "depth", depthMm: 10 };
    channel.endpointSurfaceAttachment = {
      coordinateSpace: "patient_ras",
      units: "mm",
      bone: "tibia",
      targetKind: "whole_bone_surface",
      targetRegionId: null,
      meshId: "stale",
      requestedPointPatientRasMm: [0, 0, -10],
      attachedPointPatientRasMm: [0, 0, -10],
      distanceFromRequestedPointMm: 0,
      triangleStableId: "stale:face:0",
      faceStableId: "stale:face:0",
      faceIndex: 0,
      vertexIndices: [0, 1, 2],
      vertexStableIds: ["stale:vertex:0", "stale:vertex:1", "stale:vertex:2"],
      barycentric: [1, 0, 0],
      surfaceNormalPatientRas: [0, 0, 1],
      reviewState: "surface_review_not_evaluated",
    };

    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "endpoint", [3, 4, -7]),
      [planeMesh("tibia-cortex", "tibia", -10)],
    );

    expect(result.depthMm).toBe(10);
    expect(result.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-cortex",
    });
    expect(result.endpointSurfaceAttachment?.attachedPointPatientRasMm[0]).toBeCloseTo(3, 10);
    expect(result.endpointSurfaceAttachment?.attachedPointPatientRasMm[1]).toBeCloseTo(4, 10);
    expect(result.endpointSurfaceAttachment?.attachedPointPatientRasMm[2]).toBeCloseTo(-10, 10);
    expect(result.vector[0]).toBeCloseTo(3 / Math.sqrt(125), 10);
    expect(result.vector[1]).toBeCloseTo(4 / Math.sqrt(125), 10);
    expect(result.vector[2]).toBeCloseTo(-10 / Math.sqrt(125), 10);
    expect(Math.hypot(...result.vector)).toBeCloseTo(1, 10);
    expect(result.instrumentChain.depthOrFullTunnelSetting).toEqual({
      mode: "depth",
      depthMm: 10,
    });
  });

  it("moves a socket trajectory Start without inventing a depth when depth is unresolved", () => {
    const channel = demoChannel("acl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = null;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [0, 0, -1],
    };
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "depth", depthMm: null };

    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "endpoint", [2, 0, -8]),
      [planeMesh("tibia-cortex", "tibia", -10)],
    );

    expect(result.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-cortex",
      attachedPointPatientRasMm: [2, 0, -10],
    });
    expect(result.vector[0]).toBeCloseTo(2 / Math.sqrt(104), 10);
    expect(result.vector[2]).toBeCloseTo(-10 / Math.sqrt(104), 10);
    expect(result.depthMm).toBeNull();
    expect(result.instrumentChain.depthOrFullTunnelSetting).toEqual({ mode: "depth", depthMm: null });
  });

  it("does not move a Start into air when its declared bone cannot be evaluated", () => {
    const channel = demoChannel("acl-tibial");
    const snapshot = structuredClone(channel);
    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "endpoint", [100, 100, 100]),
      [planeMesh("wrong-femur", "femur", 2)],
    );

    expect(result).toBe(channel);
    expect(result).toEqual(snapshot);
  });

  it("preserves flexible access control points while updating aperture and intraosseous direction semantics", () => {
    const channel = demoChannel("pcl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "full_tunnel", depthMm: null };
    channel.centerline = {
      kind: "flexible",
      aperturePatientRasMm: [0, 0, 0],
      intraosseousDirectionPatientRas: [0, 0, -1],
      accessControlPointsPatientRasMm: [[0, 0, 0], [5, 6, 7]],
      minimumBendRadiusMm: 30,
    };
    channel.endpointSurfaceAttachment = surfaceAttachment("tibia", "tibia-exit", [0, 0, -10]);

    const movedAperture = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "aperture", [1, 1, 3]),
      [planeMesh("tibia-entry", "tibia", 2)],
    );
    expect(movedAperture.centerline).toMatchObject({
      kind: "flexible",
      aperturePatientRasMm: [1, 1, 2],
      intraosseousDirectionPatientRas: movedAperture.vector,
      accessControlPointsPatientRasMm: [[1, 1, 2], [5, 6, 7]],
      minimumBendRadiusMm: 30,
    });
    expectEndpoint(movedAperture, [0, 0, -10]);

    const movedEndpoint = applySurfaceConstrainedHandleCommit(
      movedAperture,
      "PCL",
      commit(movedAperture, "endpoint", [2, 2, -9]),
      [planeMesh("tibia-exit", "tibia", -10)],
    );
    expect(movedEndpoint.centerline).toMatchObject({
      kind: "flexible",
      aperturePatientRasMm: [1, 1, 2],
      intraosseousDirectionPatientRas: movedEndpoint.vector,
      accessControlPointsPatientRasMm: [[1, 1, 2], [5, 6, 7]],
      minimumBendRadiusMm: 30,
    });
    expectEndpoint(movedEndpoint, [2, 2, -10]);
  });

  it("keeps a polyline's intermediate points and prior cortical endpoint when the aperture moves", () => {
    const channel = demoChannel("pcl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "full_tunnel", depthMm: null };
    channel.centerline = {
      kind: "polyline",
      pointsPatientRasMm: [[0, 0, 0], [2, 0, -5], [0, 0, -10]],
    };
    channel.endpointSurfaceAttachment = surfaceAttachment("tibia", "tibia-exit", [0, 0, -10]);

    const movedAperture = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "aperture", [1, 0, 4]),
      [planeMesh("tibia-entry", "tibia", 2)],
    );
    expect(movedAperture.centerline).toEqual({
      kind: "polyline",
      pointsPatientRasMm: [[1, 0, 2], [2, 0, -5], [0, 0, -10]],
    });
    expectEndpoint(movedAperture, [0, 0, -10]);

    const movedEndpoint = applySurfaceConstrainedHandleCommit(
      movedAperture,
      "PCL",
      commit(movedAperture, "endpoint", [3, 0, -9]),
      [planeMesh("tibia-exit", "tibia", -10)],
    );
    expect(movedEndpoint.centerline).toEqual({
      kind: "polyline",
      pointsPatientRasMm: [[1, 0, 2], [2, 0, -5], [3, 0, -10]],
    });
    expectEndpoint(movedEndpoint, [3, 0, -10]);
  });

  it("fails closed without moving a surface handle when the declared bone mesh is unavailable", () => {
    const channel = demoChannel("plc-fibular");
    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "PLC_FCL",
      commit(channel, "aperture", [30, 4, 12]),
      [planeMesh("patient-tibia", "tibia", 2)],
    );

    expect(result).toBe(channel);
    expect(result.aperture).toEqual([23, 2, 18]);
    expect(result.apertureSurfaceAttachment ?? null).toBeNull();
  });

  it.each([
    ["preview", "aperture"],
    ["commit", "diameter"],
  ] satisfies Array<[ViewerHandleChange["phase"], ViewerHandleChange["kind"]]>) (
    "ignores %s %s events outside committed aperture/endpoint scope",
    (phase, kind) => {
      const channel = demoChannel("pcl-tibial");
      const change: ViewerHandleChange = {
        channelId: channel.id,
        kind,
        position: [1, 2, 3],
        phase,
      };
      expect(applySurfaceConstrainedHandleCommit(channel, "PCL", change, [])).toBe(channel);
    },
  );

  it("does not treat a PCL inlay trough aperture as a plateau region", () => {
    const channel = demoChannel("pcl-tibial");
    channel.geometryType = "pcl_inlay_trough";
    const result = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL" satisfies ProcedureIdentity,
      commit(channel, "aperture", [2, 1, 3]),
      [planeMesh("tibia-posterior", "tibia", 2)],
    );

    expect(result.apertureSurfaceAttachment?.reviewState).toBe("surface_review_not_evaluated");
    expect(result.warnings).not.toContain(TIBIAL_SUPERIOR_ENVELOPE_WARNING);
  });

  it("preserves flexible access geometry during numeric aperture edits and invalidates stale tethers", () => {
    const channel = demoChannel("pcl-tibial");
    channel.centerline = {
      kind: "flexible",
      aperturePatientRasMm: channel.aperture,
      intraosseousDirectionPatientRas: channel.vector,
      accessControlPointsPatientRasMm: [channel.aperture, [8, 9, 10]],
      minimumBendRadiusMm: 32,
    };
    const attached = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "aperture", [2, 1, 3]),
      [planeMesh("tibia-entry", "tibia", 2)],
    );
    const edited = applyNumericVectorComponentEdit(attached, "aperture", 0, 4);

    expect(edited.centerline).toEqual({
      kind: "flexible",
      aperturePatientRasMm: [4, 1, 2],
      intraosseousDirectionPatientRas: attached.vector,
      accessControlPointsPatientRasMm: [[4, 1, 2], [8, 9, 10]],
      minimumBendRadiusMm: 32,
    });
    expect(edited.apertureSurfaceAttachment).toBeNull();
    expect(edited.endpointSurfaceAttachment).toBeNull();
  });

  it("preserves polyline control points during numeric vector edits", () => {
    const channel = demoChannel("pcl-tibial");
    channel.centerline = {
      kind: "polyline",
      pointsPatientRasMm: [channel.aperture, [2, 0, -5], [0, 0, -10]],
    };
    const pointsBefore = structuredClone(channel.centerline.pointsPatientRasMm);
    const edited = applyNumericVectorComponentEdit(channel, "vector", 1, 0.25);

    expect(edited.centerline).toEqual({ kind: "polyline", pointsPatientRasMm: pointsBefore });
    expect(edited.vector[1]).toBe(0.25);
    expect(edited.endpointSurfaceAttachment).toBeNull();
  });

  it("invalidates endpoint triangle provenance whenever numeric depth moves it", () => {
    const channel = demoChannel("pcl-tibial");
    const attached = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "endpoint", [2, 1, -9]),
      [planeMesh("tibia-exit", "tibia", -10)],
    );
    expect(attached.endpointSurfaceAttachment).not.toBeNull();

    const edited = applyChannelDepthGeometryEdit(attached, 27.5);
    expect(edited.depthMm).toBe(27.5);
    expect(edited.endpointSurfaceAttachment).toBeNull();
  });

  it("preserves a socket's cortical Start when only socket depth changes", () => {
    const channel = demoChannel("acl-tibial");
    channel.aperture = [0, 0, 0];
    channel.vector = [0, 0, -1];
    channel.depthMm = 10;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [0, 0, -1],
    };
    const attached = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "endpoint", [2, 0, -9]),
      [planeMesh("tibia-start", "tibia", -10)],
    );
    const attachment = attached.endpointSurfaceAttachment;
    expect(attachment).not.toBeNull();

    const edited = applyChannelDepthGeometryEdit(attached, 27.5);
    expect(edited.depthMm).toBe(27.5);
    expect(edited.endpointSurfaceAttachment).toBe(attachment);
    expect(edited.surfacePlacement?.meshIds).toContain("tibia-start");
  });

  it("uses an anchor's free rod end to rotate only the inward socket trajectory", () => {
    const channel = demoChannel("acl-femoral");
    channel.geometryType = "anchor_pilot";
    channel.fullThickness = false;
    channel.aperture = [0, 0, 0];
    channel.vector = [1, 0, 0];
    channel.depthMm = 22;
    channel.diameterMm = 4.75;
    channel.crossSection = { kind: "circle", diameterMm: 4.75 };
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [1, 0, 0],
    };
    channel.apertureSurfaceAttachment = surfaceAttachment("femur", "femur-entry", [0, 0, 0]);
    channel.endpointSurfaceAttachment = surfaceAttachment("femur", "legacy-opposite-cortex", [20, 0, 0]);
    const apertureAttachment = channel.apertureSurfaceAttachment;

    const edited = applySurfaceConstrainedHandleCommit(
      channel,
      "ACL",
      commit(channel, "endpoint", [0, -35, 0]),
      [],
    );

    expect(edited.aperture).toEqual([0, 0, 0]);
    expect(edited.apertureSurfaceAttachment).toBe(apertureAttachment);
    expect(edited.endpointSurfaceAttachment).toBeNull();
    expect(edited.vector[0]).toBeCloseTo(0, 10);
    expect(edited.vector[1]).toBeCloseTo(1, 10);
    expect(edited.vector[2]).toBeCloseTo(0, 10);
    expect(edited.centerline).toMatchObject({ kind: "rigid", directionPatientRas: [0, 1, 0] });
    expect(edited.depthMm).toBe(22);
    expect(edited.diameterMm).toBe(4.75);
    expect(edited.instrumentChain).toBe(channel.instrumentChain);
    expect(edited.surfacePlacement).toMatchObject({
      method: "manual_trajectory_drag",
      endpointMethod: "preserved_depth",
      meshIds: ["femur-entry"],
    });
  });

  it("uses a blind socket's deep Start to rotate a fixed-depth coaxial pin without a cortex tether", () => {
    const channel = demoChannel("acl-femoral");
    channel.geometryType = "antegrade_blind_socket";
    channel.trajectoryControlMode = "blind_socket_tip";
    channel.aperture = [1, 2, 3];
    channel.vector = [1, 0, 0];
    channel.depthMm = 22;
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: channel.aperture,
      directionPatientRas: channel.vector,
    };
    channel.apertureSurfaceAttachment = surfaceAttachment("femur", "femur-entry", channel.aperture);
    channel.endpointSurfaceAttachment = surfaceAttachment("femur", "obsolete-opposite-cortex", [30, 2, 3]);

    const edited = applySurfaceConstrainedHandleCommit(
      channel,
      "MCL_POL_PMC",
      commit(channel, "endpoint", [1, 12, 3]),
      [],
    );

    expect(edited.aperture).toEqual([1, 2, 3]);
    expect(edited.vector[0]).toBeCloseTo(0, 10);
    expect(edited.vector[1]).toBeCloseTo(1, 10);
    expect(edited.vector[2]).toBeCloseTo(0, 10);
    expect(edited.depthMm).toBe(22);
    expectEndpoint(edited, [1, 24, 3]);
    expect(edited.endpointSurfaceAttachment).toBeNull();
    expect(edited.surfacePlacement).toEqual({
      state: "clinician_edited",
      method: "manual_trajectory_drag",
      meshIds: ["femur-entry"],
      endpointMethod: "blind_socket_tip",
    });
  });

  it("round-trips both surface attachments with identical geometry and frozen plan versions", () => {
    const plan = createSyntheticDemoCase();
    const channelIndex = plan.variants[0].channels.findIndex((channel) => channel.id === "pcl-tibial");
    const channel = structuredClone(plan.variants[0].channels[channelIndex]);
    channel.guidePin = { diameterMm: 4, provenance: "clinician_entered_planning_value" };
    channel.trajectoryControlMode = "outer_cortex_surface";
    const meshes = [
      planeMesh("tibia-entry", "tibia", 2),
      planeMesh("tibia-exit", "tibia", -10),
    ];
    const withEntry = applySurfaceConstrainedHandleCommit(
      channel,
      "PCL",
      commit(channel, "aperture", [2, 1, 3]),
      meshes,
    );
    const attached = applySurfaceConstrainedHandleCommit(
      withEntry,
      "PCL",
      commit(withEntry, "endpoint", [4, 0, -9]),
      meshes,
    );
    plan.variants[0].channels[channelIndex] = attached;

    const restored = deserializePlan<PlanCase>(serializePlan(plan));
    const restoredChannel = restored.variants[0].channels[channelIndex];
    expect(restoredChannel.apertureSurfaceAttachment).toEqual(attached.apertureSurfaceAttachment);
    expect(restoredChannel.endpointSurfaceAttachment).toEqual(attached.endpointSurfaceAttachment);
    expect(restoredChannel.guidePin).toEqual({ diameterMm: 4, provenance: "clinician_entered_planning_value" });
    expect(restoredChannel.trajectoryControlMode).toBe("outer_cortex_surface");
    expect(channelToGeometry(restoredChannel).geometryHash).toBe(channelToGeometry(attached).geometryHash);
    expect(restored.schemaVersion).toBe("1.7.0");
    expect(restored.catalogVersion).toBe(plan.catalogVersion);
    expect(restored.coordinateFrames).toEqual(plan.coordinateFrames);
  });
});
