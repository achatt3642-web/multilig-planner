import { describe, expect, it } from "vitest";
import type { ChannelPlan, Vector3 } from "../domain/types";
import type { ViewerMeshPayload } from "../viewer/types";
import { buildSyntheticAnatomyMeshes, buildViewerScene } from "./channelGeometry";
import { createSyntheticDemoCase } from "./caseFactory";
import {
  autoConfigureSimplifiedProcedure,
  configureSimplifiedProcedure,
  configuredSimplifiedSelection,
  simplifiedTechniqueSelectionsEqual,
} from "./configureSimplifiedProcedure";
import { activeVariant } from "./planOperations";
import {
  createEmptySimplifiedSelection,
  type SimplifiedBoneChoice,
  type SimplifiedTechniqueSelection,
} from "./simplifiedTechniqueFlow";

const bone = (overrides: Partial<SimplifiedBoneChoice>): SimplifiedBoneChoice => ({
  bundle: null,
  preparation: null,
  count: null,
  diameterMm: null,
  depthMm: null,
  ...overrides,
});

function selection(
  procedure: SimplifiedTechniqueSelection["procedure"],
  overrides: Partial<SimplifiedTechniqueSelection>,
): SimplifiedTechniqueSelection {
  return { ...createEmptySimplifiedSelection(procedure), ...overrides };
}

function procedureChannels(plan: ReturnType<typeof createSyntheticDemoCase>, structure: "MCL_POL_PMC" | "PLC_FCL"): ChannelPlan[] {
  const ids = new Set(plan.procedures.filter((procedure) => procedure.structure === structure).map((procedure) => procedure.id));
  return activeVariant(plan).channels.filter((channel) => ids.has(channel.procedureId));
}

function boxMesh(id: string, bone: "femur" | "tibia", minZ: number, maxZ: number): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices: [
      [-30, -20, minZ], [0, -20, minZ], [0, 20, minZ], [-30, 20, minZ],
      [-30, -20, maxZ], [0, -20, maxZ], [0, 20, maxZ], [-30, 20, maxZ],
    ],
    faces: [
      [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
      [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
      [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
    ],
    color: "#ffffff",
    opacity: 0.22,
    layer: "bones",
    anatomyBone: bone,
  };
}

function attachMclChannel(channel: ChannelPlan, point: Vector3, meshId: string): void {
  channel.aperture = [...point];
  channel.centerline = { kind: "rigid", aperturePatientRasMm: [...point], directionPatientRas: [...channel.vector] };
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
    triangleStableId: `${meshId}:face:10`,
    faceStableId: `${meshId}:face:10`,
    faceIndex: 10,
    vertexIndices: [1, 2, 6],
    vertexStableIds: [`${meshId}:vertex:1`, `${meshId}:vertex:2`, `${meshId}:vertex:6`],
    barycentric: [1, 0, 0],
    surfaceNormalPatientRas: [1, 0, 0],
    reviewState: "surface_review_not_evaluated",
  };
  channel.endpointSurfaceAttachment = null;
  channel.surfacePlacement = {
    state: "clinician_edited",
    method: "manual_trajectory_drag",
    meshIds: [meshId],
    endpointMethod: "preserved_depth",
  };
}

describe("scoped simplified procedure configuration", () => {
  it("auto-configures only complete, changed plans", () => {
    const anatomyMeshes = [
      boxMesh("femur-shaft", "femur", 20, 50),
      boxMesh("tibia-shaft", "tibia", -20, 10),
    ];
    const incomplete = selection("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 1, diameterMm: null, depthMm: 20 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const initial = createSyntheticDemoCase();
    const initialChannels = structuredClone(activeVariant(initial).channels);
    expect(autoConfigureSimplifiedProcedure(initial, incomplete, anatomyMeshes)).toBeNull();
    expect(activeVariant(initial).channels).toEqual(initialChannels);

    const complete = selection("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 1, diameterMm: 4.2, depthMm: 20 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const configured = autoConfigureSimplifiedProcedure(initial, complete, anatomyMeshes);
    expect(configured).not.toBeNull();
    expect(procedureChannels(configured!.plan, "MCL_POL_PMC")).toHaveLength(2);
    expect(simplifiedTechniqueSelectionsEqual(
      configuredSimplifiedSelection(configured!.plan, "MCL_POL_PMC"),
      complete,
    )).toBe(true);
    expect(autoConfigureSimplifiedProcedure(configured!.plan, complete, anatomyMeshes)).toBeNull();

    const changed = structuredClone(complete);
    changed.femur!.depthMm = 24;
    const updated = autoConfigureSimplifiedProcedure(configured!.plan, changed, anatomyMeshes);
    expect(updated).not.toBeNull();
    expect(procedureChannels(updated!.plan, "MCL_POL_PMC").find((channel) => channel.bone === "femur")?.depthMm).toBe(24);
  });

  it("routes new PLC femoral channels to the anatomy-derived lateral side and mirrors with laterality", () => {
    const anatomyMeshes = buildSyntheticAnatomyMeshes();
    const plcSelection = selection("PLC_FCL", {
      femur: bone({ preparation: "socket_with_guide_pin", count: 2 }),
      tibia: bone({ preparation: "none" }),
    });
    const configureSide = (laterality: "left" | "right") => {
      const plan = createSyntheticDemoCase();
      plan.laterality = laterality;
      plan.lateralityVerified = true;
      return procedureChannels(
        configureSimplifiedProcedure(plan, plcSelection, anatomyMeshes).plan,
        "PLC_FCL",
      );
    };

    const right = configureSide("right");
    const left = configureSide("left");
    expect(right).toHaveLength(2);
    expect(left).toHaveLength(2);
    right.forEach((channel) => expect(
      channel.aperture[0],
      `${channel.label} should seed on the right-knee lateral surface`,
    ).toBeGreaterThan(0));
    left.forEach((channel) => expect(
      channel.aperture[0],
      `${channel.label} should mirror onto the left-knee lateral surface`,
    ).toBeLessThan(0));
  });

  it("configuring PLC preserves authored MCL channels and its derived graft bit-for-bit", () => {
    const anatomyMeshes = [
      boxMesh("femur-shaft", "femur", 20, 50),
      boxMesh("tibia-shaft", "tibia", -20, 10),
    ];
    const mclSelection = selection("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 1, diameterMm: 4.5, depthMm: 20 }),
      tibia: bone({ preparation: "anchor", count: 1, diameterMm: 4.5, depthMm: 20 }),
    });
    const first = configureSimplifiedProcedure(createSyntheticDemoCase(), mclSelection, anatomyMeshes).plan;
    const authored = structuredClone(first);
    procedureChannels(authored, "MCL_POL_PMC").forEach((channel) => attachMclChannel(
      channel,
      channel.bone === "femur" ? [0, 0, 30] : [0, 0, 0],
      channel.bone === "femur" ? "femur-shaft" : "tibia-shaft",
    ));
    const mclBefore = structuredClone(procedureChannels(authored, "MCL_POL_PMC"));
    const procedureByIdBefore = Object.fromEntries(authored.procedures.map((procedure) => [procedure.id, procedure.structure]));
    const sceneBefore = buildViewerScene({
      revision: 1,
      channels: activeVariant(authored).channels,
      procedureById: procedureByIdBefore,
      visibleProcedureIdentities: new Set(["MCL_POL_PMC"]),
      anatomyMeshes,
      selectedChannelId: null,
      layerVisibility: { grafts: true },
    });
    const mclGraftBefore = sceneBefore.scene.meshes.find((mesh) => mesh.layer === "grafts");
    expect(mclGraftBefore).toBeDefined();

    const plcSelection = selection("PLC_FCL", {
      femur: bone({ preparation: "socket_with_guide_pin", count: 2 }),
      tibia: bone({ preparation: "none" }),
    });
    const updated = configureSimplifiedProcedure(authored, plcSelection, anatomyMeshes).plan;
    expect(procedureChannels(updated, "MCL_POL_PMC")).toEqual(mclBefore);

    const procedureByIdAfter = Object.fromEntries(updated.procedures.map((procedure) => [procedure.id, procedure.structure]));
    const sceneAfter = buildViewerScene({
      revision: 2,
      channels: activeVariant(updated).channels,
      procedureById: procedureByIdAfter,
      visibleProcedureIdentities: new Set(["MCL_POL_PMC", "PLC_FCL"]),
      anatomyMeshes,
      selectedChannelId: null,
      layerVisibility: { grafts: true },
    });
    const mclGraftAfter = sceneAfter.scene.meshes.find((mesh) => mesh.id === mclGraftBefore!.id);
    expect(mclGraftAfter).toBeDefined();
    expect(mclGraftAfter!.vertices).toEqual(mclGraftBefore!.vertices);
    expect(mclGraftAfter!.faces).toEqual(mclGraftBefore!.faces);
    expect(sceneAfter.grafts.find((graft) => graft.id === mclGraftBefore!.id)).toMatchObject({ rendered: true });
  });
});
