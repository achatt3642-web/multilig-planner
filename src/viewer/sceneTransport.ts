import type { ViewerMeshPayload, ViewerPlanningScene } from "./types";

export interface PreparedViewerSceneTransport {
  payload: ViewerPlanningScene;
  anatomySignature: string;
  anatomyPreserved: boolean;
}

const matrixFingerprintCache = new WeakMap<object, string>();
const floatScratch = new DataView(new ArrayBuffer(8));

function mixByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, 0x01000193) >>> 0;
}

function matrixFingerprint(matrix: number[][]): string {
  const cached = matrixFingerprintCache.get(matrix);
  if (cached) return cached;

  let firstHash = 0x811c9dc5;
  let secondHash = 0x9e3779b9;
  let valueCount = 0;
  for (const row of matrix) {
    firstHash = mixByte(firstHash, row.length & 0xff);
    secondHash = mixByte(secondHash, (row.length >>> 8) & 0xff);
    for (const rawValue of row) {
      const value = Number(rawValue);
      floatScratch.setFloat64(0, value, true);
      for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
        const byte = floatScratch.getUint8(byteIndex);
        firstHash = mixByte(firstHash, byte);
        secondHash = mixByte(secondHash, byte ^ ((valueCount + byteIndex) & 0xff));
      }
      valueCount += 1;
    }
    firstHash = mixByte(firstHash, 0xff);
    secondHash = mixByte(secondHash, 0x7f);
  }
  const fingerprint = [
    matrix.length,
    valueCount,
    firstHash.toString(16).padStart(8, "0"),
    secondHash.toString(16).padStart(8, "0"),
  ].join(":");
  // Geometry arrays are immutable planning artifacts. Caching by identity
  // keeps slider/drag updates O(number of anatomy meshes), not O(vertices).
  matrixFingerprintCache.set(matrix, fingerprint);
  return fingerprint;
}

function anatomyMeshFingerprint(mesh: ViewerMeshPayload): string {
  return JSON.stringify({
    id: mesh.id,
    name: mesh.name,
    vertices: matrixFingerprint(mesh.vertices),
    faces: matrixFingerprint(mesh.faces),
    color: mesh.color,
    opacity: mesh.opacity,
    layer: mesh.layer,
    channelId: mesh.channelId ?? null,
    anatomyBone: mesh.anatomyBone ?? null,
    analysisCategory: mesh.analysisCategory ?? null,
    materialStyle: mesh.materialStyle ?? null,
    fiberPaths: mesh.fiberPaths?.map((path) => matrixFingerprint(path)) ?? null,
  });
}

/**
 * Fingerprints the exact anatomy payload while caching immutable vertex/face
 * arrays. Mesh order remains part of the signature because transparent Viewer
 * draw order is presentation-significant.
 */
export function viewerAnatomySignature(scene: ViewerPlanningScene): string {
  return scene.meshes
    .filter((mesh) => mesh.layer === "bones")
    .map(anatomyMeshFingerprint)
    .join("|");
}

/**
 * Sends a complete first scene, then strips unchanged bone payloads from later
 * iframe messages. A changed fingerprint automatically restores a full update.
 */
export function prepareViewerSceneTransport(
  scene: ViewerPlanningScene,
  previousAnatomySignature: string | null,
): PreparedViewerSceneTransport {
  const anatomySignature = viewerAnatomySignature(scene);
  const anatomyPreserved = previousAnatomySignature !== null &&
    previousAnatomySignature === anatomySignature;
  return {
    payload: {
      ...scene,
      preserveAnatomy: anatomyPreserved,
      anatomySignature,
      meshes: anatomyPreserved
        ? scene.meshes.filter((mesh) => mesh.layer !== "bones")
        : scene.meshes,
    },
    anatomySignature,
    anatomyPreserved,
  };
}
