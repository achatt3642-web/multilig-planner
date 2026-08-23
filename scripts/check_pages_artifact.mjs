import { access, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const entries = [join(dist, "index.html"), join(dist, "demo.html")];
const requiredArtifacts = [
  ...entries,
  join(dist, "CNAME"),
  join(dist, "multilig-planner-logo.png"),
  join(dist, "og.png"),
  join(dist, "mat-viewer-v2.html"),
  join(dist, "demo-anatomy", "femur.mat-viewer-mesh.json"),
  join(dist, "demo-anatomy", "tibia.mat-viewer-mesh.json"),
];

await Promise.all(requiredArtifacts.map((artifact) => access(artifact)));

function localTarget(entry, reference) {
  if (!reference || reference.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(reference)) return null;
  const clean = reference.split("#", 1)[0].split("?", 1)[0];
  if (!clean) return entry;
  return clean.startsWith("/") ? join(dist, clean) : resolve(dirname(entry), clean);
}

for (const entry of entries) {
  const html = await readFile(entry, "utf8");
  if (/\bsrc="\/src\//.test(html)) throw new Error(`${relative(root, entry)} still references source modules`);

  const references = Array.from(html.matchAll(/\b(?:href|src)="([^"]+)"/g), (match) => match[1]);
  for (const referenceValue of references) {
    const target = localTarget(entry, referenceValue);
    if (!target) continue;
    const relativeTarget = relative(dist, target);
    if (isAbsolute(relativeTarget) || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
      throw new Error(`${relative(root, entry)} points outside the Pages artifact: ${referenceValue}`);
    }
    const targetStat = await stat(target);
    if (targetStat.isDirectory()) await access(join(target, "index.html"));
  }
}

console.log("GitHub Pages artifact contains both site routes and their local assets.");
