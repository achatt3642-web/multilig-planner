import { describe, expect, it } from "vitest";
import { anchorTrajectoryRodEnd, buildSyntheticAnatomyMeshes } from "../app/channelGeometry";
import { createSyntheticDemoCase } from "../app/caseFactory";
import type { ChannelPlan, Vector3 } from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import {
  channelStartPointPatientRas,
  deriveAnatomicReferenceFrame,
  measureChannelStartPoint,
  measureChannelTrajectoryAngles,
} from "./anatomicReferencePlanes";

const dot = (a: Vector3, b: Vector3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract = (a: Vector3, b: Vector3): Vector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (value: Vector3, factor: number): Vector3 => [
  value[0] * factor,
  value[1] * factor,
  value[2] * factor,
];
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalized = (value: Vector3): Vector3 => {
  const length = Math.hypot(...value);
  return [value[0] / length, value[1] / length, value[2] / length];
};

function signedDistance(point: Vector3, origin: Vector3, normal: Vector3): number {
  return dot(subtract(point, origin), normal);
}

function pointAtFrameOffsets(
  origin: Vector3,
  jointLineNormal: Vector3,
  midlineNormal: Vector3,
  posteriorCondylarNormal: Vector3,
  jointLineMm: number,
  midlineMm: number,
  posteriorCondylarMm: number,
): Vector3 {
  return add(
    add(
      add(origin, scale(jointLineNormal, jointLineMm)),
      scale(midlineNormal, midlineMm),
    ),
    scale(posteriorCondylarNormal, posteriorCondylarMm),
  );
}

function translatedMeshes(meshes: ViewerMeshPayload[], delta: Vector3): ViewerMeshPayload[] {
  return meshes.map((mesh) => ({
    ...mesh,
    id: `${mesh.id}-translated`,
    vertices: mesh.vertices.map((point) => [
      point[0] + delta[0],
      point[1] + delta[1],
      point[2] + delta[2],
    ]),
  }));
}

function translatedBoneMeshes(
  meshes: ViewerMeshPayload[],
  bone: "femur" | "tibia",
  delta: Vector3,
): ViewerMeshPayload[] {
  return meshes.map((mesh) => mesh.anatomyBone === bone
    ? {
        ...mesh,
        vertices: mesh.vertices.map((point) => [
          point[0] + delta[0],
          point[1] + delta[1],
          point[2] + delta[2],
        ]),
      }
    : mesh);
}

function mirroredLeftMeshes(meshes: ViewerMeshPayload[]): ViewerMeshPayload[] {
  return meshes.map((mesh) => ({
    ...mesh,
    id: `${mesh.id}-mirrored-left`,
    vertices: mesh.vertices.map((point) => [-point[0], point[1], point[2]]),
    faces: mesh.faces.map((face) => [...face].reverse()),
  }));
}

function channelAt(point: Vector3): ChannelPlan {
  const channel = structuredClone(createSyntheticDemoCase().variants[0].channels[0]);
  channel.bone = "tibia";
  channel.aperture = point;
  channel.apertureSurfaceAttachment = null;
  channel.trajectoryControlMode = "outer_cortex_surface";
  channel.endpointSurfaceAttachment = {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone: "tibia",
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId: "tibia-plateau",
    requestedPointPatientRasMm: point,
    attachedPointPatientRasMm: point,
    distanceFromRequestedPointMm: 0,
    triangleStableId: "triangle:1",
    faceStableId: "face:1",
    faceIndex: 1,
    vertexIndices: [0, 1, 2],
    vertexStableIds: ["v0", "v1", "v2"],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [0, 0, 1],
    reviewState: "surface_review_not_evaluated",
  };
  return channel;
}

describe("derived knee anatomic reference planes", () => {
  it("derives the joint plane from three explicit tibial surface points", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;

    expect(frame.algorithmVersion).toBe("4");
    expect(frame.jointLineDefinition).toMatchObject({
      method: "three_tibial_plateau_fourth_points",
      ruleVersion: "1",
      medialLateralAssignment: "verified_laterality",
      lateralityUsed: "right",
    });
    const definition = frame.jointLineDefinition;
    const landmarks = [
      definition.lateralSuperiorPointPatientRasMm,
      definition.medialSuperiorPointPatientRasMm,
      definition.medialPosteriorSuperiorPointPatientRasMm,
    ];
    landmarks.forEach((point) => {
      expect(Math.abs(signedDistance(
        point,
        frame.jointLine.originPatientRasMm,
        frame.jointLine.normalPatientRas,
      ))).toBeLessThan(1e-6);
    });
    expect(definition.lateralSuperiorPointPatientRasMm[0]).toBeGreaterThanOrEqual(
      definition.lateralFourthMinimumLateralProjectionMm,
    );
    expect(definition.medialSuperiorPointPatientRasMm[0]).toBeLessThanOrEqual(
      definition.medialFourthMaximumLateralProjectionMm,
    );
    expect(definition.medialPosteriorSuperiorPointPatientRasMm[0]).toBeLessThanOrEqual(
      definition.medialFourthMaximumLateralProjectionMm,
    );
    expect(definition.lateralSuperiorPointPatientRasMm[0]).toBeGreaterThan(
      definition.lateralTibialSpinePointPatientRasMm[0],
    );
    expect(definition.medialSuperiorPointPatientRasMm[2]).toBeGreaterThanOrEqual(
      definition.medialFourthSuperiorCapMinimumZPatientRasMm,
    );
    expect(definition.medialPosteriorSuperiorPointPatientRasMm[2]).toBeGreaterThanOrEqual(
      definition.medialFourthSuperiorCapMinimumZPatientRasMm,
    );
    expect(definition.medialLandmarkSeparationMm).toBeGreaterThanOrEqual(
      definition.minimumMedialLandmarkSeparationMm,
    );
    expect(definition.medialPosteriorOffsetMm).toBeGreaterThanOrEqual(
      definition.minimumMedialPosteriorOffsetMm,
    );
    expect(definition.triangleSine).toBeGreaterThanOrEqual(definition.minimumTriangleSine);

    const expectedJointNormal = normalized(cross(
      subtract(
        definition.lateralSuperiorPointPatientRasMm,
        definition.medialSuperiorPointPatientRasMm,
      ),
      subtract(
        definition.medialPosteriorSuperiorPointPatientRasMm,
        definition.medialSuperiorPointPatientRasMm,
      ),
    ));
    const expectedSuperiorNormal = expectedJointNormal[2] < 0
      ? scale(expectedJointNormal, -1)
      : expectedJointNormal;
    frame.jointLine.normalPatientRas.forEach((component, index) => {
      expect(component).toBeCloseTo(expectedSuperiorNormal[index], 8);
    });
    expect(frame.jointLine.normalPatientRas[2]).toBeGreaterThan(0);

    expect(Math.abs(dot(frame.jointLine.normalPatientRas, frame.posteriorCondylar.normalPatientRas))).toBeLessThan(1e-6);
    expect(Math.abs(dot(frame.jointLine.normalPatientRas, frame.midline.normalPatientRas))).toBeLessThan(1e-6);
    expect(Math.abs(dot(frame.posteriorCondylar.normalPatientRas, frame.midline.normalPatientRas))).toBeLessThan(1e-6);
    expect(dot(frame.posteriorCondylar.normalPatientRas, [0, 1, 0])).toBeGreaterThan(0);
    expect(dot(frame.midline.normalPatientRas, [1, 0, 0])).toBeGreaterThan(0);

    for (const endpoint of [
      frame.posteriorCondylarLine.endpointAPatientRasMm,
      frame.posteriorCondylarLine.endpointBPatientRasMm,
    ]) {
      expect(Math.abs(signedDistance(
        endpoint,
        frame.posteriorCondylar.originPatientRasMm,
        frame.posteriorCondylar.normalPatientRas,
      ))).toBeLessThan(1e-6);
    }
  });

  it("does not let a femur-only displacement alter the tibial three-point joint plane", () => {
    const meshes = buildSyntheticAnatomyMeshes();
    const original = deriveAnatomicReferenceFrame(meshes, {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const shiftedFemur = deriveAnatomicReferenceFrame(
      translatedBoneMeshes(meshes, "femur", [0, 0, 8]),
      {
        laterality: "right",
        lateralityVerified: true,
        scaleVerified: true,
      },
    );
    expect(original.evaluationState).toBe("evaluated");
    expect(shiftedFemur.evaluationState).toBe("evaluated");
    if (original.evaluationState !== "evaluated" || shiftedFemur.evaluationState !== "evaluated") return;

    expect(shiftedFemur.jointLineDefinition).toEqual(original.jointLineDefinition);
    shiftedFemur.jointLine.normalPatientRas.forEach((component, index) => {
      expect(component).toBeCloseTo(original.jointLine.normalPatientRas[index], 10);
    });
    shiftedFemur.jointLine.originPatientRasMm.forEach((component, index) => {
      expect(component).toBeCloseTo(original.jointLine.originPatientRasMm[index], 10);
    });
  });

  it("reports superior, lateral, and anterior signed distances", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;
    const point = pointAtFrameOffsets(
      frame.jointLine.originPatientRasMm,
      frame.jointLine.normalPatientRas,
      frame.midline.normalPatientRas,
      frame.posteriorCondylar.normalPatientRas,
      5,
      6,
      7,
    );
    const baseline = measureChannelStartPoint(
      channelAt(frame.jointLine.originPatientRasMm),
      frame,
    );
    const measurement = measureChannelStartPoint(channelAt(point), frame);
    expect(measurement.evaluationState).toBe("evaluated");
    expect(measurement.jointLineSignedMm).toBeCloseTo(5, 6);
    expect(measurement.midlineSignedMm).toBeCloseTo(baseline.midlineSignedMm! + 6, 6);
    expect(measurement.posteriorCondylarSignedMm).toBeCloseTo(
      baseline.posteriorCondylarSignedMm! + 7,
      6,
    );
    expect(measurement.provisional).toBe(false);
  });

  it("reports acute projected trajectory angles against the knee frame", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;

    const direction = add(
      add(
        scale(frame.midline.normalPatientRas, 2),
        scale(frame.posteriorCondylar.normalPatientRas, 3),
      ),
      scale(frame.jointLine.normalPatientRas, 4),
    );
    const channel = channelAt(frame.jointLine.originPatientRasMm);
    channel.vector = direction;
    channel.depthMm = 30;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: null, depthMm: null };
    const measurement = measureChannelTrajectoryAngles(channel, frame);

    expect(measurement).toMatchObject({
      evaluationState: "evaluated",
      provisional: false,
    });
    expect(measurement.sagittalToTibialPlateauDeg).toBeCloseTo(53.130102, 5);
    expect(measurement.coronalToTibialPlateauDeg).toBeCloseTo(63.434949, 5);
    expect(measurement.axialToPosteriorCondylarDeg).toBeCloseTo(56.309932, 5);

    channel.vector = scale(direction, -1);
    const reversed = measureChannelTrajectoryAngles(channel, frame);
    expect(reversed.sagittalToTibialPlateauDeg).toBeCloseTo(
      measurement.sagittalToTibialPlateauDeg!,
      10,
    );
    expect(reversed.coronalToTibialPlateauDeg).toBeCloseTo(
      measurement.coronalToTibialPlateauDeg!,
      10,
    );
    expect(reversed.axialToPosteriorCondylarDeg).toBeCloseTo(
      measurement.axialToPosteriorCondylarDeg!,
      10,
    );
  });

  it("uses 90 degrees for a sagittal trajectory perpendicular to the tibial plateau", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;
    const channel = channelAt(frame.jointLine.originPatientRasMm);
    channel.depthMm = 30;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: null, depthMm: null };

    channel.vector = frame.posteriorCondylar.normalPatientRas;
    const plateauParallel = measureChannelTrajectoryAngles(channel, frame);
    expect(plateauParallel.sagittalToTibialPlateauDeg).toBeCloseTo(0, 10);
    expect(plateauParallel.coronalToTibialPlateauDeg).toBeNull();
    expect(plateauParallel.axialToPosteriorCondylarDeg).toBeCloseTo(90, 10);

    channel.vector = frame.jointLine.normalPatientRas;
    const plateauPerpendicular = measureChannelTrajectoryAngles(channel, frame);
    expect(plateauPerpendicular.sagittalToTibialPlateauDeg).toBeCloseTo(90, 10);
    expect(plateauPerpendicular.coronalToTibialPlateauDeg).toBeCloseTo(90, 10);
    expect(plateauPerpendicular.axialToPosteriorCondylarDeg).toBeNull();
  });

  it("does not invent a trajectory for point-only fixation or invalid geometry", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const pointOnly = channelAt([2, 3, 4]);
    pointOnly.noLargeTunnel = true;
    pointOnly.geometryType = "onlay_no_large_tunnel";
    pointOnly.trajectoryControlMode = "none";
    expect(measureChannelTrajectoryAngles(pointOnly, frame)).toMatchObject({
      evaluationState: "not_evaluated",
      sagittalToTibialPlateauDeg: null,
      reason: expect.stringContaining("no drilled trajectory"),
    });

    const invalid = channelAt([2, 3, 4]);
    invalid.vector = [0, 0, 0];
    invalid.depthMm = 30;
    invalid.instrumentChain.depthOrFullTunnelSetting = { mode: null, depthMm: null };
    expect(measureChannelTrajectoryAngles(invalid, frame)).toMatchObject({
      evaluationState: "not_evaluated",
      reason: expect.stringContaining("no finite rendered trajectory"),
    });
  });

  it("orients a mirrored left-knee midline toward its declared lateral side", () => {
    const meshes = buildSyntheticAnatomyMeshes();
    const right = deriveAnatomicReferenceFrame(meshes, {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const left = deriveAnatomicReferenceFrame(mirroredLeftMeshes(meshes), {
      laterality: "left",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(right.evaluationState).toBe("evaluated");
    expect(left.evaluationState).toBe("evaluated");
    if (right.evaluationState !== "evaluated" || left.evaluationState !== "evaluated") return;
    expect(right.jointLineDefinition.lateralityUsed).toBe("right");
    expect(left.jointLineDefinition.lateralityUsed).toBe("left");
    for (const [rightPoint, leftPoint] of [
      [
        right.jointLineDefinition.lateralSuperiorPointPatientRasMm,
        left.jointLineDefinition.lateralSuperiorPointPatientRasMm,
      ],
      [
        right.jointLineDefinition.medialSuperiorPointPatientRasMm,
        left.jointLineDefinition.medialSuperiorPointPatientRasMm,
      ],
      [
        right.jointLineDefinition.medialPosteriorSuperiorPointPatientRasMm,
        left.jointLineDefinition.medialPosteriorSuperiorPointPatientRasMm,
      ],
      [
        right.jointLineDefinition.lateralTibialSpinePointPatientRasMm,
        left.jointLineDefinition.lateralTibialSpinePointPatientRasMm,
      ],
    ] as const) {
      expect(leftPoint[0]).toBeCloseTo(-rightPoint[0], 10);
      expect(leftPoint[1]).toBeCloseTo(rightPoint[1], 10);
      expect(leftPoint[2]).toBeCloseTo(rightPoint[2], 10);
    }
    expect(dot(right.midline.normalPatientRas, [1, 0, 0])).toBeGreaterThan(0);
    expect(dot(left.midline.normalPatientRas, [-1, 0, 0])).toBeGreaterThan(0);

    const rightMeasurement = measureChannelStartPoint(channelAt([6, -8, 32]), right);
    const leftMeasurement = measureChannelStartPoint(channelAt([-6, -8, 32]), left);
    expect(leftMeasurement.midlineSignedMm).toBeCloseTo(rightMeasurement.midlineSignedMm!, 6);
    expect(leftMeasurement.jointLineSignedMm).toBeCloseTo(rightMeasurement.jointLineSignedMm!, 6);
    expect(leftMeasurement.posteriorCondylarSignedMm).toBeCloseTo(rightMeasurement.posteriorCondylarSignedMm!, 6);
  });

  it("keeps distances invariant under patient-space translation", () => {
    const meshes = buildSyntheticAnatomyMeshes();
    const delta: Vector3 = [72, -31, 18];
    const original = deriveAnatomicReferenceFrame(meshes, {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const translated = deriveAnatomicReferenceFrame(translatedMeshes(meshes, delta), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const originalMeasurement = measureChannelStartPoint(channelAt([6, -8, 32]), original);
    const translatedMeasurement = measureChannelStartPoint(channelAt([
      6 + delta[0],
      -8 + delta[1],
      32 + delta[2],
    ]), translated);
    expect(translatedMeasurement.jointLineSignedMm).toBeCloseTo(originalMeasurement.jointLineSignedMm!, 5);
    expect(translatedMeasurement.midlineSignedMm).toBeCloseTo(originalMeasurement.midlineSignedMm!, 5);
    expect(translatedMeasurement.posteriorCondylarSignedMm).toBeCloseTo(originalMeasurement.posteriorCondylarSignedMm!, 5);
  });

  it("measures the outer-cortex Start attachment and never substitutes Entry", () => {
    const channel = channelAt([2, 3, 4]);
    channel.trajectoryControlMode = "outer_cortex_surface";
    channel.vector = [0, 0, -1];
    channel.apertureSurfaceAttachment = {
      coordinateSpace: "patient_ras",
      units: "mm",
      bone: "tibia",
      targetKind: "whole_bone_surface",
      targetRegionId: null,
      meshId: "tibia-surface",
      requestedPointPatientRasMm: [2, 3, 4],
      attachedPointPatientRasMm: [2.5, 3.5, 4.5],
      distanceFromRequestedPointMm: Math.sqrt(0.75),
      triangleStableId: "triangle:1",
      faceStableId: "face:1",
      faceIndex: 1,
      vertexIndices: [0, 1, 2],
      vertexStableIds: ["v0", "v1", "v2"],
      barycentric: [1, 0, 0],
      surfaceNormalPatientRas: [0, 0, 1],
      reviewState: "surface_review_not_evaluated",
    };
    channel.endpointSurfaceAttachment = {
      ...channel.apertureSurfaceAttachment,
      meshId: "tibia-extra-articular-start",
      requestedPointPatientRasMm: [40, 50, 60],
      attachedPointPatientRasMm: [40, 50, 60],
    };
    expect(channelStartPointPatientRas(channel)).toEqual({
      point: [40, 50, 60],
      source: "outer_cortex_surface_attachment",
    });
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const measurement = measureChannelStartPoint(channel, frame);
    expect(measurement.pointPatientRasMm).toEqual([40, 50, 60]);
    expect(measurement.pointPatientRasMm).not.toEqual([2.5, 3.5, 4.5]);
  });

  it("measures the bony aperture for an anchor Start and not its trajectory handle", () => {
    const channel = channelAt([2, 3, 4]);
    channel.geometryType = "anchor_pilot";
    channel.trajectoryControlMode = "exterior_rod";
    channel.vector = [0, 0, -1];
    channel.apertureSurfaceAttachment = {
      ...channel.endpointSurfaceAttachment!,
      requestedPointPatientRasMm: [2, 3, 4],
      attachedPointPatientRasMm: [2, 3, 4],
    };
    const meshes = buildSyntheticAnatomyMeshes();
    expect(channelStartPointPatientRas(channel, meshes)).toEqual({
      point: [2, 3, 4],
      source: "anchor_aperture_surface_attachment",
    });
    expect(anchorTrajectoryRodEnd(channel)).toEqual([2, 3, 32]);
    const frame = deriveAnatomicReferenceFrame(meshes, {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(measureChannelStartPoint(channel, frame, meshes).pointPatientRasMm).toEqual([2, 3, 4]);
  });

  it("fails closed for a stale or drifting anchor surface attachment", () => {
    const channel = channelAt([2, 3, 4]);
    channel.geometryType = "anchor_pilot";
    channel.trajectoryControlMode = "exterior_rod";
    channel.apertureSurfaceAttachment = {
      ...channel.endpointSurfaceAttachment!,
      requestedPointPatientRasMm: [2, 3, 4],
      attachedPointPatientRasMm: [2, 3, 4],
    };
    const meshes = buildSyntheticAnatomyMeshes();

    const staleMesh = structuredClone(channel);
    staleMesh.apertureSurfaceAttachment!.meshId = "prior-knee-tibia";
    expect(channelStartPointPatientRas(staleMesh, meshes)).toBeNull();

    const driftingAttachment = structuredClone(channel);
    driftingAttachment.apertureSurfaceAttachment!.attachedPointPatientRasMm = [2, 3, 5];
    expect(channelStartPointPatientRas(driftingAttachment, meshes)).toBeNull();

    const wrongBone = structuredClone(channel);
    wrongBone.apertureSurfaceAttachment!.bone = "femur";
    expect(channelStartPointPatientRas(wrongBone, meshes)).toBeNull();
  });

  it("measures the exact analytic blind-socket tip used by the Viewer Start handle", () => {
    const channel = channelAt([2, 3, 4]);
    channel.geometryType = "retrograde_socket";
    channel.trajectoryControlMode = "blind_socket_tip";
    channel.vector = [0, 0, -1];
    channel.depthMm = 18;
    expect(channelStartPointPatientRas(channel)).toEqual({
      point: [2, 3, -14],
      source: "blind_socket_tip",
    });
  });

  it("fails closed when a point-only channel has no rendered Start handle", () => {
    const channel = channelAt([2, 3, 4]);
    channel.geometryType = "onlay_no_large_tunnel";
    channel.noLargeTunnel = true;
    channel.trajectoryControlMode = "none";
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(channelStartPointPatientRas(channel)).toBeNull();
    expect(measureChannelStartPoint(channel, frame)).toMatchObject({
      evaluationState: "not_evaluated",
      pointPatientRasMm: null,
      reason: expect.stringContaining("no finite rendered Start point"),
    });
  });

  it("fails closed when either required bone mesh is absent", () => {
    const onlyTibia = buildSyntheticAnatomyMeshes().filter((mesh) => mesh.anatomyBone === "tibia");
    const frame = deriveAnatomicReferenceFrame(onlyTibia, {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame).toMatchObject({
      evaluationState: "not_evaluated",
      reason: expect.stringContaining("Both femur and tibia"),
    });
  });

  it("does not report a fibular fallback coordinate against femur/tibia reference planes", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    const channel = channelAt([23, 2, 18]);
    channel.bone = "fibula";
    const measurement = measureChannelStartPoint(channel, frame);
    expect(measurement).toMatchObject({
      evaluationState: "not_evaluated",
      jointLineSignedMm: null,
      midlineSignedMm: null,
      posteriorCondylarSignedMm: null,
      reason: expect.stringContaining("femur and tibia"),
    });
  });

  it("keeps midline direction unasserted until laterality is verified", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: false,
      scaleVerified: false,
    });
    const measurement = measureChannelStartPoint(channelAt([6, -8, 32]), frame);
    expect(measurement.evaluationState).toBe("evaluated");
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;
    expect(frame.jointLineDefinition).toMatchObject({
      medialLateralAssignment: "provisional_patient_right_is_lateral",
      lateralityUsed: "right",
    });
    expect(measurement.midlineSignedMm).toBeNull();
    expect(measurement.midlineUnsignedMm).toBeGreaterThan(0);
    expect(measurement.provisional).toBe(true);
  });
});
