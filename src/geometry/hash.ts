/** Canonical structural serialization and deterministic 64-bit FNV-1a hashing. */

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export function stableStringify(value: unknown): string {
  const ancestors = new Set<object>();

  const visit = (current: unknown): string => {
    if (current === null) return "null";
    switch (typeof current) {
      case "string":
        return JSON.stringify(current);
      case "boolean":
        return current ? "true" : "false";
      case "number":
        if (!Number.isFinite(current)) throw new Error("Cannot hash a non-finite number");
        return Object.is(current, -0) ? "0" : JSON.stringify(current);
      case "bigint":
        return JSON.stringify(`${current.toString()}n`);
      case "undefined":
        return '"__undefined__"';
      case "function":
      case "symbol":
        throw new Error(`Cannot hash ${typeof current} values`);
      case "object":
        break;
    }

    if (current instanceof Date) {
      if (!Number.isFinite(current.getTime())) throw new Error("Cannot hash an invalid Date");
      return JSON.stringify({ $date: current.toISOString() });
    }

    if (ancestors.has(current)) throw new Error("Cannot hash a circular structure");
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return `[${current.map(visit).join(",")}]`;
      if (current instanceof Map) {
        const entries = [...current.entries()]
          .map(([key, entryValue]) => [visit(key), visit(entryValue)] as const)
          .sort(([left], [right]) => left.localeCompare(right));
        return `{"$map":[${entries.map(([key, entryValue]) => `[${key},${entryValue}]`).join(",")}]}`;
      }
      if (current instanceof Set) {
        const values = [...current.values()].map(visit).sort();
        return `{"$set":[${values.join(",")}]}`;
      }
      const record = current as Record<string, unknown>;
      const entries = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(record[key])}`);
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value);
}

export function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = FNV_OFFSET_BASIS_64;
  // Iterate Unicode code points and feed their UTF-8 bytes, making the hash
  // independent of JavaScript engine UTF-16 implementation details.
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function stableHashParts(...parts: unknown[]): string {
  return stableHash(parts);
}
