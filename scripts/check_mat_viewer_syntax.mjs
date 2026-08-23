import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const viewerUrl = new URL("../public/mat-viewer-v2.html", import.meta.url);
const viewerSource = readFileSync(viewerUrl, "utf8");
const moduleMatch = viewerSource.match(/<script\s+type=["']module["']>([\s\S]*?)<\/script>/i);

if (!moduleMatch) {
  console.error("MAT Viewer v2 is missing its inline module script.");
  process.exit(1);
}

// Parse the exact inline module shipped to the iframe. This catches failures
// such as duplicate lexical declarations that TypeScript/ESLint cannot see in
// the self-contained HTML implementation.
const checked = spawnSync(
  process.execPath,
  ["--check", "--input-type=module"],
  { input: moduleMatch[1], encoding: "utf8" },
);

if (checked.status !== 0) {
  console.error(checked.stderr || checked.stdout || "MAT Viewer v2 module syntax check failed.");
  process.exit(checked.status || 1);
}
