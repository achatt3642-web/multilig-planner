import { describe, expect, it } from "vitest";
import type { ChannelPlan, ProcedureIdentity, Vector3 } from "../domain/types";
import { instantiateTechniquePreset } from "../presets/techniquePresets";
import { createSyntheticDemoCase } from "./caseFactory";
import {
  ANCHOR_TRAJECTORY_ROD_LENGTH_MM,
  POINT_ONLY_LOCATION_MARKER_RADIUS_MM,
  PROCEDURE_COLORS,
  anchorTrajectoryRodEnd,
  buildViewerScene,
  channelToGeometry,
} from "./channelGeometry";
import { resolveChannelStartPointPatientRas } from "./channelTrajectorySemantics";

const SYNTHETIC_SURFACE_MESH_BY_BONE: Record<ChannelPlan["bone"], string> = {
  femur: "femur-shaft",
  tibia: "tibia-shaft",
  fibula: "fibula-shaft",
  patella: "patella-surface",
  custom: "custom-surface",
};

function attachSurfaceStart(channel: ChannelPlan, point: Vector3): void {
  const meshId = SYNTHETIC_SURFACE_MESH_BY_BONE[channel.bone];
  channel.endpointSurfaceAttachment = {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone: channel.bone,
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId,
    requestedPointPatientRasMm: point,
    attachedPointPatientRasMm: point,
    distanceFromRequestedPointMm: 0,
    triangleStableId: `${meshId}:triangle:0`,
    faceStableId: `${meshId}:face:0`,
    faceIndex: 0,
    vertexIndices: [0, 1, 2],
    vertexStableIds: [`${meshId}:vertex:0`, `${meshId}:vertex:1`, `${meshId}:vertex:2`],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [1, 0, 0],
    reviewState: "surface_review_not_evaluated",
  };
}

function attachSurfaceEntry(channel: ChannelPlan, normal: Vector3): void {
  const meshId = SYNTHETIC_SURFACE_MESH_BY_BONE[channel.bone];
  channel.apertureSurfaceAttachment = {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone: channel.bone,
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId,
    requestedPointPatientRasMm: channel.aperture,
    attachedPointPatientRasMm: channel.aperture,
    distanceFromRequestedPointMm: 0,
    triangleStableId: `${meshId}:triangle:0`,
    faceStableId: `${meshId}:face:0`,
    faceIndex: 0,
    vertexIndices: [0, 1, 2],
    vertexStableIds: [`${meshId}:vertex:0`, `${meshId}:vertex:1`, `${meshId}:vertex:2`],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: normal,
    reviewState: "surface_review_not_evaluated",
  };
}

describe("catalog chain to patient-space geometry integration", () => {
  it("keeps derived anatomic reference geometry out of the planning scene", () => {
    const scene = buildViewerScene({
      revision: 1,
      channels: [],
      procedureById: {},
      selectedChannelId: null,
    }).scene;

    expect(scene.meshes.some((mesh) => mesh.analysisCategory === "anatomic_reference_plane")).toBe(false);
    expect(scene.meshes.some((mesh) => mesh.analysisCategory === "anatomic_reference_landmark")).toBe(false);
    expect(scene.lines.some((line) => line.id.startsWith("anatomic-reference-plane-outline:"))).toBe(false);
    expect(scene.lines.some((line) => line.id === "posterior-condylar-contact-line")).toBe(false);
    expect(scene.lines.some((line) => line.id === "joint-line-defining-triangle")).toBe(false);
    expect([
      ...scene.meshes.map((mesh) => mesh.id),
      ...scene.lines.map((line) => line.id),
      ...(scene.labels ?? []).map((label) => label.id),
    ].some((id) => id.startsWith("anatomic-reference-"))).toBe(false);
    expect(scene.meshes.filter((mesh) => mesh.layer === "bones")).toHaveLength(7);
  });

  it("uses the requested procedure identity palette", () => {
    expect(PROCEDURE_COLORS).toMatchObject({
      ACL: "#5eb5e8",
      PCL: "#e5484d",
      MEDIAL_ROOT: "#8b949e",
      LATERAL_ROOT: "#f8fafc",
      MCL_POL_PMC: "#f28c28",
      PLC_FCL: "#8b5cf6",
      ALL: "#166534",
      LET: "#ec8fb3",
    });
  });
  it("uses the explicitly selected branded size, pilot pathway, deployment, and depth", () => {
    const channel = structuredClone(createSyntheticDemoCase().variants[0].channels[0]);
    channel.instrumentChain = {
      ...channel.instrumentChain,
      manufacturerId: "mfr-smith-nephew",
      productFamilyId: "fam-smith-trunav",
      productVariantId: "var-smith-trunav",
      pinInstrumentId: "inst-smith-trunav-pin",
      cutterInstrumentId: "inst-smith-trunav",
      exactSizeOrProfileId: "var-smith-trunav:size:9",
      depthOrFullTunnelSetting: { mode: "depth", depthMm: 30 },
    };
    channel.dimensionsMm = {
      pilotLengthMm: 30,
      corticalChannelLengthMm: 30,
      deploymentLengthMm: 5,
    };
    const geometry = channelToGeometry(channel);
    expect(geometry.complete).toBe(true);
    const removal = geometry.layers.find((layer) => layer.type === "boneRemovalOrCompaction")!;
    expect(removal.primitives.map((primitive) => primitive.supportRadiusMm)).toEqual([1.2, 4.5, 2.45]);
    expect(removal.primitives[1].segments[0].end.x).not.toBe(removal.primitives[1].segments[0].start.x);
    const deployment = geometry.layers.find((layer) => layer.type === "cutterDeploymentRetraction")!;
    expect(deployment.primitives[0].supportRadiusMm).toBe(4.5);

    channel.instrumentChain.exactSizeOrProfileId = "var-smith-trunav:size:8";
    expect(channelToGeometry(channel).geometryHash).not.toBe(geometry.geometryHash);
  });

  it("renders the PCL transtibial Entry-to-Start pin trajectory", () => {
    const plan = createSyntheticDemoCase();
    const variant = plan.variants[0];
    const pclTibial = variant.channels.find((channel) => channel.id === "pcl-tibial")!;
    expect(pclTibial.fullThickness).toBe(true);
    attachSurfaceStart(pclTibial, [3.2, -26.35, -19.05]);
    const scene = buildViewerScene({
      revision: 1,
      channels: variant.channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: "pcl-tibial",
    }).scene;
    const trajectory = scene.lines.find((line) => line.id === "pcl-tibial-pin-trajectory");
    expect(trajectory).toMatchObject({
      layer: "pins",
      color: "#e5484d",
      channelId: "pcl-tibial",
      points: [[-4, -7, 21], [3.2, -26.35, -19.05]],
    });
    expect(scene.lines.some((line) => line.id.includes("predicted-pin-overshoot"))).toBe(false);
  });

  it("replaces synthetic preview bones with resolved patient anatomy meshes", () => {
    const plan = createSyntheticDemoCase();
    const patientMesh = {
      id: "mesh-femur-sha256",
      name: "Segmented femur · research only",
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      faces: [[0, 1, 2]],
      color: "#d4dddf",
      opacity: 0.42,
      layer: "bones" as const,
      anatomyBone: "femur" as const,
    };
    const scene = buildViewerScene({
      revision: 2,
      channels: plan.variants[0].channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: null,
      anatomyMeshes: [patientMesh],
    }).scene;

    expect(scene.meshes.filter((mesh) => mesh.layer === "bones")).toEqual([patientMesh]);
    expect(scene.meshes.some((mesh) => mesh.id === "femur-shaft")).toBe(false);
  });

  it("does not substitute demo bones when patient anatomy assets are expected but unavailable", () => {
    const plan = createSyntheticDemoCase();
    const scene = buildViewerScene({
      revision: 3,
      channels: plan.variants[0].channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: null,
      anatomyMeshes: [],
    }).scene;

    expect(scene.meshes.filter((mesh) => mesh.layer === "bones")).toHaveLength(0);
  });

  it("automatically labels rendered tunnel volumes with their full channel identity", () => {
    const plan = createSyntheticDemoCase();
    const scene = buildViewerScene({
      revision: 4,
      channels: plan.variants[0].channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: "pcl-tibial",
    }).scene;

    expect(scene.layerVisibility.boneRemoval).toBe(true);
    expect(scene.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "pcl-tibial-tunnel-label",
        text: "PCL transtibial tunnel",
        layer: "boneRemoval",
        channelId: "pcl-tibial",
      }),
    ]));
  });

  it("keeps hidden channels in analytic geometry without emitting render payloads or handles", () => {
    const plan = createSyntheticDemoCase();
    const channels = plan.variants[0].channels;
    const hiddenSelectedChannel = channels.find((channel) => channel.id === "pcl-tibial")!;
    attachSurfaceStart(hiddenSelectedChannel, [3.2, -26.35, -19.05]);

    const { scene, geometry } = buildViewerScene({
      revision: 5,
      channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: hiddenSelectedChannel.id,
      visibleProcedureIdentities: new Set(["ACL"]),
    });

    expect(geometry.has(hiddenSelectedChannel.id)).toBe(true);
    expect(geometry.size).toBe(channels.length);
    expect(scene.meshes.some((mesh) => mesh.channelId === hiddenSelectedChannel.id)).toBe(false);
    expect(scene.lines.some((line) => line.channelId === hiddenSelectedChannel.id)).toBe(false);
    expect((scene.labels ?? []).some((label) => label.channelId === hiddenSelectedChannel.id)).toBe(false);
    expect(scene.handles.some((handle) => handle.channelId === hiddenSelectedChannel.id)).toBe(false);
    expect(scene.lines.some((line) => line.channelId === "acl-femoral")).toBe(true);
  });

  it("renders anatomy only for an explicit zero-highlight procedure selection", () => {
    const plan = createSyntheticDemoCase();
    const channels = plan.variants[0].channels;

    const { scene, geometry } = buildViewerScene({
      revision: 6,
      channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: "acl-femoral",
      visibleProcedureIdentities: new Set(),
    });

    expect(geometry.size).toBe(channels.length);
    expect(scene.meshes.some((mesh) => mesh.layer === "bones")).toBe(true);
    expect(scene.meshes.some((mesh) => mesh.channelId !== undefined)).toBe(false);
    expect(scene.lines).toHaveLength(0);
    expect(scene.labels ?? []).toHaveLength(0);
    expect(scene.handles).toHaveLength(0);
  });

  it("keeps an unmapped procedure hidden instead of treating it as visible Custom", () => {
    const plan = createSyntheticDemoCase();
    const unmappedChannel = structuredClone(plan.variants[0].channels[0]);
    unmappedChannel.id = "unmapped-channel";
    unmappedChannel.procedureId = "missing-procedure";

    const { scene, geometry } = buildViewerScene({
      revision: 7,
      channels: [unmappedChannel],
      procedureById: {},
      selectedChannelId: unmappedChannel.id,
      visibleProcedureIdentities: new Set(["CUSTOM"]),
    });

    expect(geometry.has(unmappedChannel.id)).toBe(true);
    expect(scene.meshes.some((mesh) => mesh.channelId === unmappedChannel.id)).toBe(false);
    expect(scene.lines.some((line) => line.channelId === unmappedChannel.id)).toBe(false);
    expect(scene.labels ?? []).toHaveLength(0);
    expect(scene.handles).toHaveLength(0);
  });

  it("renders every channel in a multi-procedure visible selection together", () => {
    const plan = createSyntheticDemoCase();
    const channels = plan.variants[0].channels;
    const visibleProcedureIdentities = new Set<ProcedureIdentity>(["ACL", "PCL", "MEDIAL_ROOT"]);
    const expectedVisibleChannelIds = channels
      .filter((channel) => visibleProcedureIdentities.has(
        plan.procedures.find((procedure) => procedure.id === channel.procedureId)?.structure ?? "CUSTOM",
      ))
      .map((channel) => channel.id);

    const { scene, geometry } = buildViewerScene({
      revision: 6,
      channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: "pcl-tibial",
      visibleProcedureIdentities,
    });

    expect(geometry.size).toBe(channels.length);
    for (const channelId of expectedVisibleChannelIds) {
      expect(scene.lines.some((line) => line.channelId === channelId)).toBe(true);
    }
    const renderedChannelIds = new Set([
      ...scene.meshes.flatMap((mesh) => mesh.channelId ? [mesh.channelId] : []),
      ...scene.lines.flatMap((line) => line.channelId ? [line.channelId] : []),
      ...(scene.labels ?? []).flatMap((label) => label.channelId ? [label.channelId] : []),
      ...scene.handles.flatMap((handle) => handle.channelId ? [handle.channelId] : []),
    ]);
    expect([...renderedChannelIds].sort()).toEqual(expectedVisibleChannelIds.sort());
  });

  it("colors an intra-articular Entry marker like its tunnel and constrains it to tibia meshes", () => {
    const plan = createSyntheticDemoCase();
    const aclTibial = plan.variants[0].channels.find((channel) => channel.id === "acl-tibial")!;
    attachSurfaceEntry(aclTibial, [0, 0, 1]);
    attachSurfaceStart(aclTibial, [-0.6, -1.4, -10]);
    const scene = buildViewerScene({
      revision: 5,
      channels: plan.variants[0].channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: "acl-tibial",
    }).scene;
    const entry = scene.handles.find((handle) => handle.kind === "aperture");
    const tunnel = scene.meshes.find((mesh) =>
      mesh.channelId === aclTibial.id && mesh.layer === "boneRemoval",
    );

    expect(entry).toMatchObject({
      semanticRole: "entry",
      label: "Entry point - ACL tibial retro socket",
      color: "#5eb5e8",
      surfaceNormalPatientRas: [0, 0, 1],
      surfaceConstraint: { meshIds: ["tibia-plateau", "tibia-shaft"] },
    });
    expect(entry?.color).toBe(tunnel?.color);
    expect(entry?.surfaceConstraint?.mode).toBe("tibial_superior_envelope");
    expect(scene.handles.some((handle) => handle.kind === "diameter" || handle.kind === "orientation")).toBe(false);
    expect(scene.handles.find((handle) => handle.kind === "endpoint")).toMatchObject({
      semanticRole: "start",
      label: "Start point - ACL tibial retro socket",
      position: [-0.6, -1.4, -10],
      surfaceConstraint: { meshIds: ["tibia-plateau", "tibia-shaft"], mode: "nearest_surface" },
    });
    expect(scene.handles.map((handle) => handle.semanticRole)).toEqual(["entry", "start"]);
  });

  it("surface-constrains Entry and cortical Start for both full tunnels and sockets", () => {
    const plan = createSyntheticDemoCase();
    const procedureById = Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure]));
    attachSurfaceStart(plan.variants[0].channels.find((channel) => channel.id === "pcl-tibial")!, [3.2, -26.35, -19.05]);
    attachSurfaceStart(plan.variants[0].channels.find((channel) => channel.id === "pcl-femoral")!, [-29, -11.7, 49.4]);
    const fullTunnel = buildViewerScene({
      revision: 6,
      channels: plan.variants[0].channels,
      procedureById,
      selectedChannelId: "pcl-tibial",
    }).scene;
    const socket = buildViewerScene({
      revision: 7,
      channels: plan.variants[0].channels,
      procedureById,
      selectedChannelId: "pcl-femoral",
    }).scene;

    expect(fullTunnel.handles.find((handle) => handle.kind === "endpoint")).toMatchObject({
      semanticRole: "start",
      surfaceConstraint: { meshIds: ["tibia-plateau", "tibia-shaft"], mode: "nearest_surface" },
      label: "Start point - PCL transtibial tunnel",
    });
    expect(socket.handles.find((handle) => handle.kind === "endpoint")).toMatchObject({
      semanticRole: "start",
      label: "Start point - PCL femoral socket",
      surfaceConstraint: { meshIds: ["femur-shaft", "femur-medial-condyle", "femur-lateral-condyle"], mode: "nearest_surface" },
    });
    expect(socket.handles.map((handle) => handle.semanticRole)).toEqual(["entry", "start"]);
    const socketChannel = plan.variants[0].channels.find((channel) => channel.id === "pcl-femoral")!;
    expect(socket.handles.find((handle) => handle.kind === "endpoint")?.position).toEqual(
      resolveChannelStartPointPatientRas(socketChannel, {
        eligibleSurfaceMeshIds: new Set(["femur-shaft", "femur-medial-condyle", "femur-lateral-condyle"]),
      })?.pointPatientRasMm,
    );
    expect(socket.lines.find((line) => line.id === "pcl-femoral-pin-trajectory")).toMatchObject({
      points: [[-5, -5, 46], [-29, -11.7, 49.4]],
      layer: "pins",
      channelId: "pcl-femoral",
    });
  });

  it("passes the persisted femoral attachment normal for a notch-tangent Entry ring", () => {
    const plan = createSyntheticDemoCase();
    const pclFemoral = plan.variants[0].channels.find((channel) => channel.id === "pcl-femoral")!;
    attachSurfaceEntry(pclFemoral, [1, 0, 0]);

    const scene = buildViewerScene({
      revision: 7,
      channels: plan.variants[0].channels,
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: pclFemoral.id,
    }).scene;

    expect(scene.handles.find((handle) => handle.kind === "aperture")).toMatchObject({
      label: "Entry point - PCL femoral socket",
      surfaceNormalPatientRas: [1, 0, 0],
    });
  });

  it("keeps socket depth geometry separate from its cortical pin trajectory", () => {
    const plan = createSyntheticDemoCase();
    const channel = structuredClone(plan.variants[0].channels.find((item) => item.id === "acl-tibial")!);
    channel.geometryType = "antegrade_blind_socket";
    channel.aperture = [0, 0, 0];
    channel.vector = [1, 0, 0];
    channel.centerline = { kind: "rigid", aperturePatientRasMm: [0, 0, 0], directionPatientRas: [1, 0, 0] };
    channel.depthMm = 20;
    channel.tipOvershootMm = 8;
    attachSurfaceStart(channel, [50, 0, 0]);

    const scene = buildViewerScene({
      revision: 8,
      channels: [channel],
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: channel.id,
    }).scene;

    expect(scene.lines.find((line) => line.id === `${channel.id}-axis`)?.points).toEqual([[0, 0, 0], [20, 0, 0]]);
    expect(scene.lines.find((line) => line.id === `${channel.id}-pin-trajectory`)?.points).toEqual([[0, 0, 0], [50, 0, 0]]);
    expect(scene.lines.some((line) => line.id === `${channel.id}-predicted-pin-overshoot`)).toBe(false);
    expect(scene.handles.find((handle) => handle.kind === "endpoint")?.position).toEqual([50, 0, 0]);
  });

  it("uses the shared blind-socket Start resolver for the Viewer handle", () => {
    const plan = createSyntheticDemoCase();
    const channel = structuredClone(plan.variants[0].channels.find((item) => item.id === "acl-tibial")!);
    channel.geometryType = "antegrade_blind_socket";
    channel.trajectoryControlMode = "blind_socket_tip";
    channel.aperture = [0, 0, 0];
    channel.vector = [1, 0, 0];
    channel.depthMm = 20;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: null, depthMm: null };

    const scene = buildViewerScene({
      revision: 9,
      channels: [channel],
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: channel.id,
    }).scene;
    const resolved = resolveChannelStartPointPatientRas(channel);

    expect(resolved).toEqual({
      pointPatientRasMm: [20, 0, 0],
      source: "blind_socket_tip",
    });
    expect(scene.handles.find((handle) => handle.kind === "endpoint")).toMatchObject({
      semanticRole: "start",
      position: resolved!.pointPatientRasMm,
      label: `Start point - ${channel.label}`,
    });
  });

  it("renders a MAT-style anchor socket with a collinear 28 mm exterior trajectory rod", () => {
    let id = 0;
    const instantiated = instantiateTechniquePreset("all-anchor-onlay", {
      createId: () => `anchor-viewer-${++id}`,
    });
    const channel = instantiated.channels[0];
    channel.aperture = [0, 0, 0];
    channel.vector = [1, 0, 0];
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 0],
      directionPatientRas: [1, 0, 0],
    };
    attachSurfaceEntry(channel, [-1, 0, 0]);

    expect(anchorTrajectoryRodEnd(channel)).toEqual([-ANCHOR_TRAJECTORY_ROD_LENGTH_MM, 0, 0]);
    const { scene, geometry } = buildViewerScene({
      revision: 11,
      channels: [channel],
      procedureById: { [instantiated.procedure.id]: "ALL" },
      selectedChannelId: channel.id,
    });

    const rodHandle = scene.handles.find((handle) => handle.kind === "endpoint");
    const surfaceStartHandle = scene.handles.find((handle) => handle.kind === "aperture");
    const resolvedStart = resolveChannelStartPointPatientRas(channel);
    expect(scene.handles.map((handle) => handle.semanticRole)).toEqual(["start", "trajectory"]);
    expect(surfaceStartHandle).toMatchObject({
      position: [0, 0, 0],
      semanticRole: "start",
      label: `Start point - ${channel.label}`,
      surfaceConstraint: expect.objectContaining({ mode: "nearest_surface" }),
    });
    expect(resolvedStart).toEqual({
      pointPatientRasMm: [0, 0, 0],
      source: "anchor_aperture_surface_attachment",
    });
    expect(rodHandle).toMatchObject({
      position: [-ANCHOR_TRAJECTORY_ROD_LENGTH_MM, 0, 0],
      semanticRole: "trajectory",
      label: `Trajectory - ${channel.label}`,
      trajectoryPivotPatientRas: [0, 0, 0],
      trajectoryRadiusMm: 1,
    });
    expect(rodHandle?.surfaceConstraint).toBeUndefined();
    expect(rodHandle?.position).not.toEqual(resolvedStart?.pointPatientRasMm);
    expect(scene.lines.some((line) => line.id === `${channel.id}-pin-trajectory`)).toBe(false);
    expect(scene.meshes.some((mesh) => mesh.channelId === channel.id && mesh.layer === "boneRemoval")).toBe(true);
    const pilot = geometry.get(channel.id)?.layers
      .find((layer) => layer.type === "boneRemovalOrCompaction")?.primitives[0];
    expect(pilot?.segments[0]).toMatchObject({ start: { x: 0, y: 0, z: 0 } });
    expect(pilot?.segments[0].end.x).toBeCloseTo(channel.depthMm!, 8);
  });

  it("persists a point-only root fixation marker without inventing a pilot or bone-removal volume", () => {
    let id = 0;
    const instantiated = instantiateTechniquePreset("medial-root-no-bone-channel", {
      createId: () => `root-point-${++id}`,
    });
    const channel = instantiated.channels[0];
    channel.aperture = [8, -4, 15];
    channel.centerline = {
      kind: "rigid",
      aperturePatientRasMm: channel.aperture,
      directionPatientRas: [0, 0, 1],
    };
    channel.diameterMm = 3;
    channel.crossSection = { kind: "circle", diameterMm: 3 };
    channel.depthMm = 12;
    attachSurfaceEntry(channel, [0, 0, 1]);
    // Stale dimensions and an endpoint from an older socket representation
    // must not turn a point-only location back into a pilot or Start handle.
    attachSurfaceStart(channel, [8, -4, -12]);

    const unselected = buildViewerScene({
      revision: 12,
      channels: [channel],
      procedureById: { [instantiated.procedure.id]: "MEDIAL_ROOT" },
      selectedChannelId: null,
      visibleProcedureIdentities: new Set(["MEDIAL_ROOT"]),
    });
    const marker = unselected.scene.meshes.find((mesh) =>
      mesh.id === `${channel.id}-point-only-location`,
    );

    expect(marker).toMatchObject({
      name: `${channel.label} · point-only fixation location`,
      layer: "hardware",
      channelId: channel.id,
      color: "#8b949e",
    });
    expect(Math.max(...marker!.vertices.map((vertex) => vertex[2]))).toBeCloseTo(
      channel.aperture[2] + POINT_ONLY_LOCATION_MARKER_RADIUS_MM,
      8,
    );
    expect(unselected.scene.labels).toContainEqual(expect.objectContaining({
      id: `${channel.id}-point-only-location-label`,
      text: channel.label,
      layer: "hardware",
      channelId: channel.id,
    }));
    expect(unselected.scene.lines.some((line) => line.channelId === channel.id)).toBe(false);
    expect(unselected.scene.meshes.some((mesh) =>
      mesh.channelId === channel.id && mesh.layer === "boneRemoval",
    )).toBe(false);
    expect(unselected.geometry.get(channel.id)).toMatchObject({
      recipeType: "noLargeTunnel",
      layers: [],
      metadata: { noLargeTunnel: true },
    });

    const selected = buildViewerScene({
      revision: 13,
      channels: [channel],
      procedureById: { [instantiated.procedure.id]: "MEDIAL_ROOT" },
      selectedChannelId: channel.id,
      visibleProcedureIdentities: new Set(["MEDIAL_ROOT"]),
    }).scene;
    expect(selected.meshes.some((mesh) => mesh.id === `${channel.id}-point-only-location`)).toBe(true);
    expect(selected.handles).toEqual([
      expect.objectContaining({
        kind: "aperture",
        semanticRole: "entry",
        label: `Entry point - ${channel.label}`,
        color: "#8b949e",
        surfaceConstraint: expect.objectContaining({ mode: "tibial_superior_envelope" }),
      }),
    ]);
  });

  it("filters point-only fixation markers with their procedure while retaining analytic state", () => {
    let id = 0;
    const instantiated = instantiateTechniquePreset("lateral-root-no-bone-channel", {
      createId: () => `hidden-root-point-${++id}`,
    });
    const channel = instantiated.channels[0];
    channel.aperture = [5, 3, 14];

    const { scene, geometry } = buildViewerScene({
      revision: 14,
      channels: [channel],
      procedureById: { [instantiated.procedure.id]: "LATERAL_ROOT" },
      selectedChannelId: channel.id,
      visibleProcedureIdentities: new Set(["ACL"]),
    });

    expect(geometry.has(channel.id)).toBe(true);
    expect(scene.meshes.some((mesh) => mesh.channelId === channel.id)).toBe(false);
    expect(scene.lines.some((line) => line.channelId === channel.id)).toBe(false);
    expect(scene.labels?.some((label) => label.channelId === channel.id)).toBe(false);
    expect(scene.handles.some((handle) => handle.channelId === channel.id)).toBe(false);
  });

  it("ignores a stale persisted tip overshoot without making rigid-pin geometry incomplete", () => {
    const plan = createSyntheticDemoCase();
    const channel = structuredClone(plan.variants[0].channels.find((item) => item.id === "acl-tibial")!);
    channel.geometryType = "rigid_pin";
    channel.depthMm = 30;
    channel.diameterMm = 2.4;
    channel.crossSection = { kind: "circle", diameterMm: 2.4 };
    channel.tipOvershootMm = 8;

    const geometry = channelToGeometry(channel);

    expect(geometry.complete).toBe(true);
    expect(geometry.missingDimensions).not.toContain("tipOvershootMm");
    expect(geometry.layers).toHaveLength(1);
    expect(geometry.layers[0].primitives).toHaveLength(1);
    expect(geometry.layers[0].primitives[0].id).toBe(`${channel.id}:pin-tract`);
  });

  it("keeps an unresolved quick-add aperture visible without inventing a depth endpoint", () => {
    const plan = createSyntheticDemoCase();
    const channel = structuredClone(plan.variants[0].channels.find((item) => item.id === "acl-tibial")!);
    channel.depthMm = null;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: null, depthMm: null };
    const scene = buildViewerScene({
      revision: 9,
      channels: [channel],
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: channel.id,
    }).scene;

    expect(scene.handles).toEqual([
      expect.objectContaining({ kind: "aperture", semanticRole: "entry" }),
    ]);
  });

  it("never invents a mid-air Start from numeric socket depth", () => {
    const plan = createSyntheticDemoCase();
    const channel = structuredClone(plan.variants[0].channels.find((item) => item.id === "pcl-femoral")!);
    channel.endpointSurfaceAttachment = null;
    const scene = buildViewerScene({
      revision: 10,
      channels: [channel],
      procedureById: Object.fromEntries(plan.procedures.map((procedure) => [procedure.id, procedure.structure])),
      selectedChannelId: channel.id,
    }).scene;

    expect(scene.handles.map((handle) => handle.semanticRole)).toEqual(["entry"]);
    expect(scene.lines.some((line) => line.id === `${channel.id}-pin-trajectory`)).toBe(false);
    expect(scene.lines.some((line) => line.id === `${channel.id}-predicted-pin-overshoot`)).toBe(false);
  });

  it("generates an imported 2D profile only after source ID, scale, and outline are explicit", () => {
    const channel = structuredClone(createSyntheticDemoCase().variants[0].channels[0]);
    channel.geometryType = "noncircular_tunnel";
    channel.crossSection = {
      kind: "imported_profile",
      assetId: "profile-sha256-abc",
      scaleMmPerUnit: 2,
      pointsSourceUnits: [[-2, -1], [2, -1], [2, 1], [-2, 1]],
      rotationDeg: 12,
    };
    channel.orientationDeg = 12;
    const geometry = channelToGeometry(channel);
    expect(geometry.complete).toBe(true);
    expect(geometry.layers[0].metadata?.profileKind).toBe("importedProfile");
  });

  it("keeps retrograde deployment and channel extents not evaluated until explicitly entered", () => {
    const channel = structuredClone(createSyntheticDemoCase().variants[0].channels[0]);
    const geometry = channelToGeometry(channel);
    expect(geometry.complete).toBe(false);
    expect(geometry.missingDimensions).toEqual(expect.arrayContaining([
      "pilotLengthMm",
      "corticalChannelLengthMm",
      "deploymentLengthMm",
    ]));
  });

  it("routes the explicitly selected staple subtype to pilots, retained legs, and bridge hardware", () => {
    const channel = structuredClone(createSyntheticDemoCase().variants[0].channels[0]);
    channel.geometryType = "post_washer_staple";
    channel.hardwareSubtype = "staple";
    channel.diameterMm = 2.4;
    channel.crossSection = { kind: "circle", diameterMm: 2.4 };
    channel.dimensionsMm = {
      stapleLegSpacingMm: 8,
      stapleLegDiameterMm: 3,
      stapleBridgeWidthMm: 5,
      stapleBridgeThicknessMm: 2,
    };
    const geometry = channelToGeometry(channel);
    expect(geometry.complete).toBe(true);
    expect(geometry.recipeType).toBe("staple");
    expect(geometry.layers.map((layer) => layer.type)).toEqual([
      "boneRemovalOrCompaction",
      "retainedFixation",
      "surfaceHardwareAndFlipDeployment",
    ]);
  });
});
