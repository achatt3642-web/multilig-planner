import type { ViewerLayer, ViewerMeshPayload } from "../viewer/types";
import { parseMatNnunetMatrix4, type MatNnunetMatrix4 } from "./matNnunetTypes";

export interface StlViewerMeshOptions {
  id: string;
  name: string;
  transformToPatientRas: MatNnunetMatrix4;
  color?: string;
  opacity?: number;
  layer?: ViewerLayer;
  maxBytes?: number;
  maxTriangles?: number;
}

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_TRIANGLES = 500_000;
const ABSOLUTE_MAX_TRIANGLES = 2_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface MeshBuilder {
  vertices: number[][];
  faces: number[][];
  transform: MatNnunetMatrix4;
  maxTriangles: number;
}

function positiveBound(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return result;
}

function transformedPoint(point: readonly [number, number, number], matrix: MatNnunetMatrix4): number[] {
  const [x, y, z] = point;
  const w = matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15];
  if (!Number.isFinite(w) || Math.abs(w) <= 1e-12) throw new Error("STL vertex has an invalid homogeneous transform");
  const transformed = [
    (matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3]) / w,
    (matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7]) / w,
    (matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11]) / w,
  ];
  if (transformed.some((value) => !Number.isFinite(value))) throw new Error("STL vertex transforms to a non-finite patient-space point");
  return transformed;
}

function appendTriangle(builder: MeshBuilder, triangle: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]): void {
  if (builder.faces.length >= builder.maxTriangles) throw new Error("STL exceeds the configured triangle limit");
  const start = builder.vertices.length;
  builder.vertices.push(...triangle.map((point) => transformedPoint(point, builder.transform)));
  builder.faces.push([start, start + 1, start + 2]);
}

function finiteFloat(value: number, context: string): number {
  if (!Number.isFinite(value)) throw new Error(`${context} must be finite`);
  return value;
}

function binaryTriangleCount(bytes: ArrayBuffer): number | null {
  if (bytes.byteLength < 84) return null;
  const count = new DataView(bytes).getUint32(80, true);
  const expectedLength = 84 + count * 50;
  return Number.isSafeInteger(expectedLength) && expectedLength === bytes.byteLength ? count : null;
}

function parseBinary(bytes: ArrayBuffer, builder: MeshBuilder, triangleCount: number): void {
  if (triangleCount <= 0) throw new Error("Binary STL contains no triangles");
  if (triangleCount > builder.maxTriangles) throw new Error("STL exceeds the configured triangle limit");
  const view = new DataView(bytes);
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const facetOffset = 84 + triangleIndex * 50;
    const points = [0, 1, 2].map((vertexIndex): [number, number, number] => {
      const offset = facetOffset + 12 + vertexIndex * 12;
      return [
        finiteFloat(view.getFloat32(offset, true), `Binary STL triangle ${triangleIndex} x`),
        finiteFloat(view.getFloat32(offset + 4, true), `Binary STL triangle ${triangleIndex} y`),
        finiteFloat(view.getFloat32(offset + 8, true), `Binary STL triangle ${triangleIndex} z`),
      ];
    }) as [[number, number, number], [number, number, number], [number, number, number]];
    appendTriangle(builder, points);
  }
}

function asciiVector(tokens: string[], offset: number, context: string): [number, number, number] {
  if (tokens.length !== offset + 3) throw new Error(`${context} must contain exactly three coordinates`);
  return [0, 1, 2].map((index) => {
    const value = Number(tokens[offset + index]);
    return finiteFloat(value, `${context}[${index}]`);
  }) as [number, number, number];
}

function parseAscii(bytes: ArrayBuffer, builder: MeshBuilder): void {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("STL is neither canonical binary STL nor valid UTF-8 ASCII STL");
  }
  const lines = text.split(/\r?\n/);
  let state: "outside" | "facet" | "loop" | "vertices" | "loop-ended" = "outside";
  let current: [number, number, number][] = [];
  let sawSolid = false;
  let sawEndSolid = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const keyword = tokens[0].toLowerCase();
    const context = `ASCII STL line ${lineIndex + 1}`;
    if (keyword === "solid") {
      if (state !== "outside" || sawSolid) throw new Error(`${context} has an unexpected solid declaration`);
      sawSolid = true;
    } else if (keyword === "endsolid") {
      if (state !== "outside" || !sawSolid || sawEndSolid) throw new Error(`${context} has an unexpected endsolid declaration`);
      sawEndSolid = true;
    } else if (keyword === "facet") {
      if (state !== "outside" || sawEndSolid || tokens[1]?.toLowerCase() !== "normal") {
        throw new Error(`${context} has an unexpected facet declaration`);
      }
      asciiVector(tokens, 2, `${context} normal`);
      current = [];
      state = "facet";
    } else if (keyword === "outer" && tokens[1]?.toLowerCase() === "loop") {
      if (state !== "facet" || tokens.length !== 2) throw new Error(`${context} has an unexpected outer loop`);
      state = "loop";
    } else if (keyword === "vertex") {
      if (state !== "loop" && state !== "vertices") throw new Error(`${context} has an unexpected vertex`);
      if (current.length >= 3) throw new Error(`${context} adds more than three facet vertices`);
      current.push(asciiVector(tokens, 1, `${context} vertex`));
      state = "vertices";
    } else if (keyword === "endloop") {
      if (state !== "vertices" || current.length !== 3 || tokens.length !== 1) {
        throw new Error(`${context} ends an incomplete facet loop`);
      }
      state = "loop-ended";
    } else if (keyword === "endfacet") {
      if (state !== "loop-ended" || tokens.length !== 1) throw new Error(`${context} has an unexpected endfacet`);
      appendTriangle(builder, current as [
        [number, number, number],
        [number, number, number],
        [number, number, number],
      ]);
      state = "outside";
    } else {
      throw new Error(`${context} contains unsupported STL syntax`);
    }
  }
  if (state !== "outside") throw new Error("ASCII STL ends inside an incomplete facet");
  if (sawSolid !== sawEndSolid) throw new Error("ASCII STL has unmatched solid/endsolid declarations");
  if (builder.faces.length === 0) throw new Error("ASCII STL contains no triangles");
}

/** Parse an in-memory STL and map every vertex into patient RAS millimetres. */
export function parseStlToViewerMesh(bytes: ArrayBuffer, options: StlViewerMeshOptions): ViewerMeshPayload {
  const maxBytes = positiveBound(options.maxBytes, DEFAULT_MAX_BYTES, ABSOLUTE_MAX_BYTES, "maxBytes");
  const maxTriangles = positiveBound(
    options.maxTriangles,
    DEFAULT_MAX_TRIANGLES,
    ABSOLUTE_MAX_TRIANGLES,
    "maxTriangles",
  );
  if (bytes.byteLength === 0) throw new Error("STL is empty");
  if (bytes.byteLength > maxBytes) throw new Error("STL exceeds the configured byte limit");
  if (!SAFE_ID.test(options.id)) throw new Error("Viewer mesh id must be an opaque identifier");
  if (!options.name.trim() || options.name.length > 128) throw new Error("Viewer mesh name is invalid");
  const color = options.color ?? "#d7dee0";
  if (!HEX_COLOR.test(color)) throw new Error("Viewer mesh color must be a six-digit hex color");
  const opacity = options.opacity ?? 0.72;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error("Viewer mesh opacity must be between zero and one");
  const transform = parseMatNnunetMatrix4(options.transformToPatientRas, "STL mesh transformToPatientRas");
  const builder: MeshBuilder = { vertices: [], faces: [], transform, maxTriangles };
  const count = binaryTriangleCount(bytes);
  if (count === null) parseAscii(bytes, builder);
  else parseBinary(bytes, builder, count);
  return {
    id: options.id,
    name: options.name,
    vertices: builder.vertices,
    faces: builder.faces,
    color: color.toLowerCase(),
    opacity,
    layer: options.layer ?? "bones",
    analysisCategory: "segmented_anatomy_research_only",
  };
}
