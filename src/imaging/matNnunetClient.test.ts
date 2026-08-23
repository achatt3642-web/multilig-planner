import { describe, expect, it, vi } from "vitest";
import { MatNnunetClient } from "./matNnunetClient";
import {
  TEST_JOB_ID,
  TEST_SOURCE_SHA256,
  bridgeCapabilitiesFixture,
  bridgeJobFixture,
  bridgeManifestFixture,
} from "./matNnunetTestFixtures";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("loopback MAT nnUNet client", () => {
  it("refuses non-loopback service origins", () => {
    expect(() => new MatNnunetClient({ baseUrl: "https://segmentation.example.test" })).toThrow(/loopback/i);
    expect(() => new MatNnunetClient({ baseUrl: "http://127.0.0.1:4190/unsafe" })).toThrow(/only an origin/i);
  });

  it("loads and validates capabilities from the fixed endpoint", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(bridgeCapabilitiesFixture()));
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });
    const capabilities = await client.getCapabilities();
    expect(capabilities.validationState).toBe("research_only");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:4190/api/segmentation/capabilities",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        headers: expect.objectContaining({ "X-Multilig-Client": "1" }),
      }),
    );
  });

  it("uploads bytes under a generic filename and never sends a local path", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(bridgeJobFixture("queued")));
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.createJob({
      source: new Blob(["abc"], { type: "application/gzip" }),
      sourceKind: "dicom_tar_gz",
      sourceSha256: TEST_SOURCE_SHA256,
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as FormData;
    expect(url).toBe("http://127.0.0.1:4190/api/segmentation/jobs");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-Multilig-Client": "1" });
    expect(body.get("source_kind")).toBe("dicom_tar_gz");
    expect(body.get("source_sha256")).toBe(TEST_SOURCE_SHA256);
    expect(body.get("source_byte_length")).toBe("3");
    expect((body.get("source") as File).name).toBe("deidentified-source.tar.gz");
    expect([...body.keys()]).not.toContain("sourcePath");
  });

  it("lets the service hash a large source without materializing it in browser memory", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(bridgeJobFixture("queued")));
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });
    const source = new Blob(["abc"], { type: "application/gzip" });
    const arrayBuffer = vi.spyOn(source, "arrayBuffer").mockRejectedValue(new Error("must not materialize"));

    await client.createJob({ source, sourceKind: "dicom_tar_gz" });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as FormData;
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(body.get("source_sha256")).toBeNull();
    expect(body.get("source_byte_length")).toBe("3");
  });

  it("polls queued/running jobs and verifies the completed immutable source", async () => {
    const manifest = structuredClone(bridgeManifestFixture());
    manifest.source.byteLength = 3;
    let polls = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse(bridgeJobFixture("queued"));
      polls += 1;
      return polls === 1
        ? jsonResponse(bridgeJobFixture("running"))
        : jsonResponse(bridgeJobFixture("completed", manifest));
    });
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });
    await client.createJob({
      source: new Blob(["abc"]),
      sourceKind: "dicom_tar_gz",
      sourceSha256: TEST_SOURCE_SHA256,
    });
    const updates: string[] = [];
    const completed = await client.waitForTerminalJob(TEST_JOB_ID, {
      intervalMs: 0,
      timeoutMs: 1000,
      onUpdate: (job) => updates.push(job.status),
    });
    expect(completed.status).toBe("completed");
    expect(updates).toEqual(["running", "completed"]);
    expect(fetchImpl.mock.calls.slice(1).every(([, init]) => (
      init?.headers as Record<string, string>
    )["X-Multilig-Client"] === "1")).toBe(true);
  });

  it("fetches opaque artifact bytes in memory and verifies length and SHA-256", async () => {
    const bytes = new TextEncoder().encode("abc");
    const artifactId = `asset-sha256-${"d".repeat(64)}`;
    const fetchImpl = vi.fn(async () => new Response(bytes));
    const client = new MatNnunetClient({ fetchImpl: fetchImpl as typeof fetch });
    const result = await client.getArtifact({
      artifactId,
      expectedByteLength: 3,
      expectedSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(new TextDecoder().decode(result)).toBe("abc");
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:4190/api/segmentation/assets/${artifactId}`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: expect.objectContaining({ "X-Multilig-Client": "1" }),
      }),
    );

    await expect(client.getArtifact({
      artifactId: "../private",
      expectedByteLength: 3,
      expectedSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    })).rejects.toThrow(/opaque/i);

    await expect(client.getArtifact({
      artifactId,
      expectedByteLength: 129 * 1024 * 1024,
      expectedSha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    })).rejects.toThrow(/browser review limit/i);
  });
});
