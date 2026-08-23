import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareViewerSceneTransport, viewerAnatomySignature } from "./sceneTransport";
import type { ViewerMeshPayload, ViewerPlanningScene } from "./types";

function mesh(
  id: string,
  layer: ViewerMeshPayload["layer"],
  vertices: number[][],
  color = "#ffffff",
): ViewerMeshPayload {
  return {
    id,
    name: id,
    vertices,
    faces: [[0, 1, 2]],
    color,
    opacity: 0.5,
    layer,
    anatomyBone: layer === "bones" ? "femur" : undefined,
  };
}

function scene(meshes: ViewerMeshPayload[], revision = 1): ViewerPlanningScene {
  return {
    type: "multilig_planning_scene",
    revision,
    meshes,
    lines: [],
    handles: [],
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
    selectedChannelId: null,
  };
}

describe("Viewer v2 scene transport", () => {
  const boneVertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];

  it("sends full anatomy first and omits unchanged bones from dynamic edits", () => {
    const firstScene = scene([
      mesh("femur", "bones", boneVertices),
      mesh("acl-socket", "boneRemoval", [[0, 0, 0], [0, 0, 1], [0, 1, 0]]),
    ]);
    const first = prepareViewerSceneTransport(firstScene, null);
    expect(first.anatomyPreserved).toBe(false);
    expect(first.payload.preserveAnatomy).toBe(false);
    expect(first.payload.meshes.map(({ id }) => id)).toEqual(["femur", "acl-socket"]);

    const editedScene = scene([
      mesh("femur", "bones", boneVertices),
      mesh("acl-socket", "boneRemoval", [[0, 0, 0], [0, 0, 2], [0, 1, 0]]),
    ], 2);
    const edited = prepareViewerSceneTransport(editedScene, first.anatomySignature);
    expect(edited.anatomyPreserved).toBe(true);
    expect(edited.payload.preserveAnatomy).toBe(true);
    expect(edited.payload.anatomySignature).toBe(first.anatomySignature);
    expect(edited.payload.meshes.map(({ id }) => id)).toEqual(["acl-socket"]);
    expect(firstScene.preserveAnatomy).toBeUndefined();
  });

  it("forces a full scene when anatomy geometry or presentation changes", () => {
    const baseline = scene([mesh("femur", "bones", boneVertices)]);
    const signature = viewerAnatomySignature(baseline);
    const changedGeometry = prepareViewerSceneTransport(
      scene([mesh("femur", "bones", [[0, 0, 0], [2, 0, 0], [0, 1, 0]])], 2),
      signature,
    );
    expect(changedGeometry.anatomyPreserved).toBe(false);
    expect(changedGeometry.payload.meshes).toHaveLength(1);

    const changedMaterial = prepareViewerSceneTransport(
      scene([mesh("femur", "bones", boneVertices, "#ccddee")], 3),
      signature,
    );
    expect(changedMaterial.anatomyPreserved).toBe(false);
  });

  it("binds partial Viewer updates to the exact retained anatomy signature", () => {
    const source = readFileSync(
      new URL("../../public/mat-viewer-v2.html", import.meta.url),
      "utf8",
    );
    expect(source).toContain('multiligPostToParent({ type: "multilig_anatomy_refresh_required" });');
    expect(source).toContain("requestedAnatomySignature !== multiligAnatomySignature");
  });

  it("places M and L on their directly projected patient-space sides", () => {
    const source = readFileSync(
      new URL("../../public/mat-viewer-v2.html", import.meta.url),
      "utf8",
    );
    expect(source).toContain("medialOnLeft = medialProjected.x < lateralProjected.x;");
    expect(source).not.toContain("medialOnLeft = medialProjected.x > lateralProjected.x;");
  });
});
