import { describe, expect, it } from "vitest";
import type { ChannelPlan, PlanCase, Vector3 } from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import { createSyntheticDemoCase } from "./caseFactory";
import { buildSyntheticAnatomyMeshes } from "./channelGeometry";
import { deriveAnatomicReferenceFrame } from "../geometry/anatomicReferencePlanes";
import { ANATOMY_DERIVED_SURFACE_SEED_WARNING } from "./anatomicChannelSurfaceSeed";
import {
  attachMissingForwardSurfaceStart,
  GENERIC_ANCHOR_TRAJECTORY_WARNING,
  initializePendingChannelSurfacePlacements,
  UNREGISTERED_DEFAULT_TRAJECTORY_WARNING,
} from "./channelSurfaceInitialization";
import { TIBIAL_SUPERIOR_ENVELOPE_WARNING } from "./channelHandleEdit";

function demoChannel(id: string): ChannelPlan {
  const channel = createSyntheticDemoCase().variants[0].channels.find((candidate) => candidate.id === id);
  if (!channel) throw new Error(`Missing demo channel ${id}`);
  return structuredClone(channel);
}

function planWithChannels(channels: ChannelPlan[]): PlanCase {
  const plan = createSyntheticDemoCase();
  plan.variants = [{ ...plan.variants[0], channels }];
  return plan;
}

function pending(channel: ChannelPlan): ChannelPlan {
  return {
    ...channel,
    apertureSurfaceAttachment: null,
    endpointSurfaceAttachment: null,
    surfacePlacement: {
      state: "pending_default",
      method: "preset_seed_unregistered",
      meshIds: [],
      endpointMethod: "not_available",
    },
  };
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

function sagittalPlaneMesh(
  id: string,
  anatomyBone: NonNullable<ViewerMeshPayload["anatomyBone"]>,
  x: number,
): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices: [
      [x, -20, -20],
      [x, 20, -20],
      [x, 20, 20],
      [x, -20, 20],
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    color: "#ffffff",
    opacity: 0.22,
    layer: "bones",
    anatomyBone,
  };
}

function boxMesh(
  id: string,
  anatomyBone: NonNullable<ViewerMeshPayload["anatomyBone"]>,
  extent: number,
): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices: [
      [-extent, -extent, -extent], [extent, -extent, -extent],
      [extent, extent, -extent], [-extent, extent, -extent],
      [-extent, -extent, extent], [extent, -extent, extent],
      [extent, extent, extent], [-extent, extent, extent],
    ],
    faces: [
      [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
      [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ],
    color: "#ffffff",
    opacity: 0.22,
    layer: "bones",
    anatomyBone,
  };
}

function configuredChannel(
  id: string,
  aperture: Vector3,
  vector: Vector3,
  depthMm: number,
): ChannelPlan {
  const channel = pending(demoChannel(id));
  return {
    ...channel,
    aperture,
    vector,
    depthMm,
    centerline: {
      kind: "rigid",
      aperturePatientRasMm: aperture,
      directionPatientRas: vector,
    },
  };
}

function subtract(left: Vector3, right: Vector3): Vector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function dot(left: Vector3, right: Vector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function mirroredLeftMeshes(meshes: ViewerMeshPayload[]): ViewerMeshPayload[] {
  return meshes.map((mesh) => ({
    ...mesh,
    id: `${mesh.id}-left`,
    vertices: mesh.vertices.map((point) => [-point[0], point[1], point[2]]),
    faces: mesh.faces.map((face) => [...face].reverse()),
  }));
}

function anatomySeedPlan(
  laterality: "left" | "right",
  specifications: Array<{
    id: string;
    procedure: "ACL" | "PCL" | "PLC_FCL" | "MCL_POL_PMC" | "ALL" | "LET";
    bone: "femur" | "tibia" | "fibula";
    semanticKey: string;
    label: string;
    trajectoryControlMode?: ChannelPlan["trajectoryControlMode"];
  }>,
): PlanCase {
  const base = createSyntheticDemoCase();
  const procedures = specifications.map((specification, index) => ({
    ...structuredClone(base.procedures[index % base.procedures.length]),
    id: `anatomic-procedure-${index}`,
    structure: specification.procedure,
    constructs: [],
  }));
  const channels = specifications.map((specification, index) => {
    const channel = pending(demoChannel("acl-femoral"));
    return {
      ...channel,
      id: specification.id,
      semanticKey: specification.semanticKey,
      label: specification.label,
      procedureId: procedures[index].id,
      bone: specification.bone,
      geometryType: specification.trajectoryControlMode === "exterior_rod"
        ? "anchor_pilot" as const
        : "retrograde_socket" as const,
      trajectoryControlMode: specification.trajectoryControlMode ?? "outer_cortex_surface",
      aperture: [0, 0, 0] as Vector3,
      vector: [0, 0, 1] as Vector3,
      centerline: {
        kind: "rigid" as const,
        aperturePatientRasMm: [0, 0, 0] as Vector3,
        directionPatientRas: [0, 0, 1] as Vector3,
      },
      fullThickness: false,
      depthMm: 18,
    };
  });
  return {
    ...base,
    laterality,
    lateralityVerified: true,
    procedures,
    variants: [{ ...base.variants[0], channels }],
  };
}

function lateralOffset(point: Vector3, meshes: ViewerMeshPayload[], laterality: "left" | "right"): number {
  const frame = deriveAnatomicReferenceFrame(meshes, {
    laterality,
    lateralityVerified: true,
    scaleVerified: true,
  });
  if (frame.evaluationState !== "evaluated") throw new Error(frame.reason);
  return dot(
    subtract(point, frame.midline.originPatientRasMm),
    frame.midline.normalPatientRas,
  );
}

function withResolvedDicomLateralityHint(
  plan: PlanCase,
  laterality: "left" | "right",
): PlanCase {
  const hash = "a".repeat(64);
  return {
    ...plan,
    laterality,
    lateralityVerified: false,
    imaging: {
      ...plan.imaging,
      segmentationRuns: [{
        id: `dicom-run-${laterality}`,
        adapterId: "test-adapter",
        adapterVersion: "1",
        validationState: "research_only",
        researchUseOnly: true,
        sourceId: "test-source",
        algorithm: {
          name: "test",
          modelId: "test",
          modelVersion: null,
          modelSha256: hash,
          pipelineName: "test",
          modelDataset: "test",
          modelTrainer: "test",
          modelPlans: "test",
          modelConfiguration: "test",
          modelFolds: [0],
          checkpointName: "test",
          checkpoints: [{ fold: 0, checkpointName: "test", sha256: hash, byteLength: 1 }],
          configurationArtifacts: [
            { name: "plans.json", sha256: hash, byteLength: 1 },
            { name: "dataset.json", sha256: hash, byteLength: 1 },
          ],
          nnunetv2Version: null,
          matPlannerRevision: "test",
          registrySha256: hash,
          algorithmSourceSha256: hash,
        },
        labelStatus: { femur: "segmented", tibia: "segmented", fibula: "segmented" },
        artifactIds: [],
        warningCodes: [],
        notEvaluatedCodes: [],
        lateralityHint: {
          laterality,
          status: "resolved",
          confidence: "high",
          evidence: [{ source: "dicom_image_laterality", laterality }],
          requiresClinicianVerification: true,
        },
        generatedAt: "2026-08-23T12:00:00.000Z",
      }],
    },
  };
}

describe("pending channel surface initialization", () => {
  it.each(["right", "left"] as const)(
    "seeds lateral structures laterally and MCL medially on a mirrored %s knee",
    (laterality) => {
      const rightMeshes = buildSyntheticAnatomyMeshes();
      const meshes = laterality === "right" ? rightMeshes : mirroredLeftMeshes(rightMeshes);
      const plan = anatomySeedPlan(laterality, [
        { id: "plc", procedure: "PLC_FCL", bone: "femur", semanticKey: "femur-anchor-1", label: "PLC femur anchor", trajectoryControlMode: "exterior_rod" },
        { id: "plc-tibia", procedure: "PLC_FCL", bone: "tibia", semanticKey: "tibia-laprade_full_tunnel", label: "PLC tibial LaPrade-style full tunnel" },
        { id: "all", procedure: "ALL", bone: "tibia", semanticKey: "tibia-anchor-1", label: "ALL tibia anchor", trajectoryControlMode: "exterior_rod" },
        { id: "let", procedure: "LET", bone: "femur", semanticKey: "femur-anchor-1", label: "LET femur anchor", trajectoryControlMode: "exterior_rod" },
        { id: "mcl", procedure: "MCL_POL_PMC", bone: "femur", semanticKey: "femur-anchor-1", label: "MCL femur anchor", trajectoryControlMode: "exterior_rod" },
      ]);
      const initialized = initializePendingChannelSurfacePlacements(plan, meshes);
      const byId = new Map(initialized.variants[0].channels.map((channel) => [channel.id, channel]));

      expect(lateralOffset(byId.get("plc")!.aperture, meshes, laterality)).toBeGreaterThan(5);
      expect(lateralOffset(byId.get("plc-tibia")!.aperture, meshes, laterality)).toBeGreaterThan(5);
      expect(lateralOffset(
        byId.get("plc-tibia")!.endpointSurfaceAttachment!.attachedPointPatientRasMm,
        meshes,
        laterality,
      )).toBeGreaterThan(5);
      expect(lateralOffset(byId.get("all")!.aperture, meshes, laterality)).toBeGreaterThan(5);
      expect(lateralOffset(byId.get("let")!.aperture, meshes, laterality)).toBeGreaterThan(5);
      expect(lateralOffset(byId.get("mcl")!.aperture, meshes, laterality)).toBeLessThan(-5);
      for (const channel of byId.values()) {
        expect(channel.surfacePlacement?.state).toBe("default_applied");
        expect(channel.warnings).toContain(ANATOMY_DERIVED_SURFACE_SEED_WARNING);
      }
    },
  );

  it("mirrors ACL and PCL notch-wall entries and their outer-cortex Starts", () => {
    const rightMeshes = buildSyntheticAnatomyMeshes();
    const leftMeshes = mirroredLeftMeshes(rightMeshes);
    const specifications = [
      { id: "acl", procedure: "ACL" as const, bone: "femur" as const, semanticKey: "femur-single-1", label: "ACL femur socket" },
      { id: "pcl", procedure: "PCL" as const, bone: "femur" as const, semanticKey: "femur-single-1", label: "PCL femur socket" },
    ];
    const right = initializePendingChannelSurfacePlacements(
      anatomySeedPlan("right", specifications),
      rightMeshes,
    ).variants[0].channels;
    const left = initializePendingChannelSurfacePlacements(
      anatomySeedPlan("left", specifications),
      leftMeshes,
    ).variants[0].channels;
    const rightAcl = right.find((channel) => channel.id === "acl")!;
    const rightPcl = right.find((channel) => channel.id === "pcl")!;
    const leftAcl = left.find((channel) => channel.id === "acl")!;
    const leftPcl = left.find((channel) => channel.id === "pcl")!;

    const rightAclEntry = lateralOffset(rightAcl.aperture, rightMeshes, "right");
    const rightAclStart = lateralOffset(
      rightAcl.endpointSurfaceAttachment!.attachedPointPatientRasMm,
      rightMeshes,
      "right",
    );
    const rightPclEntry = lateralOffset(rightPcl.aperture, rightMeshes, "right");
    const rightPclStart = lateralOffset(
      rightPcl.endpointSurfaceAttachment!.attachedPointPatientRasMm,
      rightMeshes,
      "right",
    );
    expect(rightAclEntry).toBeGreaterThan(0);
    expect(rightAclStart).toBeGreaterThan(rightAclEntry + 5);
    expect(rightPclEntry).toBeLessThan(0);
    expect(rightPclStart).toBeLessThan(rightPclEntry - 5);

    expect(leftAcl.aperture[0]).toBeCloseTo(-rightAcl.aperture[0], 6);
    expect(leftAcl.aperture[1]).toBeCloseTo(rightAcl.aperture[1], 6);
    expect(leftAcl.aperture[2]).toBeCloseTo(rightAcl.aperture[2], 6);
    expect(leftPcl.aperture[0]).toBeCloseTo(-rightPcl.aperture[0], 6);
    expect(leftPcl.aperture[1]).toBeCloseTo(rightPcl.aperture[1], 6);
    expect(leftPcl.aperture[2]).toBeCloseTo(rightPcl.aperture[2], 6);
    expect(lateralOffset(leftAcl.aperture, leftMeshes, "left")).toBeGreaterThan(0);
    expect(lateralOffset(leftPcl.aperture, leftMeshes, "left")).toBeLessThan(0);
  });

  it("uses a matching resolved DICOM hint for an unverified mirrored left-knee seed", () => {
    const rightMeshes = buildSyntheticAnatomyMeshes();
    const leftMeshes = mirroredLeftMeshes(rightMeshes);
    const specifications = [{
      id: "plc",
      procedure: "PLC_FCL" as const,
      bone: "femur" as const,
      semanticKey: "femur-anchor-1",
      label: "PLC femur anchor",
      trajectoryControlMode: "exterior_rod" as const,
    }];
    const right = initializePendingChannelSurfacePlacements(
      withResolvedDicomLateralityHint(anatomySeedPlan("right", specifications), "right"),
      rightMeshes,
    ).variants[0].channels[0];
    const left = initializePendingChannelSurfacePlacements(
      withResolvedDicomLateralityHint(anatomySeedPlan("left", specifications), "left"),
      leftMeshes,
    ).variants[0].channels[0];

    expect(right.aperture[0]).toBeGreaterThan(0);
    expect(left.aperture[0]).toBeLessThan(0);
    expect(left.aperture[0]).toBeCloseTo(-right.aperture[0], 6);
    expect(left.aperture[1]).toBeCloseTo(right.aperture[1], 6);
    expect(left.aperture[2]).toBeCloseTo(right.aperture[2], 6);
    expect(left.warnings).toContain(ANATOMY_DERIVED_SURFACE_SEED_WARNING);
  });

  it("places an intra-articular tibial aperture on the maximum-Z envelope across tibia meshes", () => {
    const channel = configuredChannel("acl-tibial", [2, 3, 5], [0, 0, -1], 9);
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("tibia-low", "tibia", 2), planeMesh("tibia-high", "tibia", 12)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.aperture[0]).toBeCloseTo(2, 10);
    expect(initialized.aperture[1]).toBeCloseTo(3, 10);
    expect(initialized.aperture[2]).toBeCloseTo(12, 10);
    expect(initialized.apertureSurfaceAttachment).toMatchObject({
      coordinateSpace: "patient_ras",
      units: "mm",
      bone: "tibia",
      targetKind: "tibial_superior_envelope",
      targetRegionId: null,
      meshId: "tibia-high",
      requestedPointPatientRasMm: [2, 3, 5],
      triangleStableId: "tibia-high:face:1",
      faceStableId: "tibia-high:face:1",
      reviewState: "user_defined_not_clinician_approved",
      constraintProvenance: {
        rule: "maximum_patient_ras_z_at_requested_xy",
        ruleVersion: "1",
        sourceGeometryRole: "viewer_display_surface",
        resolution: "vertical_intersection",
        xyFallbackDistanceMm: 0,
      },
    });
    expect(initialized.apertureSurfaceAttachment?.attachedPointPatientRasMm[0]).toBeCloseTo(2, 10);
    expect(initialized.apertureSurfaceAttachment?.attachedPointPatientRasMm[1]).toBeCloseTo(3, 10);
    expect(initialized.apertureSurfaceAttachment?.attachedPointPatientRasMm[2]).toBeCloseTo(12, 10);
    expect(initialized.apertureSurfaceAttachment?.vertexStableIds).toEqual([
      "tibia-high:vertex:0",
      "tibia-high:vertex:2",
      "tibia-high:vertex:3",
    ]);
    expect(initialized.apertureSurfaceAttachment?.barycentric).toHaveLength(3);
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      bone: "tibia",
      targetKind: "whole_bone_surface",
      meshId: "tibia-low",
    });
    expect(initialized.endpointSurfaceAttachment?.attachedPointPatientRasMm[0]).toBeCloseTo(2, 10);
    expect(initialized.endpointSurfaceAttachment?.attachedPointPatientRasMm[1]).toBeCloseTo(3, 10);
    expect(initialized.endpointSurfaceAttachment?.attachedPointPatientRasMm[2]).toBeCloseTo(2, 10);
    expect(initialized.surfacePlacement).toEqual({
      state: "default_applied",
      method: "tibial_superior_envelope",
      meshIds: ["tibia-high", "tibia-low"],
      endpointMethod: "opposite_surface_intersection",
    });
    expect(initialized.depthMm).toBe(9);
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.warnings).toContain(TIBIAL_SUPERIOR_ENVELOPE_WARNING);
  });

  it("places a non-plateau aperture on the exact nearest declared-bone triangle", () => {
    const channel = configuredChannel("acl-femoral", [1, 2, 4], [1, 0, 0], 8);
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [
        planeMesh("wrong-tibia", "tibia", 4),
        planeMesh("femur-far", "femur", 20),
        planeMesh("femur-near", "femur", 3),
      ],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.aperture).toEqual([1, 2, 3]);
    expect(initialized.apertureSurfaceAttachment).toMatchObject({
      bone: "femur",
      targetKind: "whole_bone_surface",
      meshId: "femur-near",
      requestedPointPatientRasMm: [1, 2, 4],
      attachedPointPatientRasMm: [1, 2, 3],
      reviewState: "surface_review_not_evaluated",
    });
    expect(initialized.surfacePlacement).toEqual({
      state: "default_applied",
      method: "nearest_bone_surface",
      meshIds: ["femur-near"],
      endpointMethod: "not_available",
    });
  });

  it("discloses an outside-footprint superior-envelope X/Y fallback", () => {
    const channel = configuredChannel("acl-tibial", [30, 3, 5], [0, 0, -1], 9);
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("tibia", "tibia", 12)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.apertureSurfaceAttachment?.constraintProvenance).toMatchObject({
      resolution: "nearest_xy_fallback",
      xyFallbackDistanceMm: 10,
      sourceGeometryRole: "viewer_display_surface",
    });
    expect(initialized.warnings.some((warning) =>
      warning.startsWith("Tibial superior-envelope X/Y fallback:") && warning.includes("10.0 mm"),
    )).toBe(true);
  });

  it("places both ends of a full tunnel on the declared bone and records both face tethers", () => {
    const channel = configuredChannel("pcl-tibial", [0, 0, 9], [0, 0, -1], 18);
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("tibia-top", "tibia", 10), planeMesh("tibia-bottom", "tibia", -10)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.aperture).toEqual([0, 0, 10]);
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.depthMm).toBe(20);
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      bone: "tibia",
      targetKind: "whole_bone_surface",
      meshId: "tibia-bottom",
      requestedPointPatientRasMm: [0, 0, -8],
      attachedPointPatientRasMm: [0, 0, -10],
      reviewState: "surface_review_not_evaluated",
    });
    expect(initialized.centerline).toEqual({
      kind: "rigid",
      aperturePatientRasMm: [0, 0, 10],
      directionPatientRas: [0, 0, -1],
    });
    expect(initialized.surfacePlacement).toEqual({
      state: "default_applied",
      method: "tibial_superior_envelope",
      meshIds: ["tibia-top", "tibia-bottom"],
      endpointMethod: "opposite_surface_intersection",
    });
  });

  it("uses the first on-axis exit instead of a closer off-axis cortex", () => {
    const channel = configuredChannel("pcl-tibial", [0, 0, 9], [0, 0, -1], 18);
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [
        planeMesh("tibia-top", "tibia", 10),
        sagittalPlaneMesh("off-axis-cortex", "tibia", 1),
        planeMesh("tibia-bottom", "tibia", -10),
      ],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.endpointSurfaceAttachment?.meshId).toBe("tibia-bottom");
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.depthMm).toBe(20);
  });

  it("attaches a cortical Start without overwriting an explicit instrument depth", () => {
    const channel = configuredChannel("pcl-tibial", [0, 0, 9], [0, 0, -1], 18);
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "depth", depthMm: 18 };
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("tibia-top", "tibia", 10), planeMesh("tibia-bottom", "tibia", -10)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.aperture[2]).toBeCloseTo(10, 10);
    expect(initialized.depthMm).toBe(18);
    expect(initialized.instrumentChain.depthOrFullTunnelSetting).toEqual({ mode: "depth", depthMm: 18 });
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-bottom",
      attachedPointPatientRasMm: [0, 0, -10],
    });
    expect(initialized.surfacePlacement?.endpointMethod).toBe("opposite_surface_intersection");
  });

  it("redirects only an unregistered default inward when its authored ray points out of bone", () => {
    const channel = configuredChannel("acl-femoral", [0, 0, 8], [0, 0, 1], 8);
    const initialized = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [boxMesh("femur-box", "femur", 5)],
    ).variants[0].channels[0];

    expect(initialized.aperture).toEqual([0, 0, 5]);
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.depthMm).toBe(8);
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      meshId: "femur-box",
      attachedPointPatientRasMm: [0, 0, -5],
    });
    expect(initialized.warnings).toContain(UNREGISTERED_DEFAULT_TRAJECTORY_WARNING);
  });

  it("places an anchor Start on bone, points its socket inward, and does not create an opposite-cortex Start", () => {
    const channel = configuredChannel("acl-femoral", [0, 0, 8], [0, 0, 1], 22);
    channel.geometryType = "anchor_pilot";
    channel.fullThickness = false;
    channel.diameterMm = 4.75;
    channel.crossSection = { kind: "circle", diameterMm: 4.75 };

    const initialized = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [boxMesh("femur-box", "femur", 5)],
    ).variants[0].channels[0];

    expect(initialized.aperture).toEqual([0, 0, 5]);
    expect(initialized.apertureSurfaceAttachment?.meshId).toBe("femur-box");
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.endpointSurfaceAttachment).toBeNull();
    expect(initialized.depthMm).toBe(22);
    expect(initialized.surfacePlacement?.endpointMethod).toBe("preserved_depth");
    expect(initialized.warnings).toContain(GENERIC_ANCHOR_TRAJECTORY_WARNING);
  });

  it("preserves a clinician-entered full-tunnel length while restoring its missing cortical Start", () => {
    const entryOnly = initializePendingChannelSurfacePlacements(
      planWithChannels([
        configuredChannel("pcl-tibial", [0, 0, 9], [0, 0, -1], 13.5),
      ]),
      [planeMesh("tibia-entry", "tibia", 10)],
    ).variants[0].channels[0];
    const clinicianEdited: ChannelPlan = {
      ...entryOnly,
      depthMm: 13.5,
      endpointSurfaceAttachment: null,
      surfacePlacement: {
        state: "clinician_edited",
        method: "manual_numeric_edit",
        meshIds: ["tibia-entry"],
        endpointMethod: "not_available",
      },
    };

    const attached = attachMissingForwardSurfaceStart(clinicianEdited, [
      planeMesh("tibia-entry", "tibia", 10),
      planeMesh("tibia-start", "tibia", -10),
    ]);

    expect(attached.fullThickness).toBe(true);
    expect(attached.depthMm).toBe(13.5);
    expect(attached.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-start",
      attachedPointPatientRasMm: [0, 0, -10],
    });
  });

  it("translates every flexible access-control point while preserving a blind socket vector and depth", () => {
    const base = configuredChannel("plc-pop-femoral", [0, 0, 4], [0, 0, -1], 9);
    const channel: ChannelPlan = {
      ...base,
      centerline: {
        kind: "flexible",
        aperturePatientRasMm: [0, 0, 4],
        intraosseousDirectionPatientRas: [0, 0, -1],
        accessControlPointsPatientRasMm: [[0, 0, 4], [2, 3, -1]],
        minimumBendRadiusMm: 28,
      },
    };
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("femur", "femur", 2), planeMesh("femur-exit", "femur", -10)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.depthMm).toBe(9);
    expect(initialized.vector).toEqual([0, 0, -1]);
    expect(initialized.centerline).toEqual({
      kind: "flexible",
      aperturePatientRasMm: [0, 0, 2],
      intraosseousDirectionPatientRas: [0, 0, -1],
      accessControlPointsPatientRasMm: [[0, 0, 2], [2, 3, -3]],
      minimumBendRadiusMm: 28,
    });
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      meshId: "femur-exit",
      attachedPointPatientRasMm: [0, 0, -10],
    });
  });

  it("translates every polyline point by the aperture delta", () => {
    const base = configuredChannel("pcl-femoral", [0, 0, 4], [0, 0, -1], 9);
    const channel: ChannelPlan = {
      ...base,
      centerline: {
        kind: "polyline",
        pointsPatientRasMm: [[0, 0, 4], [2, 0, 0], [3, 1, -5]],
      },
    };
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("femur", "femur", 2)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.centerline).toEqual({
      kind: "polyline",
      pointsPatientRasMm: [[0, 0, 2], [2, 0, -2], [3, 1, -7]],
    });
    expect(initialized.depthMm).toBe(9);
    expect(initialized.vector).toEqual([0, 0, -1]);
  });

  it("finds a socket Start without selecting or inventing a missing depth", () => {
    const channel = configuredChannel("acl-tibial", [0, 0, 9], [0, 0, -1], 9);
    channel.depthMm = null;
    channel.instrumentChain.depthOrFullTunnelSetting = { mode: "depth", depthMm: null };
    const result = initializePendingChannelSurfacePlacements(
      planWithChannels([channel]),
      [planeMesh("tibia-entry", "tibia", 10), planeMesh("tibia-start", "tibia", -10)],
    );
    const initialized = result.variants[0].channels[0];

    expect(initialized.aperture).toEqual([0, 0, 10]);
    expect(initialized.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-start",
      attachedPointPatientRasMm: [0, 0, -10],
    });
    expect(initialized.depthMm).toBeNull();
    expect(initialized.instrumentChain.depthOrFullTunnelSetting).toEqual({
      mode: "depth",
      depthMm: null,
    });
    expect(initialized.vector).toEqual([0, 0, -1]);
  });

  it("backfills only a missing Start on a clinician-edited socket and is idempotent", () => {
    const pendingChannel = configuredChannel("acl-tibial", [0, 0, 9], [0, 0, -1], 17.5);
    const entryOnly = initializePendingChannelSurfacePlacements(
      planWithChannels([pendingChannel]),
      [planeMesh("tibia-entry", "tibia", 10)],
    ).variants[0].channels[0];
    const authored: ChannelPlan = {
      ...entryOnly,
      vector: [0.2, 0, -1],
      depthMm: 17.5,
      centerline: {
        kind: "rigid",
        aperturePatientRasMm: entryOnly.aperture,
        directionPatientRas: [0.2, 0, -1],
      },
      instrumentChain: {
        ...entryOnly.instrumentChain,
        productVariantId: "clinician-authored-product",
        depthOrFullTunnelSetting: { mode: "depth", depthMm: 17.5 },
      },
      surfacePlacement: {
        state: "clinician_edited",
        method: "manual_numeric_edit",
        meshIds: ["tibia-entry"],
        endpointMethod: "not_available",
      },
    };
    const authoredSnapshot = structuredClone(authored);
    const meshes = [
      planeMesh("tibia-entry", "tibia", 10),
      planeMesh("tibia-start", "tibia", -10),
    ];
    const attached = attachMissingForwardSurfaceStart(authored, meshes);
    const repeated = attachMissingForwardSurfaceStart(attached, meshes);

    expect(authored).toEqual(authoredSnapshot);
    expect(attached).not.toBe(authored);
    expect(repeated).toBe(attached);
    expect(attached.aperture).toEqual(authored.aperture);
    expect(attached.vector).toEqual(authored.vector);
    expect(attached.depthMm).toBe(17.5);
    expect(attached.centerline).toEqual(authored.centerline);
    expect(attached.instrumentChain).toBe(authored.instrumentChain);
    expect(attached.endpointSurfaceAttachment).toMatchObject({
      meshId: "tibia-start",
      attachedPointPatientRasMm: [4, 0, -10],
    });
    expect(attached.surfacePlacement).toEqual({
      state: "clinician_edited",
      method: "manual_numeric_edit",
      meshIds: ["tibia-entry", "tibia-start"],
      endpointMethod: "opposite_surface_intersection",
    });
  });

  it("is immutable, leaves missing declared anatomy pending, and is idempotent after applying a default", () => {
    const missingFibula = pending(demoChannel("plc-fibular"));
    const missingPlan = planWithChannels([missingFibula]);
    const missingSnapshot = structuredClone(missingPlan);
    const unchanged = initializePendingChannelSurfacePlacements(
      missingPlan,
      [planeMesh("femur", "femur", 2)],
    );
    expect(unchanged).toBe(missingPlan);
    expect(missingPlan).toEqual(missingSnapshot);
    expect(unchanged.variants[0].channels[0].surfacePlacement?.state).toBe("pending_default");

    const sourcePlan = planWithChannels([
      configuredChannel("acl-femoral", [0, 0, 4], [0, 0, -1], 9),
    ]);
    const sourceSnapshot = structuredClone(sourcePlan);
    const first = initializePendingChannelSurfacePlacements(
      sourcePlan,
      [planeMesh("femur", "femur", 2)],
    );
    const second = initializePendingChannelSurfacePlacements(
      first,
      [planeMesh("different-femur", "femur", 40)],
    );

    expect(sourcePlan).toEqual(sourceSnapshot);
    expect(first).not.toBe(sourcePlan);
    expect(second).toBe(first);
    expect(second.variants[0].channels[0].aperture).toEqual([0, 0, 2]);
    expect(second.variants[0].channels[0].surfacePlacement?.state).toBe("default_applied");
  });
});
