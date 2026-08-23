import { describe, expect, it } from "vitest";
import { normalizeLoadedPlan } from "../App";
import { createSyntheticDemoCase } from "./caseFactory";
import { activeVariant } from "./planOperations";
import {
  createEmptySimplifiedSelection,
  replaceSimplifiedProcedure,
  type SimplifiedBoneChoice,
} from "./simplifiedTechniqueFlow";

const bone = (overrides: Partial<SimplifiedBoneChoice>): SimplifiedBoneChoice => ({
  bundle: null,
  preparation: null,
  count: null,
  diameterMm: null,
  depthMm: null,
  ...overrides,
});

describe("plan schema 1.7 socket migration", () => {
  it("preserves authored geometry while converting collateral sockets to an ipsilateral deep Start", () => {
    const selection = {
      ...createEmptySimplifiedSelection("MCL_POL_PMC"),
      femur: bone({ preparation: "socket_with_guide_pin" }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    };
    const legacy = replaceSimplifiedProcedure(createSyntheticDemoCase(), selection);
    legacy.schemaVersion = "1.6.0";
    legacy.geometryGeneratorVersion = "1.1.0";
    const procedure = legacy.procedures.at(-1)!;
    const socket = activeVariant(legacy).channels.find((channel) =>
      channel.procedureId === procedure.id && channel.bone === "femur",
    )!;
    socket.aperture = [11, 22, 33];
    socket.vector = [0.6, 0, 0.8];
    socket.depthMm = 27.5;
    socket.diameterMm = 6.25;
    socket.crossSection = { kind: "circle", diameterMm: 6.25 };
    socket.trajectoryControlMode = undefined;
    socket.guidePin = undefined;
    socket.endpointSurfaceAttachment = {
      coordinateSpace: "patient_ras",
      units: "mm",
      bone: "femur",
      targetKind: "whole_bone_surface",
      targetRegionId: null,
      meshId: "legacy-opposite-cortex",
      requestedPointPatientRasMm: [30, 22, 33],
      attachedPointPatientRasMm: [30, 22, 33],
      distanceFromRequestedPointMm: 0,
      triangleStableId: "legacy:face:0",
      faceStableId: "legacy:face:0",
      faceIndex: 0,
      vertexIndices: [0, 1, 2],
      vertexStableIds: ["legacy:vertex:0", "legacy:vertex:1", "legacy:vertex:2"],
      barycentric: [1, 0, 0],
      surfaceNormalPatientRas: [1, 0, 0],
      reviewState: "surface_review_not_evaluated",
    };

    const migrated = normalizeLoadedPlan(legacy);
    const migratedSocket = activeVariant(migrated).channels.find((channel) => channel.id === socket.id)!;
    expect(migrated.schemaVersion).toBe("1.7.0");
    expect(migrated.geometryGeneratorVersion).toBe("1.2.0");
    expect(migratedSocket.aperture).toEqual([11, 22, 33]);
    expect(migratedSocket.vector).toEqual([0.6, 0, 0.8]);
    expect(migratedSocket.depthMm).toBe(27.5);
    expect(migratedSocket.diameterMm).toBe(6.25);
    expect(migratedSocket.trajectoryControlMode).toBe("blind_socket_tip");
    expect(migratedSocket.endpointSurfaceAttachment).toBeNull();
    expect(migratedSocket.surfacePlacement?.endpointMethod).toBe("blind_socket_tip");
    expect(migratedSocket.guidePin).toEqual({
      diameterMm: 3.5,
      provenance: "generic_parametric_visual_seed",
    });
    expect(migratedSocket.layers.every((layer) => layer.geometryGeneratorVersion === "1.2.0")).toBe(true);
    expect(migrated.audit.at(-1)?.action).toContain("Migrated plan schema 1.6.0 to 1.7.0");
  });
});
