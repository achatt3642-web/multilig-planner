export interface VersionedPlanDocument {
  schemaVersion: string;
  catalogVersion: string;
  geometryGeneratorVersion: string;
}

export interface PlanRevision<T> {
  id: string;
  sequence: number;
  createdAt: string;
  actor: string;
  reason: string;
  geometryHash: string;
  snapshot: T;
}

export interface PlanHistory<T extends VersionedPlanDocument> {
  past: PlanRevision<T>[];
  present: PlanRevision<T>;
  future: PlanRevision<T>[];
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableObject(entry)]),
    );
  }
  return value;
}

export function stablePlanJson(value: unknown): string {
  return JSON.stringify(stableObject(value));
}

export function stablePlanHash(value: unknown): string {
  const input = stablePlanJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function revision<T>(snapshot: T, sequence: number, actor: string, reason: string): PlanRevision<T> {
  const cloned = deepClone(snapshot);
  return Object.freeze({
    id: `revision-${sequence}-${stablePlanHash(cloned).slice(-8)}`,
    sequence,
    createdAt: new Date().toISOString(),
    actor,
    reason,
    geometryHash: stablePlanHash(cloned),
    snapshot: cloned,
  });
}

export function createPlanHistory<T extends VersionedPlanDocument>(
  initial: T,
  actor = "local-clinician",
): PlanHistory<T> {
  return { past: [], present: revision(initial, 0, actor, "Plan created"), future: [] };
}

export function commitPlan<T extends VersionedPlanDocument>(
  history: PlanHistory<T>,
  update: T | ((current: T) => T),
  reason: string,
  actor = "local-clinician",
): PlanHistory<T> {
  const current = deepClone(history.present.snapshot);
  const next = typeof update === "function" ? update(current) : update;
  if (stablePlanJson(next) === stablePlanJson(history.present.snapshot)) return history;
  const nextRevision = revision(next, history.present.sequence + 1, actor, reason);
  return {
    past: [...history.past, history.present],
    present: nextRevision,
    future: [],
  };
}

export function undoPlan<T extends VersionedPlanDocument>(history: PlanHistory<T>): PlanHistory<T> {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoPlan<T extends VersionedPlanDocument>(history: PlanHistory<T>): PlanHistory<T> {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export interface PersistedPlanEnvelope<T> {
  format: "multilig-plan";
  exportedAt: string;
  schemaVersion: string;
  catalogVersion: string;
  geometryGeneratorVersion: string;
  snapshotHash: string;
  plan: T;
}

export function serializePlan<T extends VersionedPlanDocument>(plan: T): string {
  const envelope: PersistedPlanEnvelope<T> = {
    format: "multilig-plan",
    exportedAt: new Date().toISOString(),
    schemaVersion: plan.schemaVersion,
    catalogVersion: plan.catalogVersion,
    geometryGeneratorVersion: plan.geometryGeneratorVersion,
    snapshotHash: stablePlanHash(plan),
    plan: deepClone(plan),
  };
  return JSON.stringify(envelope, null, 2);
}

export function deserializePlan<T extends VersionedPlanDocument>(json: string): T {
  const parsed = JSON.parse(json) as PersistedPlanEnvelope<T>;
  if (parsed.format !== "multilig-plan" || !parsed.plan) throw new Error("Unsupported plan file");
  if (stablePlanHash(parsed.plan) !== parsed.snapshotHash) throw new Error("Plan integrity check failed");
  if (
    parsed.plan.schemaVersion !== parsed.schemaVersion ||
    parsed.plan.catalogVersion !== parsed.catalogVersion ||
    parsed.plan.geometryGeneratorVersion !== parsed.geometryGeneratorVersion
  ) {
    throw new Error("Plan version envelope does not match its document");
  }
  return deepClone(parsed.plan);
}

export function savePlanLocally<T extends VersionedPlanDocument>(key: string, plan: T): void {
  localStorage.setItem(key, serializePlan(plan));
}

export function loadPlanLocally<T extends VersionedPlanDocument>(key: string): T | null {
  const value = localStorage.getItem(key);
  return value ? deserializePlan<T>(value) : null;
}
