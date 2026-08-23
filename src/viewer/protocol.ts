import type { HandleKind, ViewerHandleChange } from "./types";

const HANDLE_KINDS = new Set<HandleKind>([
  "aperture",
  "endpoint",
  "diameter",
  "orientation",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function finitePosition(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const position = value.map(Number);
  return position.every(Number.isFinite)
    ? position as [number, number, number]
    : null;
}

/**
 * Runtime validation for the iframe's direct-manipulation callback. Keeping
 * this at the adapter boundary prevents malformed or stale window messages
 * from becoming patient-space edits.
 */
export function parseViewerHandleChange(value: unknown): ViewerHandleChange | null {
  if (!isRecord(value) || value.type !== "multilig_handle_change") return null;
  if (typeof value.channelId !== "string" || !value.channelId.trim()) return null;
  if (typeof value.kind !== "string" || !HANDLE_KINDS.has(value.kind as HandleKind)) return null;
  if (value.phase !== "preview" && value.phase !== "commit") return null;
  const position = finitePosition(value.position);
  if (!position) return null;
  return {
    channelId: value.channelId,
    kind: value.kind as HandleKind,
    position,
    phase: value.phase,
  };
}
