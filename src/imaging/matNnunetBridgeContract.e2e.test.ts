import { describe, expect, it, vi } from "vitest";
import { segmentationPlanPatch } from "./applySegmentationResult";
import { MatNnunetClient } from "./matNnunetClient";
import {
  TEST_SOURCE_SHA256,
  bridgeCapabilitiesFixture,
  bridgeJobFixture,
  bridgeManifestFixture,
} from "./matNnunetTestFixtures";
import { parseMatViewerMeshArtifactBytes } from "./matViewerMeshArtifact";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const value = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

describe("frozen Python bridge to Viewer v2 contract", () => {
  it("accepts Python-native capabilities/job/result dictionaries and a hashed JSON mesh", async () => {
    const meshPayload = {
      schemaVersion: "mat-viewer-mesh.v1",
      bone: "femur",
      frameId: "mesh-patient-ras",
      units: "mm",
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      faces: [[0, 1, 2]],
      quality: { vertexCount: 3, triangleCount: 1, reviewStatus: "unreviewed" },
    };
    const meshBytes = new TextEncoder().encode(JSON.stringify(meshPayload));
    const manifest = bridgeManifestFixture();
    manifest.source.byteLength = 3;
    const femur = manifest.bones.find((bone: { bone: string }) => bone.bone === "femur");
    const meshArtifact = manifest.artifacts.find((artifact: { assetId: string }) => artifact.assetId === femur.viewerMeshAssetId);
    meshArtifact.sha256 = await digest(meshBytes);
    meshArtifact.assetId = `asset-sha256-${meshArtifact.sha256}`;
    meshArtifact.url = `/api/segmentation/assets/${meshArtifact.assetId}`;
    femur.viewerMeshAssetId = meshArtifact.assetId;
    meshArtifact.byteLength = meshBytes.byteLength;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/segmentation/capabilities")) return json(bridgeCapabilitiesFixture());
      if (url.endsWith("/api/segmentation/jobs") && init?.method === "POST") return json(bridgeJobFixture("queued"));
      if (url.includes("/api/segmentation/jobs/")) return json(bridgeJobFixture("completed", manifest));
      if (url.endsWith(`/api/segmentation/assets/${meshArtifact.assetId}`)) return new Response(meshBytes);
      return new Response(null, { status: 404 });
    });
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });

    const capabilities = await client.getCapabilities();
    expect(capabilities).toMatchObject({
      adapterId: "mat-planner-knee-bone-masker-nnunetv2",
      validationState: "research_only",
      accepts: ["dicom_tar_gz", "nifti"],
    });
    const queued = await client.createJob({
      source: new Blob(["abc"]),
      sourceKind: "dicom_tar_gz",
      sourceSha256: TEST_SOURCE_SHA256,
    });
    const completed = await client.waitForTerminalJob(queued.jobId, { intervalMs: 0, timeoutMs: 1000 });
    expect(completed.status).toBe("completed");

    const patch = segmentationPlanPatch(completed.result);
    expect(patch.segmentationValidationState).toBe("research_only");
    expect(patch.unavailableRequiredBones).toEqual([
      expect.objectContaining({ bone: "fibula", status: "missing" }),
    ]);
    const femurArtifact = patch.artifacts.find((artifact) => artifact.bone === "femur" && artifact.mediaType === "application/json")!;
    const artifactBytes = await client.getArtifact({
      artifactId: femurArtifact.serviceArtifactId,
      expectedSha256: femurArtifact.sha256,
      expectedByteLength: femurArtifact.byteLength,
    });
    const viewerMesh = parseMatViewerMeshArtifactBytes(artifactBytes, {
      id: femurArtifact.assetId,
      name: "Femur",
      expectedBone: "femur",
    });
    expect(viewerMesh.faces).toEqual([[0, 1, 2]]);
    expect(viewerMesh.analysisCategory).toBe("segmented_anatomy_research_only");
    expect(fetchImpl.mock.calls.every(([, init]) => (
      init?.headers as Record<string, string>
    )["X-Multilig-Client"] === "1")).toBe(true);
  });
});
