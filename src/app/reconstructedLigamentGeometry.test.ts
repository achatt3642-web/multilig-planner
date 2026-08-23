import { describe, expect, it } from "vitest";
import type {
  ChannelPlan,
  ProcedureIdentity,
  Vector3,
} from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import { buildSyntheticAnatomyMeshes, buildViewerScene } from "./channelGeometry";
import { createSyntheticDemoCase } from "./caseFactory";
import { buildReconstructedLigamentPayloads } from "./reconstructedLigamentGeometry";
import { resolvedChannelAxis } from "./resolvedChannelGeometry";

const MESH_BY_BONE: Record<ChannelPlan["bone"], string> = {
  femur: "femur-shaft",
  tibia: "tibia-shaft",
  fibula: "fibula-shaft",
  patella: "patella-surface",
  custom: "custom-surface",
};

function attachEntry(
  channel: ChannelPlan,
  point: Vector3 = channel.aperture,
  surfaceNormal: Vector3 = [1, 0, 0],
): void {
  channel.aperture = [...point];
  channel.centerline = {
    kind: "rigid",
    aperturePatientRasMm: [...point],
    directionPatientRas: [...channel.vector],
  };
  const meshId = MESH_BY_BONE[channel.bone];
  channel.apertureSurfaceAttachment = {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone: channel.bone,
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId,
    requestedPointPatientRasMm: [...point],
    attachedPointPatientRasMm: [...point],
    distanceFromRequestedPointMm: 0,
    triangleStableId: `${meshId}:face:0`,
    faceStableId: `${meshId}:face:0`,
    faceIndex: 0,
    vertexIndices: [0, 1, 2],
    vertexStableIds: [`${meshId}:vertex:0`, `${meshId}:vertex:1`, `${meshId}:vertex:2`],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [...surfaceNormal],
    reviewState: "surface_review_not_evaluated",
  };
}

const RADIAL_SEGMENTS = 36;

function ringCenter(mesh: ViewerMeshPayload, ringIndex: number): Vector3 {
  const ring = mesh.vertices.slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS);
  const mean = (axis: 0 | 1 | 2) =>
    ring.reduce((sum, vertex) => sum + vertex[axis], 0) / ring.length;
  return [mean(0), mean(1), mean(2)];
}

function ringRadii(mesh: ViewerMeshPayload, ringIndex: number): number[] {
  const center = ringCenter(mesh, ringIndex);
  return mesh.vertices
    .slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS)
    .map((vertex) => Math.hypot(
      vertex[0] - center[0],
      vertex[1] - center[1],
      vertex[2] - center[2],
    ));
}

function distance3ForTest(left: Vector3, right: Vector3): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function vector3(value: readonly number[]): Vector3 {
  if (value.length !== 3) throw new Error("Expected a 3D point");
  return [value[0], value[1], value[2]];
}

function toTupleForTest(value: { x: number; y: number; z: number }): Vector3 {
  return [value.x, value.y, value.z];
}

function closestPointIndex(points: readonly Vector3[], target: Vector3): number {
  return points.reduce((closestIndex, point, index) =>
    distance3ForTest(point, target) < distance3ForTest(points[closestIndex], target)
      ? index
      : closestIndex, 0);
}

function unitDirection(start: Vector3, end: Vector3): Vector3 {
  const delta: Vector3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const length = Math.hypot(...delta);
  return [delta[0] / length, delta[1] / length, delta[2] / length];
}

function dotForTest(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function boxMesh(
  id: string,
  bone: "femur" | "tibia",
  min: Vector3,
  max: Vector3,
): ViewerMeshPayload {
  const vertices = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]],
    [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]],
    [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  return {
    id,
    name: `${bone} planar clearance fixture`,
    vertices,
    faces: [
      [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
      [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
    ],
    color: "#ccd6d8",
    opacity: 0.3,
    layer: "bones",
    anatomyBone: bone,
  };
}

function aclFixture(): {
  channels: ChannelPlan[];
  procedureById: Record<string, ProcedureIdentity>;
  anatomyMeshes: ViewerMeshPayload[];
} {
  const plan = createSyntheticDemoCase();
  const channels = plan.variants[0].channels
    .filter((channel) => channel.procedureId === "proc-acl")
    .map((channel) => structuredClone(channel));
  channels.forEach((channel) => attachEntry(channel));
  return {
    channels,
    procedureById: { "proc-acl": "ACL" },
    anatomyMeshes: buildSyntheticAnatomyMeshes(),
  };
}

describe("reconstructed ligament display geometry", () => {
  it("builds a deterministic, constant-radius translucent graft with longitudinal fibers", () => {
    const fixture = aclFixture();
    const first = buildReconstructedLigamentPayloads({
      ...fixture,
      selectedChannelId: fixture.channels[0].id,
    });
    const second = buildReconstructedLigamentPayloads({
      ...fixture,
      selectedChannelId: fixture.channels[0].id,
    });

    expect(first).toEqual(second);
    expect(first.meshes).toHaveLength(1);
    expect(first.labels).toHaveLength(1);
    expect(first.meshes[0]).toMatchObject({
      id: "reconstructed-graft:proc-acl:single",
      name: "ACL reconstructed graft · planning preview",
      layer: "grafts",
      analysisCategory: "reconstructed_ligament_preview",
      materialStyle: "biologic_graft",
      opacity: 0.76,
    });
    expect(["#f2ccd8", "#f6dce4", "#fbecef"]).toContain(first.meshes[0].color);
    expect(first.meshes[0].fiberPaths).toHaveLength(4);
    const ringCount = first.meshes[0].fiberPaths?.[0]?.length ?? 0;
    expect(ringCount).toBeGreaterThan(29);
    expect(first.meshes[0].fiberPaths?.every((path) => path.length === ringCount)).toBe(true);
    expect(first.meshes[0].vertices.length).toBeGreaterThan(500);
    expect(first.meshes[0].faces.length).toBeGreaterThan(1_000);

    const radii = [0, Math.floor(ringCount / 2), ringCount - 1]
      .flatMap((ringIndex) => ringRadii(first.meshes[0], ringIndex));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-8);
  });

  it("keeps ACL and PCL grafts continuous through their resolved femoral and tibial conduits", () => {
    const plan = createSyntheticDemoCase();
    for (const [procedureId, procedure] of [["proc-acl", "ACL"], ["proc-pcl", "PCL"]] as const) {
      const channels = plan.variants[0].channels
        .filter((channel) => channel.procedureId === procedureId)
        .map((channel) => structuredClone(channel));
      channels.forEach((channel) => attachEntry(channel));
      const femoral = channels.find((channel) => channel.bone === "femur")!;
      const tibial = channels.find((channel) => channel.bone === "tibia")!;
      if (procedure === "ACL") {
        femoral.depthMm = 31;
        femoral.instrumentChain.depthOrFullTunnelSetting = { mode: "depth", depthMm: 14 };
      }
      const femoralAxis = resolvedChannelAxis(femoral)!;
      const tibialAxis = resolvedChannelAxis(tibial)!;
      const result = buildReconstructedLigamentPayloads({
        channels,
        procedureById: { [procedureId]: procedure },
        anatomyMeshes: buildSyntheticAnatomyMeshes(),
        selectedChannelId: null,
      });
      const mesh = result.meshes[0];
      expect(mesh, procedure).toBeDefined();
      const ringCount = mesh.fiberPaths?.[0]?.length ?? 0;
      const centers = Array.from({ length: ringCount }, (_, index) => ringCenter(mesh, index));
      const capCenters = mesh.vertices.slice(-2).map(vector3);

      expect(distance3ForTest(capCenters[0], toTupleForTest(femoralAxis.end)), procedure).toBeLessThan(1e-6);
      expect(distance3ForTest(capCenters[1], toTupleForTest(tibialAxis.end)), procedure).toBeLessThan(1e-6);
      const femoralApertureIndex = closestPointIndex(centers, femoral.aperture);
      const tibialApertureIndex = closestPointIndex(centers, tibial.aperture);
      expect(distance3ForTest(centers[femoralApertureIndex], femoral.aperture), procedure).toBeLessThan(1e-6);
      expect(distance3ForTest(centers[tibialApertureIndex], tibial.aperture), procedure).toBeLessThan(1e-6);
      expect(femoralApertureIndex).toBeGreaterThan(0);
      expect(tibialApertureIndex).toBeLessThan(ringCount - 1);

      const radius = ringRadii(mesh, 0)[0];
      expect(radius).toBeLessThanOrEqual(femoralAxis.boreDiameterMm! / 2 + 1e-8);
      expect(radius).toBeLessThanOrEqual(tibialAxis.boreDiameterMm! / 2 + 1e-8);
      expect(mesh.faces).toHaveLength((ringCount - 1) * RADIAL_SEGMENTS * 2 + RADIAL_SEGMENTS * 2);
      expect(mesh.fiberPaths?.every((path) => path.length === ringCount)).toBe(true);
      if (procedure === "ACL") {
        expect(distance3ForTest(capCenters[0], femoral.aperture)).toBeCloseTo(14, 6);
        expect(distance3ForTest(capCenters[0], femoral.aperture)).not.toBeCloseTo(31, 2);
      }

      const femoralBefore = unitDirection(centers[femoralApertureIndex - 1], centers[femoralApertureIndex]);
      const femoralAfter = unitDirection(centers[femoralApertureIndex], centers[femoralApertureIndex + 1]);
      const tibialBefore = unitDirection(centers[tibialApertureIndex - 1], centers[tibialApertureIndex]);
      const tibialAfter = unitDirection(centers[tibialApertureIndex], centers[tibialApertureIndex + 1]);
      expect(dotForTest(femoralBefore, femoralAfter), procedure).toBeGreaterThan(0.995);
      expect(dotForTest(tibialBefore, tibialAfter), procedure).toBeGreaterThan(0.995);
    }
  });

  it("keeps the complete ALL tube volume tangent to and outside planar bone surfaces", () => {
    const fixture = aclFixture();
    const femoral = structuredClone(fixture.channels.find((channel) => channel.bone === "femur")!);
    const tibial = structuredClone(fixture.channels.find((channel) => channel.bone === "tibia")!);
    femoral.id = "all-femoral";
    femoral.procedureId = "proc-all";
    femoral.label = "ALL femur anchor";
    femoral.geometryType = "anchor_pilot";
    femoral.diameterMm = 2.6;
    femoral.crossSection = { kind: "circle", diameterMm: 2.6 };
    tibial.id = "all-tibial";
    tibial.procedureId = "proc-all";
    tibial.label = "ALL tibia anchor";
    tibial.geometryType = "anchor_pilot";
    tibial.diameterMm = 2.6;
    tibial.crossSection = { kind: "circle", diameterMm: 2.6 };
    attachEntry(femoral, [0, 0, 30], [1, 0, 0]);
    attachEntry(tibial, [0, 0, 0], [1, 0, 0]);
    const anatomyMeshes = [
      boxMesh("femur-shaft", "femur", [-30, -20, 20], [0, 20, 50]),
      boxMesh("tibia-shaft", "tibia", [-30, -20, -20], [0, 20, 10]),
    ];

    const result = buildReconstructedLigamentPayloads({
      channels: [femoral, tibial],
      procedureById: { "proc-all": "ALL" },
      anatomyMeshes,
      selectedChannelId: null,
    });
    const mesh = result.meshes[0];
    expect(mesh).toBeDefined();
    const ringCount = mesh.fiberPaths?.[0]?.length ?? 0;
    expect(Number.isInteger(ringCount)).toBe(true);
    const centers = Array.from({ length: ringCount }, (_, index) => ringCenter(mesh, index));
    const middleRingIndex = Math.floor(ringCount / 2);
    const middleRingRadii = ringRadii(mesh, middleRingIndex);
    const radius = middleRingRadii[0];
    expect(radius).toBeGreaterThan(2);
    expect(Math.max(...middleRingRadii) - Math.min(...middleRingRadii)).toBeLessThan(1e-4);
    const allRingRadii = Array.from({ length: ringCount }, (_, ringIndex) =>
      ringRadii(mesh, ringIndex),
    ).flat();
    expect(Math.max(...allRingRadii) - Math.min(...allRingRadii)).toBeLessThan(1e-5);
    const attachmentCapCenters = mesh.vertices.slice(-2);
    // The centerline stays one full graft radius outside the cortex while the
    // bone-facing point of each terminal ring is the exact anchor aperture.
    // This gives one constant-width tangent tube with no attachment collar.
    expect(Math.min(...mesh.vertices.map((point) => point[0]))).toBeGreaterThanOrEqual(-1e-8);
    expect(distance3ForTest(vector3(attachmentCapCenters[0]), [radius, 0, 30])).toBeLessThan(2e-5);
    expect(distance3ForTest(vector3(attachmentCapCenters[1]), [radius, 0, 0])).toBeLessThan(2e-5);
    const proximalInnerEdge = vector3(mesh.vertices[RADIAL_SEGMENTS / 2]);
    const distalInnerEdge = vector3(
      mesh.vertices[(ringCount - 1) * RADIAL_SEGMENTS + RADIAL_SEGMENTS / 2],
    );
    expect(distance3ForTest(proximalInnerEdge, femoral.aperture)).toBeLessThan(0.005);
    expect(distance3ForTest(distalInnerEdge, tibial.aperture)).toBeLessThan(0.005);
    Array.from({ length: ringCount }, (_, ringIndex) => {
      const ring = mesh.vertices.slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS);
      return Math.max(...ring.slice(0, RADIAL_SEGMENTS / 2).map((vertex, radialIndex) =>
        distance3ForTest(
          [vertex[0], vertex[1], vertex[2]],
          [
            ring[radialIndex + RADIAL_SEGMENTS / 2][0],
            ring[radialIndex + RADIAL_SEGMENTS / 2][1],
            ring[radialIndex + RADIAL_SEGMENTS / 2][2],
          ],
        ),
      ));
    }).forEach((diameter) => expect(diameter).toBeGreaterThanOrEqual(radius * 2 * 0.95));
    expect(mesh.fiberPaths?.every((path) => path.length === ringCount)).toBe(true);

    const chordLength = Math.hypot(
      centers.at(-1)![0] - centers[0][0],
      centers.at(-1)![1] - centers[0][1],
      centers.at(-1)![2] - centers[0][2],
    );
    const pathLength = centers.slice(1).reduce((sum, center, index) => sum + Math.hypot(
      center[0] - centers[index][0],
      center[1] - centers[index][1],
      center[2] - centers[index][2],
    ), 0);
    expect(pathLength / chordLength).toBeGreaterThanOrEqual(1 - 1e-8);
    expect(pathLength / chordLength).toBeLessThan(1.1);
    expect(Math.max(...centers.slice(1).map((center, index) => Math.hypot(
      center[0] - centers[index][0],
      center[1] - centers[index][1],
      center[2] - centers[index][2],
    )))).toBeLessThanOrEqual(0.7);
  });

  it("uses the same minimum-lift solver across procedures, knee scales, and patient-space translations", () => {
    const fixture = aclFixture();
    for (const [scale, translation] of [
      [0.78, [-36, 11, 7] as Vector3],
      [1, [0, 0, 0] as Vector3],
      [1.36, [52, -18, 13] as Vector3],
    ] as const) {
      const transformed = (point: Vector3): Vector3 => [
        translation[0] + point[0] * scale,
        translation[1] + point[1] * scale,
        translation[2] + point[2] * scale,
      ];
      const surfaceX = translation[0];
      const bulgeX = translation[0] + 3.5 * scale;
      const anatomyMeshes = [
        boxMesh("femur-shaft", "femur", transformed([-30, -20, 20]), transformed([0, 20, 50])),
        boxMesh("tibia-shaft", "tibia", transformed([-30, -20, -20]), transformed([0, 20, 10])),
        boxMesh("femur-bulge", "femur", transformed([-8, -8, 10]), transformed([3.5, 8, 21])),
      ];
      const outputs = (["MCL_POL_PMC", "ALL"] as const).map((procedure, procedureIndex) => {
        const procedureId = `scaled-${scale}-${procedure}`;
        const femoral = structuredClone(fixture.channels.find((channel) => channel.bone === "femur")!);
        const tibial = structuredClone(fixture.channels.find((channel) => channel.bone === "tibia")!);
        femoral.id = `${procedureId}-femur`;
        femoral.procedureId = procedureId;
        femoral.label = `${procedure} femur anchor`;
        femoral.geometryType = "anchor_pilot";
        tibial.id = `${procedureId}-tibia`;
        tibial.procedureId = procedureId;
        tibial.label = `${procedure} tibia anchor`;
        tibial.geometryType = "anchor_pilot";
        attachEntry(femoral, transformed([0, 0, 31]), [1, 0, 0]);
        attachEntry(tibial, transformed([0, 0, -1]), [1, 0, 0]);
        const output = buildReconstructedLigamentPayloads({
          channels: [femoral, tibial],
          procedureById: { [procedureId]: procedure },
          anatomyMeshes,
          selectedChannelId: procedureIndex === 0 ? femoral.id : null,
        });
        expect(output.grafts[0]).toMatchObject({ rendered: true, unavailableReason: null });
        return output.meshes[0];
      });

      // Procedure identity changes color/metadata only. The route itself is
      // derived from the transformed meshes and attachment geometry.
      expect(outputs[0].vertices).toEqual(outputs[1].vertices);
      expect(outputs[0].faces).toEqual(outputs[1].faces);
      const ringCount = outputs[0].fiberPaths?.[0]?.length ?? 0;
      const centers = Array.from({ length: ringCount }, (_, index) => ringCenter(outputs[0], index));
      const middleRingIndex = Math.floor(ringCount / 2);
      const middleRadius = ringRadii(outputs[0], middleRingIndex)[0];
      const middleInnerX = Math.min(...outputs[0].vertices
        .slice(middleRingIndex * RADIAL_SEGMENTS, (middleRingIndex + 1) * RADIAL_SEGMENTS)
        .map((vertex) => vertex[0]));
      expect(middleInnerX).toBeGreaterThanOrEqual(bulgeX - 0.91);
      expect(centers[0][0] - middleRadius).toBeCloseTo(surfaceX, 4);
      expect(centers.at(-1)![0] - middleRadius).toBeCloseTo(surfaceX, 4);
      const directions = centers.slice(1).map((center, index) => unitDirection(centers[index], center));
      const maximumTurnDegrees = Math.max(...directions.slice(1).map((direction, index) =>
        Math.acos(Math.max(-1, Math.min(1, dotForTest(directions[index], direction)))) * 180 / Math.PI));
      expect(maximumTurnDegrees).toBeLessThan(3);
    }
  });

  it("pairs double-bundle cruciate attachments by their explicit bundle roles", () => {
    const fixture = aclFixture();
    const femoral = fixture.channels.find((channel) => channel.bone === "femur")!;
    const tibial = fixture.channels.find((channel) => channel.bone === "tibia")!;
    const amFemoral = structuredClone(femoral);
    amFemoral.id = "acl-am-femoral";
    amFemoral.label = "ACL femur AM socket";
    attachEntry(amFemoral, [2, 1, 48]);
    const plFemoral = structuredClone(femoral);
    plFemoral.id = "acl-pl-femoral";
    plFemoral.label = "ACL femur PL socket";
    attachEntry(plFemoral, [5, 2, 46]);
    const amTibial = structuredClone(tibial);
    amTibial.id = "acl-am-tibial";
    amTibial.label = "ACL tibia AM socket";
    attachEntry(amTibial, [1, 5, 22]);
    const plTibial = structuredClone(tibial);
    plTibial.id = "acl-pl-tibial";
    plTibial.label = "ACL tibia PL socket";
    attachEntry(plTibial, [4, 6, 21]);

    const result = buildReconstructedLigamentPayloads({
      ...fixture,
      channels: [plTibial, amFemoral, amTibial, plFemoral],
      selectedChannelId: null,
    });

    expect(result.meshes.map((mesh) => mesh.id)).toEqual([
      "reconstructed-graft:proc-acl:am",
      "reconstructed-graft:proc-acl:pl",
    ]);
    expect(result.labels.map((label) => label.text)).toEqual([
      "ACL reconstructed graft · AM bundle",
      "ACL reconstructed graft · PL bundle",
    ]);
    expect(result.grafts.map((graft) => graft.bundleRole)).toEqual(["AM", "PL"]);
  });

  it("preserves PCL AL/PM identities when both bundles share one tibial fixation", () => {
    const plan = createSyntheticDemoCase();
    const femoral = structuredClone(plan.variants[0].channels.find((channel) => channel.id === "pcl-femoral")!);
    const tibial = structuredClone(plan.variants[0].channels.find((channel) => channel.id === "pcl-tibial")!);
    const alFemoral = structuredClone(femoral);
    alFemoral.id = "pcl-al-femoral";
    alFemoral.label = "PCL femur AL socket";
    const pmFemoral = structuredClone(femoral);
    pmFemoral.id = "pcl-pm-femoral";
    pmFemoral.label = "PCL femur PM socket";
    attachEntry(alFemoral);
    attachEntry(pmFemoral);
    attachEntry(tibial);

    const result = buildReconstructedLigamentPayloads({
      channels: [pmFemoral, tibial, alFemoral],
      procedureById: { "proc-pcl": "PCL" },
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
    });

    expect(result.grafts.map((graft) => ({
      bundleKey: graft.bundleKey,
      bundleRole: graft.bundleRole,
    }))).toEqual([
      { bundleKey: "bundle-1", bundleRole: "AL" },
      { bundleKey: "bundle-2", bundleRole: "PM" },
    ]);
  });

  it("does not invent a graft for a lone root/LET location or a stale surface attachment", () => {
    const plan = createSyntheticDemoCase();
    const rootChannels = plan.variants[0].channels
      .filter((channel) => channel.procedureId === "proc-root")
      .map((channel) => structuredClone(channel));
    rootChannels.forEach((channel) => attachEntry(channel));
    const rootResult = buildReconstructedLigamentPayloads({
      channels: rootChannels,
      procedureById: { "proc-root": "MEDIAL_ROOT" },
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
    });
    expect(rootResult.meshes).toHaveLength(0);

    const fixture = aclFixture();
    fixture.channels[0].aperture = [99, 99, 99];
    const staleResult = buildReconstructedLigamentPayloads({
      ...fixture,
      selectedChannelId: null,
    });
    expect(staleResult.meshes).toHaveLength(0);
  });

  it("allows a point-only PCL fixation endpoint only when it has a valid femoral pair", () => {
    const plan = createSyntheticDemoCase();
    const femoral = structuredClone(plan.variants[0].channels.find((channel) => channel.id === "pcl-femoral")!);
    const tibial = structuredClone(plan.variants[0].channels.find((channel) => channel.id === "pcl-tibial")!);
    tibial.geometryType = "onlay_no_large_tunnel";
    tibial.preparationMode = "none";
    tibial.noLargeTunnel = true;
    attachEntry(femoral);
    attachEntry(tibial);
    const paired = buildReconstructedLigamentPayloads({
      channels: [femoral, tibial],
      procedureById: { "proc-pcl": "PCL" },
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
    });
    const pointOnly = buildReconstructedLigamentPayloads({
      channels: [tibial],
      procedureById: { "proc-pcl": "PCL" },
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
    });

    expect(paired.meshes).toHaveLength(1);
    expect(paired.meshes[0].layer).toBe("grafts");
    expect(pointOnly.meshes).toHaveLength(0);
  });

  it("inherits procedure visibility from the Viewer scene", () => {
    const plan = createSyntheticDemoCase();
    const aclChannels = plan.variants[0].channels.filter((channel) => channel.procedureId === "proc-acl");
    const pclChannels = plan.variants[0].channels.filter((channel) => channel.procedureId === "proc-pcl");
    [...aclChannels, ...pclChannels].forEach((channel) => attachEntry(channel));
    const scene = buildViewerScene({
      revision: 20,
      channels: [...aclChannels, ...pclChannels],
      procedureById: { "proc-acl": "ACL", "proc-pcl": "PCL" },
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
      visibleProcedureIdentities: new Set(["ACL"]),
      layerVisibility: { grafts: true },
    }).scene;

    expect(scene.meshes.filter((mesh) => mesh.layer === "grafts").map((mesh) => mesh.id)).toEqual([
      "reconstructed-graft:proc-acl:single",
    ]);
    expect(scene.labels?.filter((label) => label.layer === "grafts")).toHaveLength(1);
  });

  it("generates only explicitly visible graft meshes while retaining every highlighted descriptor", () => {
    const plan = createSyntheticDemoCase();
    const channels = plan.variants[0].channels
      .filter((channel) => channel.procedureId === "proc-acl" || channel.procedureId === "proc-pcl")
      .map((channel) => structuredClone(channel));
    channels.forEach((channel) => attachEntry(channel));
    const options = {
      revision: 21,
      channels,
      procedureById: { "proc-acl": "ACL", "proc-pcl": "PCL" } as Record<string, ProcedureIdentity>,
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
      selectedChannelId: null,
      visibleProcedureIdentities: new Set<ProcedureIdentity>(["ACL", "PCL"]),
      layerVisibility: { grafts: true },
    };
    const all = buildViewerScene(options);
    const acl = all.grafts.find((graft) => graft.procedure === "ACL")!;
    const pcl = all.grafts.find((graft) => graft.procedure === "PCL")!;
    const pclMesh = all.scene.meshes.find((mesh) => mesh.id.startsWith("reconstructed-graft:proc-pcl"))!;
    const filtered = buildViewerScene({
      ...options,
      visibleGraftVisibilityKeys: new Set([pcl.visibilityKey]),
    });

    expect(filtered.grafts.map(({ id, visibilityKey }) => ({ id, visibilityKey })))
      .toEqual(all.grafts.map(({ id, visibilityKey }) => ({ id, visibilityKey })));
    expect(filtered.grafts.find((graft) => graft.id === acl.id)).toMatchObject({
      rendered: false,
      unavailableReason: null,
    });
    expect(filtered.scene.meshes.some((mesh) => mesh.id === acl.id)).toBe(false);
    expect(filtered.scene.labels?.some((label) => label.id === `${acl.id}:label`)).toBe(false);
    expect(filtered.scene.meshes.find((mesh) => mesh.id === pclMesh.id)?.vertices).toEqual(pclMesh.vertices);
  });
});
