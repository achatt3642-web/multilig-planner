import {
  parseMatNnunetCapabilities,
  parseMatNnunetJob,
  type MatNnunetCapabilities,
  type MatNnunetJob,
  type MatNnunetSourceKind,
} from "./matNnunetTypes";

export const MAT_NNUNET_DEFAULT_ORIGIN = "http://127.0.0.1:4190" as const;

export interface MatNnunetClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * The browser sends bytes only. A local filesystem path is deliberately not a
 * member of this contract, so renderer input cannot become an arbitrary-file
 * read primitive in the local Python bridge.
 */
export interface MatNnunetUploadRequest {
  source: Blob;
  sourceKind: MatNnunetSourceKind;
  sourceSha256?: string;
  signal?: AbortSignal;
}

export interface MatNnunetPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: MatNnunetJob) => void;
}

export interface MatNnunetArtifactRequest {
  artifactId: string;
  expectedSha256: string;
  expectedByteLength: number;
  signal?: AbortSignal;
}

export class MatNnunetHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MatNnunetHttpError";
    this.status = status;
  }
}

interface SubmittedSource {
  sourceKind: MatNnunetSourceKind;
  sha256?: string;
  byteLength: number;
}

const SHA256 = /^[a-f0-9]{64}$/i;
const JOB_ID = /^job-[0-9a-f]{16}-[0-9a-f]{12}$/;
const ASSET_ID = /^asset-sha256-[0-9a-f]{64}$/;
const CLIENT_HEADER = { "X-Multilig-Client": "1" } as const;
const MAX_BROWSER_ARTIFACT_BYTES = 128 * 1024 * 1024;

function normalizeLoopbackOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  if (!loopbackHosts.has(url.hostname)) throw new Error("MAT nnUNet bridge must use a loopback host");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("MAT nnUNet bridge must use HTTP(S)");
  if (url.username || url.password || url.search || url.hash) throw new Error("MAT nnUNet bridge URL must not contain credentials or parameters");
  if (url.pathname !== "/") throw new Error("MAT nnUNet bridge URL must contain only an origin");
  return url.origin;
}

async function digestBytes(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required to verify immutable segmentation bytes");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validateProvidedDigest(value: string): string {
  if (!SHA256.test(value)) throw new Error("sourceSha256 must be a 64-character SHA-256 digest");
  return value.toLowerCase();
}

function validateJobId(jobId: string): string {
  if (!JOB_ID.test(jobId)) throw new Error("jobId must be an opaque identifier");
  return jobId;
}

function validateArtifactId(artifactId: string): string {
  if (!ASSET_ID.test(artifactId)) throw new Error("artifactId must be an opaque content-addressed identifier");
  return artifactId;
}

function genericUploadName(sourceKind: MatNnunetSourceKind): string {
  return sourceKind === "dicom_tar_gz" ? "deidentified-source.tar.gz" : "deidentified-source.nii.gz";
}

function abortError(): DOMException {
  return new DOMException("Segmentation request was aborted", "AbortError");
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class MatNnunetClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly submittedSources = new Map<string, SubmittedSource>();

  constructor(options: MatNnunetClientOptions = {}) {
    this.baseUrl = normalizeLoopbackOrigin(options.baseUrl ?? MAT_NNUNET_DEFAULT_ORIGIN);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async json(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new MatNnunetHttpError(`Local segmentation service returned HTTP ${response.status}`, response.status);
    }
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error("Local segmentation service returned invalid JSON");
    }
  }

  private verifyResultSource(job: MatNnunetJob): void {
    if (!job.result) return;
    const submitted = this.submittedSources.get(job.jobId);
    if (!submitted) return;
    const actual = job.result.source;
    if (
      (submitted.sha256 !== undefined && actual.sha256 !== submitted.sha256)
      || actual.byteLength !== submitted.byteLength
      || actual.kind !== submitted.sourceKind
    ) {
      throw new Error("Segmentation result source does not match the uploaded immutable source");
    }
  }

  async getCapabilities(signal?: AbortSignal): Promise<MatNnunetCapabilities> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/segmentation/capabilities`, {
      method: "GET",
      headers: { Accept: "application/json", ...CLIENT_HEADER },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    return parseMatNnunetCapabilities(await this.json(response));
  }

  async createJob(input: MatNnunetUploadRequest): Promise<MatNnunetJob> {
    if (!(input.source instanceof Blob) || input.source.size <= 0) throw new Error("A non-empty MRI source Blob is required");
    const sourceSha256 = input.sourceSha256
      ? validateProvidedDigest(input.sourceSha256)
      : undefined;
    const body = new FormData();
    body.append("source", input.source, genericUploadName(input.sourceKind));
    body.append("source_kind", input.sourceKind);
    if (sourceSha256) body.append("source_sha256", sourceSha256);
    body.append("source_byte_length", String(input.source.size));

    const response = await this.fetchImpl(`${this.baseUrl}/api/segmentation/jobs`, {
      method: "POST",
      headers: { Accept: "application/json", ...CLIENT_HEADER },
      body,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: input.signal,
    });
    const job = parseMatNnunetJob(await this.json(response));
    this.submittedSources.set(job.jobId, {
      sourceKind: input.sourceKind,
      sha256: sourceSha256,
      byteLength: input.source.size,
    });
    this.verifyResultSource(job);
    return job;
  }

  async getJob(jobId: string, signal?: AbortSignal): Promise<MatNnunetJob> {
    const safeJobId = validateJobId(jobId);
    const response = await this.fetchImpl(`${this.baseUrl}/api/segmentation/jobs/${encodeURIComponent(safeJobId)}`, {
      method: "GET",
      headers: { Accept: "application/json", ...CLIENT_HEADER },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
    });
    const job = parseMatNnunetJob(await this.json(response));
    if (job.jobId !== safeJobId) throw new Error("Segmentation service returned a different job identifier");
    this.verifyResultSource(job);
    return job;
  }

  /** Fetch a declared artifact into memory and verify it before rendering. */
  async getArtifact(input: MatNnunetArtifactRequest): Promise<ArrayBuffer> {
    const artifactId = validateArtifactId(input.artifactId);
    const expectedSha256 = validateProvidedDigest(input.expectedSha256);
    if (!Number.isSafeInteger(input.expectedByteLength) || input.expectedByteLength <= 0) {
      throw new Error("expectedByteLength must be a positive integer");
    }
    if (input.expectedByteLength > MAX_BROWSER_ARTIFACT_BYTES) {
      throw new Error("Segmentation artifact exceeds the browser review limit");
    }
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/segmentation/assets/${encodeURIComponent(artifactId)}`,
      {
        method: "GET",
        headers: { Accept: "application/octet-stream", ...CLIENT_HEADER },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new MatNnunetHttpError(`Local segmentation service returned HTTP ${response.status}`, response.status);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== input.expectedByteLength) throw new Error("Segmentation artifact byte length does not match its manifest");
    if (await digestBytes(bytes) !== expectedSha256) throw new Error("Segmentation artifact SHA-256 does not match its manifest");
    return bytes;
  }

  async waitForTerminalJob(jobId: string, options: MatNnunetPollOptions = {}): Promise<MatNnunetJob> {
    const intervalMs = options.intervalMs ?? 750;
    const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
      throw new Error("Polling interval must be between 0 and 60000 milliseconds");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Polling timeout must be positive");
    const startedAt = Date.now();
    while (true) {
      const job = await this.getJob(jobId, options.signal);
      options.onUpdate?.(job);
      if (job.status === "completed" || job.status === "failed") return job;
      if (Date.now() - startedAt >= timeoutMs) throw new Error("Timed out waiting for local segmentation");
      await wait(intervalMs, options.signal);
    }
  }
}
