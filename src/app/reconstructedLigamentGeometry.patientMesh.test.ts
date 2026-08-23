import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChannelPlan, ProcedureIdentity, Vector3 } from "../domain/types";
import {
  closestMeshSurfaceContact,
  meshPointContainment,
} from "../geometry/surfaceClearance";
import type { ViewerMeshPayload } from "../viewer/types";
import { createSyntheticDemoCase } from "./caseFactory";
import {
  anatomicChannelSurfaceSeed,
  createAnatomicChannelSeedContext,
} from "./anatomicChannelSurfaceSeed";
import { initializePendingChannelSurfacePlacements } from "./channelSurfaceInitialization";
import { buildReconstructedLigamentPayloads } from "./reconstructedLigamentGeometry";

const femurPath = process.env.MULTILIG_FEMUR_MESH;
const tibiaPath = process.env.MULTILIG_TIBIA_MESH;
const patientIt = femurPath && tibiaPath ? it : it.skip;
const RADIAL_SEGMENTS = 36;

interface StoredViewerMesh {
  bone: "femur" | "tibia";
  vertices: number[][];
  faces: number[][];
}

function loadMesh(path: string, id: string, bone: "femur" | "tibia"): ViewerMeshPayload {
  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredViewerMesh;
  if (stored.bone !== bone) throw new Error(`Expected ${bone} mesh at ${path}`);
  return {
    id,
    name: `${bone} patient regression mesh`,
    vertices: stored.vertices,
    faces: stored.faces,
    color: "#ccd6d8",
    opacity: 0.22,
    layer: "bones",
    anatomyBone: bone,
  };
}

function attachedChannel(options: {
  template: ChannelPlan;
  id: string;
  procedureId: string;
  label: string;
  bone: "femur" | "tibia";
  point: Vector3;
  normal: Vector3;
  meshId: string;
  faceIndex: number;
}): ChannelPlan {
  const channel = structuredClone(options.template);
  channel.id = options.id;
  channel.procedureId = options.procedureId;
  channel.label = options.label;
  channel.bone = options.bone;
  channel.geometryType = "anchor_pilot";
  channel.diameterMm = 2.6;
  channel.crossSection = { kind: "circle", diameterMm: 2.6 };
  channel.aperture = [...options.point];
  channel.centerline = {
    kind: "rigid",
    aperturePatientRasMm: [...options.point],
    directionPatientRas: [...channel.vector],
  };
  channel.apertureSurfaceAttachment = {
    coordinateSpace: "patient_ras",
    units: "mm",
    bone: options.bone,
    targetKind: "whole_bone_surface",
    targetRegionId: null,
    meshId: options.meshId,
    requestedPointPatientRasMm: [...options.point],
    attachedPointPatientRasMm: [...options.point],
    distanceFromRequestedPointMm: 0,
    triangleStableId: `${options.meshId}:face:${options.faceIndex}`,
    faceStableId: `${options.meshId}:face:${options.faceIndex}`,
    faceIndex: options.faceIndex,
    vertexIndices: [0, 1, 2],
    vertexStableIds: [
      `${options.meshId}:vertex:0`,
      `${options.meshId}:vertex:1`,
      `${options.meshId}:vertex:2`,
    ],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [...options.normal],
    reviewState: "surface_review_not_evaluated",
  };
  return channel;
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(value: Vector3): Vector3 {
  const length = Math.hypot(...value);
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distanceFromLine(point: Vector3, start: Vector3, end: Vector3): number {
  const direction = normalize(subtract(end, start));
  const offset = subtract(point, start);
  const projection = dot(offset, direction);
  return Math.hypot(
    offset[0] - direction[0] * projection,
    offset[1] - direction[1] * projection,
    offset[2] - direction[2] * projection,
  );
}

function pointStaysWithinDisplayOverlap(
  point: Vector3,
  bone: ViewerMeshPayload,
  toleranceMm: number,
): boolean {
  const contact = closestMeshSurfaceContact({ x: point[0], y: point[1], z: point[2] }, bone);
  if (!contact) return true;
  const containment = meshPointContainment({ x: point[0], y: point[1], z: point[2] }, bone);
  return containment !== "inside" || contact.distanceMm <= toleranceMm + 1e-6;
}

describe("current de-identified MRI graft-volume regression", () => {
  patientIt("seeds medial, lateral, and cruciate femoral locations on the correct MRI-mask side", () => {
    const femur = loadMesh(femurPath!, "patient-femur", "femur");
    const tibia = loadMesh(tibiaPath!, "patient-tibia", "tibia");
    const plan = {
      ...createSyntheticDemoCase(),
      laterality: "right" as const,
      lateralityVerified: true,
    };
    const context = createAnatomicChannelSeedContext(plan, [femur, tibia]);
    expect(context).not.toBeNull();
    if (!context) return;
    const lateralAxis = context.frame.midline.normalPatientRas;
    const midlineOrigin = context.frame.midline.originPatientRasMm;
    const template = plan.variants[0].channels.find((channel) => channel.bone === "femur")!;
    const lateralOffset = (point: Vector3): number => dot(
      subtract(point, midlineOrigin),
      lateralAxis,
    );
    const seedFor = (procedure: ProcedureIdentity) => {
      const channel: ChannelPlan = {
        ...structuredClone(template),
        id: `patient-seed-${procedure}`,
        semanticKey: "femur-single-1",
        label: `${procedure} femur seed`,
        aperture: [0, 0, 0],
        vector: [0, 0, 1],
        surfacePlacement: {
          state: "pending_default",
          method: "preset_seed_unregistered",
          meshIds: [],
          endpointMethod: "not_available",
        },
      };
      const seed = anatomicChannelSurfaceSeed(context, channel, procedure);
      expect(seed, procedure).not.toBeNull();
      return seed!;
    };

    const acl = seedFor("ACL");
    const pcl = seedFor("PCL");
    const plc = seedFor("PLC_FCL");
    const all = seedFor("ALL");
    const letSeed = seedFor("LET");
    const mcl = seedFor("MCL_POL_PMC");
    expect(lateralOffset(acl.requestedPointPatientRasMm)).toBeGreaterThan(0);
    expect(lateralOffset(pcl.requestedPointPatientRasMm)).toBeLessThan(0);
    expect(lateralOffset(plc.requestedPointPatientRasMm)).toBeGreaterThan(0);
    expect(lateralOffset(all.requestedPointPatientRasMm)).toBeGreaterThan(0);
    expect(lateralOffset(letSeed.requestedPointPatientRasMm)).toBeGreaterThan(0);
    expect(lateralOffset(mcl.requestedPointPatientRasMm)).toBeLessThan(0);
    expect(dot(acl.preferredDirectionPatientRas, lateralAxis)).toBeGreaterThan(0.99);
    expect(dot(pcl.preferredDirectionPatientRas, lateralAxis)).toBeLessThan(-0.99);
  }, 30_000);

  patientIt("keeps a new PLC tibial LaPrade Start on the lateral side of the MRI mask", () => {
    const femur = loadMesh(femurPath!, "patient-femur", "femur");
    const tibia = loadMesh(tibiaPath!, "patient-tibia", "tibia");
    const base = createSyntheticDemoCase();
    const plcProcedure = structuredClone(base.procedures[0]);
    plcProcedure.id = "patient-plc-procedure";
    plcProcedure.structure = "PLC_FCL";
    plcProcedure.constructs = [];
    const template = structuredClone(base.variants[0].channels.find((channel) => channel.bone === "tibia")!);
    const plcTibia: ChannelPlan = {
      ...template,
      id: "patient-plc-tibia",
      procedureId: plcProcedure.id,
      semanticKey: "tibia-laprade_full_tunnel",
      label: "PLC tibial LaPrade-style full tunnel",
      bone: "tibia",
      geometryType: "round_full_tunnel",
      trajectoryControlMode: "outer_cortex_surface",
      aperture: [0, 0, 0],
      vector: [0, 0, 1],
      fullThickness: true,
      depthMm: 45,
      apertureSurfaceAttachment: null,
      endpointSurfaceAttachment: null,
      surfacePlacement: {
        state: "pending_default",
        method: "preset_seed_unregistered",
        meshIds: [],
        endpointMethod: "not_available",
      },
    };
    const plan = {
      ...base,
      laterality: "right" as const,
      lateralityVerified: true,
      procedures: [plcProcedure],
      variants: [{ ...base.variants[0], channels: [plcTibia] }],
    };
    const initialized = initializePendingChannelSurfacePlacements(plan, [femur, tibia])
      .variants[0].channels[0];
    const frame = createAnatomicChannelSeedContext(plan, [femur, tibia])!.frame;
    const lateralOffset = (point: Vector3): number => dot(
      subtract(point, frame.midline.originPatientRasMm),
      frame.midline.normalPatientRas,
    );

    expect(lateralOffset(initialized.aperture)).toBeGreaterThan(0);
    expect(initialized.endpointSurfaceAttachment).not.toBeNull();
    expect(lateralOffset(initialized.endpointSurfaceAttachment!.attachedPointPatientRasMm)).toBeGreaterThan(0);
  }, 30_000);

  patientIt("keeps MCL and ALL taut, cylindrical, and within the display-mask overlap tolerance", () => {
    const femur = loadMesh(femurPath!, "patient-femur", "femur");
    const tibia = loadMesh(tibiaPath!, "patient-tibia", "tibia");
    const plan = createSyntheticDemoCase();
    const femurTemplate = plan.variants[0].channels.find((channel) => channel.bone === "femur")!;
    const tibiaTemplate = plan.variants[0].channels.find((channel) => channel.bone === "tibia")!;
    const channels = [
      attachedChannel({
        template: femurTemplate,
        id: "patient-mcl-femur",
        procedureId: "patient-mcl",
        label: "MCL femur anchor",
        bone: "femur",
        point: [22.3638186462, 10.1601267339, 5.4856181506],
        normal: [-0.990268021, 0.1391734405, 0],
        meshId: femur.id,
        faceIndex: 278,
      }),
      attachedChannel({
        template: tibiaTemplate,
        id: "patient-mcl-tibia",
        procedureId: "patient-mcl",
        label: "MCL tibia anchor",
        bone: "tibia",
        point: [31.8397000963, 2.0432878707, -48.5029961872],
        normal: [-0.2498826579, 0.7051776686, -0.6635383282],
        meshId: tibia.id,
        faceIndex: 3207,
      }),
      attachedChannel({
        template: femurTemplate,
        id: "patient-all-femur",
        procedureId: "patient-all",
        label: "ALL femur anchor",
        bone: "femur",
        point: [97.9854438334, -9.829969269, 0.8202335356],
        normal: [0.2498828065, -0.7051777719, -0.6635381624],
        meshId: femur.id,
        faceIndex: 30451,
      }),
      attachedChannel({
        template: tibiaTemplate,
        id: "patient-all-tibia",
        procedureId: "patient-all",
        label: "ALL tibia anchor",
        bone: "tibia",
        point: [98.2237180482, 9.2378056674, -46.1834073707],
        normal: [0.9902681559, -0.1391724809, 0],
        meshId: tibia.id,
        faceIndex: 41522,
      }),
    ];
    const procedureById: Record<string, ProcedureIdentity> = {
      "patient-mcl": "MCL_POL_PMC",
      "patient-all": "ALL",
    };
    const result = buildReconstructedLigamentPayloads({
      channels,
      procedureById,
      anatomyMeshes: [femur, tibia],
      selectedChannelId: null,
    });

    expect(result.meshes.map((mesh) => mesh.id).sort()).toEqual([
      "reconstructed-graft:patient-all:single",
      "reconstructed-graft:patient-mcl:single",
    ]);
    for (const mesh of result.meshes) {
      const ringCount = mesh.fiberPaths?.[0]?.length ?? 0;
      expect(ringCount).toBeGreaterThan(100);
      const pair = mesh.id.includes("patient-mcl") ? channels.slice(0, 2) : channels.slice(2, 4);
      const innerEdge = Array.from({ length: ringCount }, (_, ringIndex): Vector3 => {
        const point = mesh.vertices[ringIndex * RADIAL_SEGMENTS + RADIAL_SEGMENTS / 2];
        return [point[0], point[1], point[2]];
      });
      expect(distance(innerEdge[0], pair[0].aperture)).toBeLessThan(1e-5);
      expect(distance(innerEdge.at(-1)!, pair[1].aperture)).toBeLessThan(1e-5);

      const capCenters = mesh.vertices.slice(-2).map((point): Vector3 => [point[0], point[1], point[2]]);
      const radius = distance(capCenters[0], pair[0].aperture);
      [pair[0], pair[1]].forEach((endpoint, index) => {
        const normal = normalize(endpoint.apertureSurfaceAttachment!.surfaceNormalPatientRas);
        const expectedCenter: Vector3 = [
          endpoint.aperture[0] + normal[0] * radius,
          endpoint.aperture[1] + normal[1] * radius,
          endpoint.aperture[2] + normal[2] * radius,
        ];
        expect(distance(capCenters[index], expectedCenter)).toBeLessThan(1e-5);
      });

      const ringCenters = Array.from({ length: ringCount }, (_, ringIndex): Vector3 => {
        const ring = mesh.vertices.slice(
          ringIndex * RADIAL_SEGMENTS,
          (ringIndex + 1) * RADIAL_SEGMENTS,
        );
        const mean = (axis: 0 | 1 | 2): number =>
          ring.reduce((sum, vertex) => sum + vertex[axis], 0) / ring.length;
        return [mean(0), mean(1), mean(2)];
      });
      const allRingRadii = ringCenters.flatMap((center, ringIndex) =>
        mesh.vertices
          .slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS)
          .map((vertex) => distance([vertex[0], vertex[1], vertex[2]], center)),
      );
      expect(Math.max(...allRingRadii) - Math.min(...allRingRadii), mesh.id).toBeLessThan(1e-5);
      allRingRadii.forEach((ringRadius) => expect(ringRadius).toBeCloseTo(radius, 5));
      mesh.fiberPaths?.forEach((fiberPath) => {
        const fiberRadii = fiberPath.map((point, index) =>
          distance([point[0], point[1], point[2]], ringCenters[index]),
        );
        expect(Math.max(...fiberRadii) - Math.min(...fiberRadii), mesh.id).toBeLessThan(1e-5);
        const fiberDirections = fiberPath.slice(1).map((point, index) =>
          normalize(subtract(
            [point[0], point[1], point[2]],
            [fiberPath[index][0], fiberPath[index][1], fiberPath[index][2]],
          )),
        );
        const maximumFiberTurnDegrees = Math.max(...fiberDirections.slice(1).map((direction, index) =>
          Math.acos(Math.max(-1, Math.min(1, dot(fiberDirections[index], direction)))) * 180 / Math.PI,
        ));
        expect(maximumFiberTurnDegrees, mesh.id).toBeLessThanOrEqual(3);
      });

      const segments = ringCenters.slice(1).map((point, index) => subtract(point, ringCenters[index]));
      const segmentLengths = segments.map((segment) => Math.hypot(...segment));
      const directions = segments.map(normalize);
      expect(Math.max(...segmentLengths)).toBeLessThanOrEqual(0.35);
      const chord = subtract(innerEdge.at(-1)!, innerEdge[0]);
      const chordLength = Math.hypot(...chord);
      const pathLength = segmentLengths.reduce((sum, length) => sum + length, 0);
      if (mesh.id.includes("patient-mcl")) {
        const gapAtFraction = (fraction: number): number => {
          const ringIndex = Math.round((ringCount - 1) * fraction);
          const center = ringCenters[ringIndex];
          const centerDistanceMm = Math.min(...[femur, tibia].map((bone) =>
            closestMeshSurfaceContact(
              { x: center[0], y: center[1], z: center[2] },
              bone,
            )?.distanceMm ?? Infinity,
          ));
          return Math.max(0, centerDistanceMm - radius);
        };
        // Prevent reintroducing the fixed outward lift that made the MCL bow
        // conspicuously away from the medial cortex in the actual MRI model.
        expect(Math.max(
          gapAtFraction(0.25),
          gapAtFraction(0.5),
          gapAtFraction(0.75),
        )).toBeLessThanOrEqual(4.25);
      } else {
        // The ALL obstruction on this knee is distal rather than centered.
        // A symmetric lift produced the visibly lax loop reported in the
        // deployed demo; the patient-derived asymmetric arc stays taut.
        const centerlineChordLength = distance(ringCenters[0], ringCenters.at(-1)!);
        const maximumChordDeviation = Math.max(...ringCenters.map((point) =>
          distanceFromLine(point, ringCenters[0], ringCenters.at(-1)!)));
        expect(pathLength / centerlineChordLength, mesh.id).toBeLessThanOrEqual(1.06);
        expect(maximumChordDeviation / centerlineChordLength, mesh.id).toBeLessThanOrEqual(0.125);
      }
      expect(pathLength / chordLength, mesh.id).toBeLessThanOrEqual(1.16);

      const turnAngles = directions.slice(1).map((direction, index) =>
        Math.acos(Math.max(-1, Math.min(1, dot(directions[index], direction)))),
      );
      const curvatures = turnAngles.map((angle, index) =>
        angle / Math.max(1e-6, (segmentLengths[index] + segmentLengths[index + 1]) / 2),
      );
      expect(Math.max(...turnAngles) * 180 / Math.PI).toBeLessThanOrEqual(3);
      expect(Math.max(...curvatures)).toBeLessThanOrEqual(0.2);
      const curvatureJumps = curvatures.slice(1).map((curvature, index) =>
        Math.abs(curvature - curvatures[index]),
      );
      expect(Math.max(...curvatureJumps)).toBeLessThanOrEqual(0.03);

      // Tangency is defined by the exact face normal persisted with each
      // attachment. Sampling an adjacent voxel triangle would make the target
      // direction jump as the segmentation stair-step changes.
      const proximalNormal = normalize(
        pair[0].apertureSurfaceAttachment!.surfaceNormalPatientRas,
      );
      const distalNormal = normalize(
        pair[1].apertureSurfaceAttachment!.surfaceNormalPatientRas,
      );
      const tangentTolerance = Math.sin(5 * Math.PI / 180);
      expect(Math.abs(dot(directions[0], proximalNormal))).toBeLessThanOrEqual(tangentTolerance);
      expect(Math.abs(dot(directions.at(-1)!, distalNormal))).toBeLessThanOrEqual(tangentTolerance);

      const middleRing = mesh.vertices.slice(
        Math.floor(ringCount / 2) * RADIAL_SEGMENTS,
        (Math.floor(ringCount / 2) + 1) * RADIAL_SEGMENTS,
      );
      const expectedDiameter = distance(
        [middleRing[0][0], middleRing[0][1], middleRing[0][2]],
        [middleRing[RADIAL_SEGMENTS / 2][0], middleRing[RADIAL_SEGMENTS / 2][1], middleRing[RADIAL_SEGMENTS / 2][2]],
      );
      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
        const ring = mesh.vertices.slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS);
        for (let radialIndex = 0; radialIndex < RADIAL_SEGMENTS / 2; radialIndex += 1) {
          const opposedDiameter = distance(
            [ring[radialIndex][0], ring[radialIndex][1], ring[radialIndex][2]],
            [
              ring[radialIndex + RADIAL_SEGMENTS / 2][0],
              ring[radialIndex + RADIAL_SEGMENTS / 2][1],
              ring[radialIndex + RADIAL_SEGMENTS / 2][2],
            ],
          );
          expect(opposedDiameter).toBeCloseTo(expectedDiameter, 5);
        }
      }

      innerEdge.forEach((point) => {
        expect(pointStaysWithinDisplayOverlap(point, femur, 2.3)).toBe(true);
        expect(pointStaysWithinDisplayOverlap(point, tibia, 2.3)).toBe(true);
      });
      for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 8) {
        const terminal = ringIndex / (ringCount - 1) <= 0.35 ||
          ringIndex / (ringCount - 1) >= 0.65;
        const toleranceMm = terminal ? 2.3 : 0.9;
        const ring = mesh.vertices.slice(ringIndex * RADIAL_SEGMENTS, (ringIndex + 1) * RADIAL_SEGMENTS);
        ring.forEach((point) => {
          const tuple: Vector3 = [point[0], point[1], point[2]];
          expect(pointStaysWithinDisplayOverlap(tuple, femur, toleranceMm)).toBe(true);
          expect(pointStaysWithinDisplayOverlap(tuple, tibia, toleranceMm)).toBe(true);
        });
      }
    }
  }, 30_000);
});
