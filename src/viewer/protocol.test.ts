import { describe, expect, it } from "vitest";
import { parseViewerHandleChange } from "./protocol";
import type { ViewerPlanningScene } from "./types";

describe("MAT Viewer v2 adapter protocol", () => {
  it("accepts finite preview and commit edits without changing clinical handle kinds", () => {
    expect(parseViewerHandleChange({
      type: "multilig_handle_change",
      channelId: "acl-femoral",
      kind: "aperture",
      position: [12.5, -4, 83.2],
      phase: "preview",
    })).toEqual({
      channelId: "acl-femoral",
      kind: "aperture",
      position: [12.5, -4, 83.2],
      phase: "preview",
    });

    expect(parseViewerHandleChange({
      type: "multilig_handle_change",
      channelId: "acl-femoral",
      kind: "endpoint",
      position: ["10", "20", "30"],
      phase: "commit",
    })?.kind).toBe("endpoint");
  });

  it("rejects malformed patient-space edits at the iframe boundary", () => {
    expect(parseViewerHandleChange({
      type: "multilig_handle_change",
      channelId: "acl-femoral",
      kind: "unknown",
      position: [1, 2, 3],
      phase: "commit",
    })).toBeNull();
    expect(parseViewerHandleChange({
      type: "multilig_handle_change",
      channelId: "acl-femoral",
      kind: "aperture",
      position: [1, Number.NaN, 3],
      phase: "commit",
    })).toBeNull();
    expect(parseViewerHandleChange({
      type: "multilig_handle_change",
      channelId: "acl-femoral",
      kind: "aperture",
      position: [1, 2, 3],
      phase: "unexpected",
    })).toBeNull();
  });

  it("types patient-RAS labels, semantic handles, surface constraints, and anatomy identity", () => {
    const scene: ViewerPlanningScene = {
      type: "multilig_planning_scene",
      revision: 4,
      meshes: [{
        id: "patient-femur",
        name: "Femur",
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces: [[0, 1, 2]],
        color: "#d8e2e4",
        opacity: 0.72,
        layer: "bones",
        anatomyBone: "femur",
      }, {
        id: "reconstructed-graft:acl:single",
        name: "ACL reconstructed graft · planning preview",
        vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        faces: [[0, 1, 2]],
        color: "#f3c5cf",
        opacity: 0.58,
        layer: "grafts",
        channelId: "acl-femoral",
        analysisCategory: "reconstructed_ligament_preview",
        materialStyle: "biologic_graft",
        fiberPaths: [
          [[0, 0, 0], [0.5, 0.1, 0], [1, 0, 0]],
          [[0, 0.2, 0], [0.5, 0.3, 0], [1, 0.2, 0]],
        ],
      }],
      lines: [],
      handles: [{
        id: "acl-entry",
        channelId: "acl-femoral",
        kind: "aperture",
        semanticRole: "entry",
        position: [12.5, -4, 83.2],
        surfaceNormalPatientRas: [0, 1, 0],
        color: "#ffffff",
        label: "ACL femoral entry",
        surfaceConstraint: { meshIds: ["patient-femur"], mode: "nearest_surface" },
      }, {
        id: "all-anchor-rod-end",
        channelId: "all-femoral-anchor",
        kind: "endpoint",
        semanticRole: "trajectory",
        position: [-28, 0, 0],
        color: "#f8ce63",
        label: "Trajectory - ALL femoral anchor socket/pilot",
        trajectoryPivotPatientRas: [0, 0, 0],
        trajectoryRadiusMm: 1,
      }],
      labels: [{
        id: "acl-label",
        text: "ACL femoral socket",
        position: [12.5, -4, 83.2],
        color: "#42d3c7",
        opacity: 0.78,
        sizeMm: 5,
        layer: "measurements",
        channelId: "acl-femoral",
      }],
      layerVisibility: {
        bones: true,
        landmarks: true,
        mri: false,
        boneRemoval: true,
        pins: true,
        access: true,
        deployment: true,
        grafts: true,
        hardware: true,
        previous: true,
        safety: true,
        measurements: true,
        ghost: true,
      },
      globalOpacity: 1,
      clipping: { enabled: false, axis: "z", offsetMm: 0, invert: false },
      crossSection: { enabled: false, axis: "z", offsetMm: 0 },
      orientationMarkers: { laterality: "right", verified: true },
      selectedChannelId: "acl-femoral",
    };

    expect(scene.labels?.[0].position).toEqual([12.5, -4, 83.2]);
    expect(scene.handles[0].surfaceConstraint?.meshIds).toEqual(["patient-femur"]);
    expect(scene.handles[0].surfaceConstraint?.mode).toBe("nearest_surface");
    expect(scene.handles[0].surfaceNormalPatientRas).toEqual([0, 1, 0]);
    expect(scene.handles[1].trajectoryPivotPatientRas).toEqual([0, 0, 0]);
    expect(scene.handles[1].semanticRole).toBe("trajectory");
    expect(scene.handles[1].surfaceConstraint).toBeUndefined();
    expect(scene.meshes[0].anatomyBone).toBe("femur");
    expect(scene.meshes[1].materialStyle).toBe("biologic_graft");
    expect(scene.meshes[1].fiberPaths?.[0]).toHaveLength(3);
    expect(scene.orientationMarkers).toEqual({ laterality: "right", verified: true });
  });
});
