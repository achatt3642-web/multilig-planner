import type { ViewerLayer, ViewerMeshPayload } from "../viewer/types";
import type { MatNnunetBoneLabel } from "./matNnunetTypes";

export const MAT_VIEWER_MESH_SCHEMA = "mat-viewer-mesh.v1" as const;

export interface MatViewerMeshOptions {
  id: string;
  name: string;
  expectedBone: MatNnunetBoneLabel;
  color?: string;
  opacity?: number;
  layer?: ViewerLayer;
  maxBytes?: number;
  maxVertices?: number;
  maxTriangles?: number;
}

const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const MAX_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_VERTICES = 1_000_000;
const DEFAULT_MAX_TRIANGLES = 500_000;
const MAX_MAX_ELEMENTS = 2_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BONES = new Set<MatNnunetBoneLabel>(["femur", "tibia", "fibula"]);

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function bound(value: number | undefined, fallback: number, maximum: number, context: string): number {
  const parsed = value ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${context} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}

function finiteVector(value: unknown, context: string): number[] {
  const entries = array(value, context);
  if (entries.length !== 3) throw new Error(`${context} must contain exactly three coordinates`);
  return entries.map((entry, index) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new Error(`${context}[${index}] must be finite`);
    return entry;
  });
}

function parseOptions(options: MatViewerMeshOptions): Required<Pick<MatViewerMeshOptions, "id" | "name" | "expectedBone">> & {
  color: string;
  opacity: number;
  layer: ViewerLayer;
  maxVertices: number;
  maxTriangles: number;
} {
  if (!SAFE_ID.test(options.id)) throw new Error("Viewer mesh id must be an opaque identifier");
  if (!options.name.trim() || options.name.length > 128) throw new Error("Viewer mesh name is invalid");
  if (!BONES.has(options.expectedBone)) throw new Error("Expected bone label is invalid");
  const color = options.color ?? "#d7dee0";
  if (!HEX_COLOR.test(color)) throw new Error("Viewer mesh color must be a six-digit hex color");
  const opacity = options.opacity ?? 0.72;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error("Viewer mesh opacity must be between zero and one");
  return {
    id: options.id,
    name: options.name,
    expectedBone: options.expectedBone,
    color: color.toLowerCase(),
    opacity,
    layer: options.layer ?? "bones",
    maxVertices: bound(options.maxVertices, DEFAULT_MAX_VERTICES, MAX_MAX_ELEMENTS, "maxVertices"),
    maxTriangles: bound(options.maxTriangles, DEFAULT_MAX_TRIANGLES, MAX_MAX_ELEMENTS, "maxTriangles"),
  };
}

/** Validate the bridge's patient-RAS JSON mesh and create a Viewer v2 payload. */
export function parseMatViewerMeshArtifact(value: unknown, options: MatViewerMeshOptions): ViewerMeshPayload {
  const parsedOptions = parseOptions(options);
  const item = record(value, "MAT viewer mesh");
  if (item.schemaVersion !== MAT_VIEWER_MESH_SCHEMA) throw new Error("Unsupported MAT viewer mesh schema version");
  if (item.units !== "mm") throw new Error("MAT viewer mesh units must be mm");
  if (item.frameId !== "mesh-patient-ras") throw new Error("MAT viewer mesh must be in the patient-RAS mesh frame");
  if (typeof item.bone !== "string" || !BONES.has(item.bone as MatNnunetBoneLabel)) {
    throw new Error("MAT viewer mesh bone label is invalid");
  }
  if (item.bone !== parsedOptions.expectedBone) throw new Error("MAT viewer mesh bone does not match the requested anatomy object");

  const rawVertices = array(item.vertices, "MAT viewer mesh.vertices");
  if (rawVertices.length === 0) throw new Error("MAT viewer mesh contains no vertices");
  if (rawVertices.length > parsedOptions.maxVertices) throw new Error("MAT viewer mesh exceeds the configured vertex limit");
  const vertices = rawVertices.map((vertex, index) => finiteVector(vertex, `MAT viewer mesh.vertices[${index}]`));

  const rawFaces = array(item.faces, "MAT viewer mesh.faces");
  if (rawFaces.length === 0) throw new Error("MAT viewer mesh contains no faces");
  if (rawFaces.length > parsedOptions.maxTriangles) throw new Error("MAT viewer mesh exceeds the configured triangle limit");
  const faces = rawFaces.map((face, faceIndex) => {
    const indices = array(face, `MAT viewer mesh.faces[${faceIndex}]`);
    if (indices.length !== 3) throw new Error(`MAT viewer mesh.faces[${faceIndex}] must be triangular`);
    const parsed = indices.map((index, vertexIndex) => {
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= vertices.length) {
        throw new Error(`MAT viewer mesh.faces[${faceIndex}][${vertexIndex}] is out of range`);
      }
      return index;
    });
    if (new Set(parsed).size !== 3) throw new Error(`MAT viewer mesh.faces[${faceIndex}] is degenerate`);
    return parsed;
  });

  const quality = record(item.quality, "MAT viewer mesh.quality");
  if (quality.reviewStatus !== "unreviewed") throw new Error("MAT viewer mesh quality must remain unreviewed");
  if (quality.vertexCount !== vertices.length || quality.triangleCount !== faces.length) {
    throw new Error("MAT viewer mesh quality counts do not match its geometry");
  }
  return {
    id: parsedOptions.id,
    name: parsedOptions.name,
    vertices,
    faces,
    color: parsedOptions.color,
    opacity: parsedOptions.opacity,
    layer: parsedOptions.layer,
    analysisCategory: "segmented_anatomy_research_only",
  };
}

/** Decode bounded artifact bytes without persisting the response or its URL. */
export function parseMatViewerMeshArtifactBytes(bytes: ArrayBuffer, options: MatViewerMeshOptions): ViewerMeshPayload {
  const maxBytes = bound(options.maxBytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES, "maxBytes");
  if (bytes.byteLength === 0) throw new Error("MAT viewer mesh artifact is empty");
  if (bytes.byteLength > maxBytes) throw new Error("MAT viewer mesh artifact exceeds the configured byte limit");
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("MAT viewer mesh artifact is not valid UTF-8 JSON");
  }
  return parseMatViewerMeshArtifact(value, options);
}
