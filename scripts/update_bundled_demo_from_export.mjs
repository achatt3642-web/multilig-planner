import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, "src/demo/bundledDemoPlan.json");
const REDACTED = "[redacted from de-identified export]";
const BUNDLED_MESH_IDS = new Set(["demo-anatomy-femur", "demo-anatomy-tibia"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function restoreRedacted(candidate, current) {
  if (candidate === REDACTED) return structuredClone(current);
  if (Array.isArray(candidate)) {
    const currentArray = Array.isArray(current) ? current : [];
    return candidate.map((value, index) => restoreRedacted(value, currentArray[index]));
  }
  if (candidate && typeof candidate === "object") {
    const currentRecord = current && typeof current === "object" ? current : {};
    return Object.fromEntries(Object.entries(candidate)
      .map(([key, value]) => [key, restoreRedacted(value, currentRecord[key])]));
  }
  return candidate;
}

function containsValue(value, predicate) {
  if (predicate(value)) return true;
  if (Array.isArray(value)) return value.some((entry) => containsValue(entry, predicate));
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => containsValue(entry, predicate));
  }
  return false;
}

function validateChannel(channel, currentChannel) {
  for (const key of ["id", "procedureId", "constructId", "label", "bone", "semanticKey"]) {
    invariant(channel[key] === currentChannel[key], `Channel ${currentChannel.id} changed protected identity field ${key}`);
  }
  invariant(channel.instrumentChain?.id === `${channel.id}-instrument-chain`, `Channel ${channel.id} has an invalid instrument-chain reference`);
  invariant(channel.layers.every((layer) => layer.channelId === channel.id), `Channel ${channel.id} has a mismatched geometry layer`);
  invariant(sameValues(channel.aperture, channel.centerline.aperturePatientRasMm), `Channel ${channel.id} aperture and centerline disagree`);
  invariant(sameValues(channel.vector, channel.centerline.directionPatientRas), `Channel ${channel.id} vector and centerline disagree`);

  const meshIds = [
    channel.apertureSurfaceAttachment?.meshId,
    channel.endpointSurfaceAttachment?.meshId,
    ...(channel.surfacePlacement?.meshIds ?? []),
  ].filter(Boolean);
  invariant(meshIds.every((meshId) => BUNDLED_MESH_IDS.has(meshId)), `Channel ${channel.id} references a non-bundled mesh`);
  invariant(!containsValue(channel, (value) => value === REDACTED), `Channel ${channel.id} retains redacted export text`);
  invariant(!containsValue(channel, (value) => typeof value === "string" && /(?:\/Users\/|[A-Za-z]:\\\\)/.test(value)), `Channel ${channel.id} contains a local filesystem path`);
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const exportArgument = args.find((argument) => argument !== "--check");
invariant(exportArgument, "Usage: node scripts/update_bundled_demo_from_export.mjs [--check] <deidentified-plan-export.json>");

const exportPath = resolve(exportArgument);
const [fixtureText, exportText] = await Promise.all([
  readFile(fixturePath, "utf8"),
  readFile(exportPath, "utf8"),
]);
const fixture = JSON.parse(fixtureText);
const envelope = JSON.parse(exportText);
const exportedPlan = envelope.plan;

invariant(envelope.format === "multilig-planner-json", "Unsupported export format");
invariant(envelope.exportVersion === "1.0.0", "Unsupported export version");
invariant(envelope.deidentified === true, "Only a de-identified export may become the bundled default");
invariant(exportedPlan && typeof exportedPlan === "object", "Export does not contain a plan");
for (const key of ["id", "schemaVersion", "catalogVersion", "geometryGeneratorVersion", "activeVariantId", "laterality"]) {
  invariant(exportedPlan[key] === fixture[key], `Export is incompatible with bundled plan field ${key}`);
}
invariant(exportedPlan.sourceStudyIds?.length === 0, "Export contains source study identifiers");
invariant(exportedPlan.imaging?.sources?.length === 0, "Export contains imaging sources");
invariant(exportedPlan.imaging?.derivedAssets?.length === 0, "Export contains derived imaging assets");
invariant(exportedPlan.imaging?.segmentationRuns?.length === 0, "Export contains segmentation runs");

const fixtureProcedureIds = sortedUnique(fixture.procedures.map((procedure) => procedure.id));
const exportedProcedureIds = sortedUnique(exportedPlan.procedures.map((procedure) => procedure.id));
invariant(sameValues(fixtureProcedureIds, exportedProcedureIds), "Export procedure identities do not match the bundled plan");

const fixtureVariant = fixture.variants.find((variant) => variant.id === fixture.activeVariantId);
const exportedVariant = exportedPlan.variants.find((variant) => variant.id === exportedPlan.activeVariantId);
invariant(fixtureVariant && exportedVariant, "Active plan variant is missing");
const fixtureChannelIds = sortedUnique(fixtureVariant.channels.map((channel) => channel.id));
const exportedChannelIds = sortedUnique(exportedVariant.channels.map((channel) => channel.id));
invariant(sameValues(fixtureChannelIds, exportedChannelIds), "Export channel identities do not match the bundled plan");

const exportedChannels = new Map(exportedVariant.channels.map((channel) => [channel.id, channel]));
const updatedChannels = fixtureVariant.channels.map((currentChannel) => {
  const exportedChannel = exportedChannels.get(currentChannel.id);
  invariant(exportedChannel, `Export is missing channel ${currentChannel.id}`);
  const channel = restoreRedacted(exportedChannel, currentChannel);
  validateChannel(channel, currentChannel);
  return channel;
});

const updatedFixture = structuredClone(fixture);
const updatedVariant = updatedFixture.variants.find((variant) => variant.id === updatedFixture.activeVariantId);
updatedVariant.channels = updatedChannels;
const serialized = `${JSON.stringify(updatedFixture, null, 2)}\n`;
const sha256 = createHash("sha256").update(serialized).digest("hex");

if (checkOnly) {
  invariant(fixtureText === serialized, "Bundled plan does not match the supplied export parameters");
  console.log(`Bundled demo parameters match ${exportPath} (SHA-256 ${sha256}).`);
} else {
  await writeFile(fixturePath, serialized, "utf8");
  console.log(`Updated 15 bundled channel records from ${exportPath} (SHA-256 ${sha256}).`);
}
