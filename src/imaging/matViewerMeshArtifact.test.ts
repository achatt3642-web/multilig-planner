import { describe, expect, it } from "vitest";
import { parseMatViewerMeshArtifact, parseMatViewerMeshArtifactBytes } from "./matViewerMeshArtifact";

function viewerMesh(): Record<string, unknown> {
  return {
    schemaVersion: "mat-viewer-mesh.v1",
    bone: "femur",
    frameId: "mesh-patient-ras",
    units: "mm",
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    faces: [[0, 1, 2]],
    quality: {
      vertexCount: 3,
      triangleCount: 1,
      watertight: false,
      manifold: true,
      reviewStatus: "unreviewed",
    },
  };
}

const options = {
  id: "segmented-femur",
  name: "Femur",
  expectedBone: "femur" as const,
};

describe("MAT JSON viewer mesh artifact", () => {
  it("parses bounded patient-RAS millimetre geometry into Viewer v2", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(viewerMesh())).buffer as ArrayBuffer;
    const mesh = parseMatViewerMeshArtifactBytes(bytes, options);
    expect(mesh).toMatchObject({
      id: "segmented-femur",
      name: "Femur",
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      faces: [[0, 1, 2]],
      layer: "bones",
      analysisCategory: "segmented_anatomy_research_only",
    });
  });

  it("rejects non-finite vertices, invalid indices, mismatched bones, and verified quality", () => {
    const nonFinite = viewerMesh();
    nonFinite.vertices = [[Number.NaN, 0, 0], [1, 0, 0], [0, 1, 0]];
    expect(() => parseMatViewerMeshArtifact(nonFinite, options)).toThrow(/finite/i);

    const outOfRange = viewerMesh();
    outOfRange.faces = [[0, 1, 3]];
    expect(() => parseMatViewerMeshArtifact(outOfRange, options)).toThrow(/out of range/i);

    const wrongBone = viewerMesh();
    wrongBone.bone = "tibia";
    expect(() => parseMatViewerMeshArtifact(wrongBone, options)).toThrow(/does not match/i);

    const preverified = viewerMesh();
    preverified.quality = { reviewStatus: "approved" };
    expect(() => parseMatViewerMeshArtifact(preverified, options)).toThrow(/unreviewed/i);
  });

  it("enforces patient-RAS/mm/schema and byte/count limits", () => {
    const wrongFrame = viewerMesh();
    wrongFrame.frameId = "model-local";
    expect(() => parseMatViewerMeshArtifact(wrongFrame, options)).toThrow(/patient-RAS/i);

    const tooMany = viewerMesh();
    tooMany.faces = [[0, 1, 2], [0, 2, 1]];
    expect(() => parseMatViewerMeshArtifact(tooMany, { ...options, maxTriangles: 1 })).toThrow(/triangle limit/i);

    const bytes = new TextEncoder().encode(JSON.stringify(viewerMesh())).buffer as ArrayBuffer;
    expect(() => parseMatViewerMeshArtifactBytes(bytes, { ...options, maxBytes: 10 })).toThrow(/byte limit/i);
  });
});
