import { describe, expect, it } from "vitest";
import { parseStlToViewerMesh } from "./stlToViewerMesh";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function asciiStl(triangles = 1): ArrayBuffer {
  const facets = Array.from({ length: triangles }, (_, index) => `
facet normal 0 0 1
  outer loop
    vertex ${index} 0 0
    vertex ${index + 1} 0 0
    vertex ${index} 1 0
  endloop
endfacet`).join("");
  return new TextEncoder().encode(`solid knee${facets}\nendsolid knee`).buffer as ArrayBuffer;
}

function binaryStl(point: [number, number, number] = [0, 0, 0]): ArrayBuffer {
  const bytes = new ArrayBuffer(84 + 50);
  const view = new DataView(bytes);
  const header = new TextEncoder().encode("solid binary-header-is-valid");
  new Uint8Array(bytes).set(header.slice(0, 80));
  view.setUint32(80, 1, true);
  const vertices: [number, number, number][] = [point, [1, 0, 0], [0, 1, 0]];
  vertices.forEach((vertex, vertexIndex) => {
    const offset = 84 + 12 + vertexIndex * 12;
    view.setFloat32(offset, vertex[0], true);
    view.setFloat32(offset + 4, vertex[1], true);
    view.setFloat32(offset + 8, vertex[2], true);
  });
  return bytes;
}

describe("STL to Viewer v2 mesh", () => {
  it("parses strict ASCII STL and transforms vertices into patient RAS millimetres", () => {
    const transform = [
      1, 0, 0, 10,
      0, 1, 0, 20,
      0, 0, 1, 30,
      0, 0, 0, 1,
    ] as const;
    const mesh = parseStlToViewerMesh(asciiStl(), {
      id: "femur-segmentation",
      name: "Femur",
      transformToPatientRas: transform,
    });
    expect(mesh.vertices).toEqual([[10, 20, 30], [11, 20, 30], [10, 21, 30]]);
    expect(mesh.faces).toEqual([[0, 1, 2]]);
    expect(mesh.layer).toBe("bones");
    expect(mesh.analysisCategory).toBe("segmented_anatomy_research_only");
  });

  it("uses the binary triangle table even when its header starts with solid", () => {
    const mesh = parseStlToViewerMesh(binaryStl(), {
      id: "tibia-segmentation",
      name: "Tibia",
      transformToPatientRas: identity,
      color: "#ABCDEF",
      opacity: 0.5,
    });
    expect(mesh.vertices).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    expect(mesh.faces).toEqual([[0, 1, 2]]);
    expect(mesh.color).toBe("#abcdef");
    expect(mesh.opacity).toBe(0.5);
  });

  it("rejects malformed, non-finite, oversized, and over-complex STL input", () => {
    const malformed = new TextEncoder().encode("solid knee\nvertex 0 0 0\nendsolid knee").buffer as ArrayBuffer;
    expect(() => parseStlToViewerMesh(malformed, {
      id: "bad-mesh",
      name: "Bad",
      transformToPatientRas: identity,
    })).toThrow(/unexpected vertex/i);

    expect(() => parseStlToViewerMesh(binaryStl([Number.NaN, 0, 0]), {
      id: "bad-binary",
      name: "Bad binary",
      transformToPatientRas: identity,
    })).toThrow(/finite/i);

    expect(() => parseStlToViewerMesh(asciiStl(2), {
      id: "too-many",
      name: "Too many",
      transformToPatientRas: identity,
      maxTriangles: 1,
    })).toThrow(/triangle limit/i);

    expect(() => parseStlToViewerMesh(asciiStl(), {
      id: "too-large",
      name: "Too large",
      transformToPatientRas: identity,
      maxBytes: 10,
    })).toThrow(/byte limit/i);
  });
});
