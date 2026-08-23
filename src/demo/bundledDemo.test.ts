import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_PLAN_SCHEMA_VERSION } from "../domain/schema";
import { createAnatomicChannelSeedContext } from "../app/anatomicChannelSurfaceSeed";
import { initializePendingChannelSurfacePlacements } from "../app/channelSurfaceInitialization";
import { resolveChannelStartPointPatientRas } from "../app/channelTrajectorySemantics";
import {
  BUNDLED_DEMO_ASSETS,
  BUNDLED_DEMO_PLAN_ID,
  createBundledDemoPlan,
  createBundledDemoWorkspaceDefaults,
  bundledDemoSha256,
  loadBundledDemoAnatomy,
  usesBundledDemoAnatomy,
  type BundledDemoFetch,
} from "./bundledDemo";

const root = resolve(import.meta.dirname, "../..");

async function readAsset(path: string): Promise<Buffer> {
  return readFile(resolve(root, "public", path));
}

function arrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("bundled de-identified knee demo", () => {
  it("preserves the captured plan geometry and fresh-origin workspace defaults", async () => {
    const plan = createBundledDemoPlan();
    const workspace = createBundledDemoWorkspaceDefaults(plan);
    const planBytes = await readFile(resolve(root, "src/demo/bundledDemoPlan.json"));
    const workspaceBytes = await readFile(resolve(root, "src/demo/bundledDemoWorkspace.json"));

    expect(plan.id).toBe(BUNDLED_DEMO_PLAN_ID);
    expect(plan.schemaVersion).toBe(CURRENT_PLAN_SCHEMA_VERSION);
    expect(plan.deidentifiedLabel).toBe("De-identified knee demo");
    expect(plan).toMatchObject({ laterality: "right", lateralityVerified: false, scaleVerified: false });
    expect(plan.sourceStudyIds).toEqual([]);
    expect(plan.audit).toEqual([]);
    expect(plan.imaging.sources).toEqual([]);
    expect(plan.imaging.derivedAssets).toEqual([]);
    expect(plan.imaging.segmentationRuns).toEqual([]);
    expect(plan.imaging.lateralityHint).toMatchObject({
      laterality: "right",
      status: "resolved",
      confidence: "low",
      requiresClinicianVerification: true,
    });
    expect(plan.variants[0].channels).toHaveLength(15);
    expect(usesBundledDemoAnatomy(plan)).toBe(true);
    expect(createHash("sha256").update(planBytes).digest("hex"))
      .toBe("f2907dbe76ad5fc036b2cd7ee13fa2f2c6f51c8f34b6791743a356b5dbd93d4d");
    expect(createHash("sha256").update(workspaceBytes).digest("hex"))
      .toBe("6a96ba58dbfbf477c6f882e375e3b05af10e9d4bd8da630cf986747d4afe9b3f");

    expect(workspace.highlightedProcedures).toEqual(["ACL", "PCL", "MCL_POL_PMC", "ALL", "MEDIAL_ROOT"]);
    expect(workspace.focusedProcedure).toBe("ACL");
    expect(workspace.selectedChannelId).toBe("demo-channel-acl-tibia");
    expect(workspace.visibleGraftVisibilityKeys).toEqual([]);
    expect(workspace.stepIndex).toBe(1);
    expect(workspace.globalOpacity).toBe(1);

    const aclTibia = plan.variants[0].channels.find((channel) => channel.id === workspace.selectedChannelId);
    expect(aclTibia).toMatchObject({
      label: "ACL tibia socket",
      bone: "tibia",
      geometryType: "antegrade_blind_socket",
      diameterMm: 9,
      depthMm: 27,
      guidePin: { diameterMm: 3.5 },
    });
  });

  it("keeps every surface attachment bound to one of the bundled mesh identifiers", () => {
    const plan = createBundledDemoPlan();
    const meshIds = new Set(BUNDLED_DEMO_ASSETS.map((asset) => asset.id));
    const attachedChannels = plan.variants[0].channels.filter((channel) => channel.apertureSurfaceAttachment);
    expect(attachedChannels.length).toBeGreaterThan(0);
    for (const channel of attachedChannels) {
      expect(meshIds.has(channel.apertureSurfaceAttachment!.meshId as typeof BUNDLED_DEMO_ASSETS[number]["id"]))
        .toBe(true);
      if (channel.endpointSurfaceAttachment) {
        expect(meshIds.has(channel.endpointSurfaceAttachment.meshId as typeof BUNDLED_DEMO_ASSETS[number]["id"]))
          .toBe(true);
      }
      for (const meshId of channel.surfacePlacement?.meshIds ?? []) {
        expect(meshIds.has(meshId as typeof BUNDLED_DEMO_ASSETS[number]["id"])).toBe(true);
      }
    }
  });

  it("keeps procedure, construct, and channel references internally consistent", () => {
    const plan = createBundledDemoPlan();
    const channels = new Map(plan.variants[0].channels.map((channel) => [channel.id, channel]));
    const constructs = new Map(plan.procedures.flatMap((procedure) =>
      procedure.constructs.map((construct) => [construct.id, construct] as const)));
    for (const procedure of plan.procedures) {
      for (const construct of procedure.constructs) {
        expect(construct.procedureId).toBe(procedure.id);
        expect(construct.channelIds.length).toBeGreaterThan(0);
        for (const channelId of construct.channelIds) {
          expect(channels.get(channelId)).toMatchObject({
            procedureId: procedure.id,
            constructId: construct.id,
          });
        }
      }
    }
    for (const channel of channels.values()) {
      expect(channel.constructId).toBeDefined();
      expect(constructs.get(channel.constructId!)).toBeDefined();
      expect(channel.layers.every((layer) => layer.channelId === channel.id)).toBe(true);
      expect(channel.instrumentChain.id).toBe(`${channel.id}-instrument-chain`);
    }
  });

  it("hash-verifies and parses both static patient-RAS millimetre surfaces", async () => {
    const fetcher: BundledDemoFetch = async (url) => {
      const assetPath = url.replace(/^\/demo-base\//, "").split("?")[0] ?? "";
      const bytes = await readAsset(assetPath);
      return { ok: true, status: 200, arrayBuffer: async () => arrayBuffer(bytes) };
    };
    const meshes = await loadBundledDemoAnatomy({ fetcher, baseUrl: "/demo-base/" });
    expect(meshes.map((mesh) => ({
      id: mesh.id,
      bone: mesh.anatomyBone,
      vertices: mesh.vertices.length,
      faces: mesh.faces.length,
      opacity: mesh.opacity,
    }))).toEqual([
      { id: "demo-anatomy-femur", bone: "femur", vertices: 15_770, faces: 31_536, opacity: 0.22 },
      { id: "demo-anatomy-tibia", bone: "tibia", vertices: 23_350, faces: 46_520, opacity: 0.22 },
    ]);
  });

  it("derives bundled PLC starts on the right-knee lateral side when its surfaces load", async () => {
    const fetcher: BundledDemoFetch = async (url) => {
      const assetPath = url.replace(/^\/demo-base\//, "").split("?")[0] ?? "";
      const bytes = await readAsset(assetPath);
      return { ok: true, status: 200, arrayBuffer: async () => arrayBuffer(bytes) };
    };
    const meshes = await loadBundledDemoAnatomy({ fetcher, baseUrl: "/demo-base/" });
    const plan = initializePendingChannelSurfacePlacements(createBundledDemoPlan(), meshes);
    const context = createAnatomicChannelSeedContext(plan, meshes);
    expect(context).not.toBeNull();
    if (!context) return;
    const procedureIds = new Set(plan.procedures
      .filter((procedure) => procedure.structure === "PLC_FCL")
      .map((procedure) => procedure.id));
    const lateralOffset = (point: readonly number[]): number => {
      const origin = context.frame.midline.originPatientRasMm;
      const axis = context.frame.midline.normalPatientRas;
      return (point[0] - origin[0]) * axis[0] +
        (point[1] - origin[1]) * axis[1] +
        (point[2] - origin[2]) * axis[2];
    };
    const plcChannels = plan.variants[0].channels.filter((channel) =>
      procedureIds.has(channel.procedureId) && channel.bone !== "fibula");
    expect(plcChannels).toHaveLength(3);
    for (const channel of plcChannels) {
      const start = resolveChannelStartPointPatientRas(channel);
      expect(channel.surfacePlacement?.state, channel.label).toBe("default_applied");
      expect(lateralOffset(channel.aperture), `${channel.label} surface seed`).toBeGreaterThan(0);
      expect(start, `${channel.label} Start`).not.toBeNull();
      expect(lateralOffset(start!.pointPatientRasMm), `${channel.label} Start`).toBeGreaterThan(0);
    }
  });

  it("rejects a same-length modified surface before parsing", async () => {
    const fetcher: BundledDemoFetch = async (url) => {
      const assetPath = url.replace(/^\/demo-base\//, "").split("?")[0] ?? "";
      const bytes = await readAsset(assetPath);
      if (url.includes("femur")) bytes[bytes.length - 2] ^= 1;
      return { ok: true, status: 200, arrayBuffer: async () => arrayBuffer(bytes) };
    };
    await expect(loadBundledDemoAnatomy({ fetcher, baseUrl: "/demo-base/" }))
      .rejects.toThrow(/integrity check failed/i);
  });

  it("computes SHA-256 without requiring WebCrypto or a secure origin", () => {
    const bytes = new TextEncoder().encode("abc").buffer as ArrayBuffer;
    expect(bundledDemoSha256(bytes))
      .toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("contains geometry only and excludes source identifiers and local provenance", async () => {
    const files = [
      resolve(root, "src/demo/bundledDemoPlan.json"),
      resolve(root, "src/demo/bundledDemoWorkspace.json"),
      ...BUNDLED_DEMO_ASSETS.map((asset) => resolve(root, "public", asset.path)),
    ];
    const forbidden = /\/Users\/|External_Validation|External_MRI|Meniscus_project|\.tar\.gz|segasset-|segframe-|job-[a-f0-9]{12,}|source-[a-f0-9]{12,}|patient(?:id|name)|studyinstanceuid|seriesinstanceuid|accessionnumber/i;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text).not.toMatch(forbidden);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    }
    for (const asset of BUNDLED_DEMO_ASSETS) {
      const value = JSON.parse(await readFile(resolve(root, "public", asset.path), "utf8")) as Record<string, unknown>;
      expect(Object.keys(value).sort()).toEqual([
        "bone", "faces", "frameId", "quality", "schemaVersion", "units", "vertices",
      ]);
    }
  });
});
