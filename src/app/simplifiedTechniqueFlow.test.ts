import { describe, expect, it } from "vitest";
import { createSyntheticDemoCase } from "./caseFactory";
import { buildSyntheticAnatomyMeshes, buildViewerScene } from "./channelGeometry";
import { initializePendingChannelSurfacePlacements } from "./channelSurfaceInitialization";
import { activeVariant } from "./planOperations";
import {
  SIMPLIFIED_PROCEDURES,
  buildSimplifiedTechniquePreset,
  createEmptySimplifiedSelection,
  flowStepsFor,
  readSimplifiedSelection,
  replaceSimplifiedProcedure,
  toggleRootLocation,
  validateSimplifiedSelection,
  type SimplifiedBoneChoice,
  type SimplifiedTechniqueSelection,
} from "./simplifiedTechniqueFlow";

const bone = (overrides: Partial<SimplifiedBoneChoice>): SimplifiedBoneChoice => ({
  bundle: null,
  preparation: null,
  count: null,
  diameterMm: null,
  depthMm: null,
  ...overrides,
});

const configured = (
  procedure: SimplifiedTechniqueSelection["procedure"],
  overrides: Partial<SimplifiedTechniqueSelection>,
): SimplifiedTechniqueSelection => ({
  ...createEmptySimplifiedSelection(procedure),
  ...overrides,
});

describe("simplified sequential technique flow", () => {
  it("exposes only the eight requested structures and starts with no silent choice", () => {
    expect(SIMPLIFIED_PROCEDURES.map((item) => item.id)).toEqual([
      "ACL", "PCL", "MCL_POL_PMC", "ALL", "LET", "MEDIAL_ROOT", "LATERAL_ROOT", "PLC_FCL",
    ]);
    for (const item of SIMPLIFIED_PROCEDURES) {
      const selection = createEmptySimplifiedSelection(item.id);
      expect(selection.rootLocation).toBeNull();
      expect(selection.femur?.preparation ?? null).toBeNull();
      expect(selection.tibia?.preparation ?? null).toBeNull();
      expect(validateSimplifiedSelection(selection).length).toBeGreaterThan(0);
    }
  });

  it("uses the requested one- or two-step bone sequence", () => {
    expect(flowStepsFor("ACL").map((step) => step.bone)).toEqual(["femur", "tibia"]);
    expect(flowStepsFor("PCL").map((step) => step.bone)).toEqual(["femur", "tibia"]);
    expect(flowStepsFor("MCL_POL_PMC").map((step) => step.bone)).toEqual(["femur", "tibia"]);
    expect(flowStepsFor("ALL").map((step) => step.bone)).toEqual(["femur", "tibia"]);
    expect(flowStepsFor("PLC_FCL").map((step) => step.bone)).toEqual(["femur", "tibia"]);
    expect(flowStepsFor("LET").map((step) => step.bone)).toEqual(["femur"]);
    expect(flowStepsFor("MEDIAL_ROOT").map((step) => step.bone)).toEqual(["tibia"]);
    expect(flowStepsFor("LATERAL_ROOT").map((step) => step.bone)).toEqual(["tibia"]);
  });

  it("toggles anterior and posterior root locations independently", () => {
    expect(toggleRootLocation(null, "anterior")).toBe("anterior");
    expect(toggleRootLocation(null, "posterior")).toBe("posterior");
    expect(toggleRootLocation("anterior", "posterior")).toBe("both");
    expect(toggleRootLocation("posterior", "anterior")).toBe("both");
    expect(toggleRootLocation("both", "anterior")).toBe("posterior");
    expect(toggleRootLocation("both", "posterior")).toBe("anterior");
    expect(toggleRootLocation("anterior", "anterior")).toBeNull();
    expect(toggleRootLocation("posterior", "posterior")).toBeNull();
  });

  it("builds every ACL single/double bundle combination with the exact preparation type", () => {
    for (const [femurBundle, tibiaBundle, expectedCount] of [
      ["single_bundle", "single_bundle", 2],
      ["double_bundle", "single_bundle", 3],
      ["single_bundle", "double_bundle", 3],
      ["double_bundle", "double_bundle", 4],
    ] as const) {
      const preset = buildSimplifiedTechniquePreset(configured("ACL", {
        femur: bone({ bundle: femurBundle, preparation: "socket_with_guide_pin" }),
        tibia: bone({ bundle: tibiaBundle, preparation: "full_tunnel" }),
      }));
      expect(preset.channelSeeds).toHaveLength(expectedCount);
      expect(preset.channelSeeds.filter((seed) => seed.bone === "femur").every((seed) => seed.geometryType === "antegrade_blind_socket" && !seed.fullThickness)).toBe(true);
      expect(preset.channelSeeds.filter((seed) => seed.bone === "tibia").every((seed) => seed.geometryType === "round_full_tunnel" && seed.fullThickness)).toBe(true);
      expect(new Set(preset.channelSeeds.map((seed) => seed.key)).size).toBe(expectedCount);
    }
  });

  it("creates one point-only PCL tibial onlay even when the tibial plan is double bundle", () => {
    const preset = buildSimplifiedTechniquePreset(configured("PCL", {
      femur: bone({ bundle: "double_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "double_bundle", preparation: "onlay_fixation_point" }),
    }));
    const tibial = preset.channelSeeds.filter((seed) => seed.bone === "tibia");
    expect(tibial).toHaveLength(1);
    expect(tibial[0].geometryType).toBe("onlay_no_large_tunnel");
    expect(tibial[0].noLargeTunnel).toBe(true);
    expect(tibial[0].initialPlanningValues).toBeUndefined();
  });

  it("requires explicit anchor dimensions and valid requested counts", () => {
    const invalid = configured("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 1.5, diameterMm: 0, depthMm: null }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    expect(validateSimplifiedSelection(invalid).join(" ")).toMatch(/diameter.*depth.*whole number/i);
    const valid = configured("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 3, diameterMm: 4.2, depthMm: 18 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const preset = buildSimplifiedTechniquePreset(valid);
    expect(preset.channelSeeds).toHaveLength(4);
    expect(preset.channelSeeds.filter((seed) => seed.bone === "femur").every((seed) => seed.geometryType === "anchor_pilot")).toBe(true);
    expect(preset.channelSeeds[0].initialPlanningValues).toEqual({
      diameterMm: 4.2,
      depthMm: 18,
      provenance: "clinician_entered_planning_value",
    });
  });

  it("maps ALL, LET, roots, and optional PLC tibia without inventing extra channels", () => {
    const all = buildSimplifiedTechniquePreset(configured("ALL", {
      femur: bone({ preparation: "anchor", diameterMm: 3.5, depthMm: 15 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    }));
    expect(all.channelSeeds.map((seed) => seed.geometryType)).toEqual(["anchor_pilot", "antegrade_blind_socket"]);

    const letPlan = buildSimplifiedTechniquePreset(configured("LET", {
      femur: bone({ preparation: "socket_with_guide_pin" }),
    }));
    expect(letPlan.channelSeeds).toHaveLength(1);
    expect(letPlan.channelSeeds[0].bone).toBe("femur");

    for (const rootLocation of ["anterior", "posterior"] as const) {
      const root = buildSimplifiedTechniquePreset(configured("LATERAL_ROOT", {
        rootLocation,
        tibia: bone({ preparation: "suture_anchor_location" }),
      }));
      expect(root.channelSeeds).toHaveLength(1);
      expect(root.channelSeeds[0].label).toContain(rootLocation);
      expect(root.channelSeeds[0].geometryType).toBe("rigid_pin");
    }

    const plc = buildSimplifiedTechniquePreset(configured("PLC_FCL", {
      femur: bone({ preparation: "socket_with_guide_pin", count: 2 }),
      tibia: bone({ preparation: "posterior_socket_with_guide_pin" }),
    }));
    expect(plc.channelSeeds).toHaveLength(3);
    expect(plc.channelSeeds.filter((seed) => seed.bone === "femur")).toHaveLength(2);
    expect(plc.channelSeeds.filter((seed) => seed.bone === "tibia")[0].geometryType).toBe("antegrade_blind_socket");
    expect(plc.channelSeeds.some((seed) => seed.bone === "fibula")).toBe(false);
  });

  it("creates distinct anterior and posterior root channels for every tibial preparation", () => {
    for (const [preparation, expectedGeometryType] of [
      ["suture_anchor_location", "rigid_pin"],
      ["socket_with_guide_pin", "antegrade_blind_socket"],
      ["full_tunnel", "round_full_tunnel"],
    ] as const) {
      const selection = configured("MEDIAL_ROOT", {
        rootLocation: "both",
        tibia: bone({ preparation }),
      });
      expect(validateSimplifiedSelection(selection)).toEqual([]);

      const preset = buildSimplifiedTechniquePreset(selection);
      expect(preset.channelSeeds).toHaveLength(2);
      expect(preset.channelSeeds.map((seed) => seed.key)).toEqual([
        `anterior-${preparation}`,
        `posterior-${preparation}`,
      ]);
      expect(preset.channelSeeds.map((seed) => seed.geometryType)).toEqual([
        expectedGeometryType,
        expectedGeometryType,
      ]);
      expect(preset.channelSeeds[0].label).toContain("anterior");
      expect(preset.channelSeeds[1].label).toContain("posterior");

      const plan = replaceSimplifiedProcedure(createSyntheticDemoCase(), selection);
      const procedure = plan.procedures.at(-1)!;
      const channels = activeVariant(plan).channels.filter((channel) =>
        channel.procedureId === procedure.id,
      );
      expect(channels.map((channel) => channel.semanticKey)).toEqual([
        `anterior-${preparation}`,
        `posterior-${preparation}`,
      ]);
      expect(new Set(channels.map((channel) => channel.id)).size).toBe(2);
      expect(new Set(procedure.constructs.flatMap((construct) => construct.channelIds))).toEqual(
        new Set(channels.map((channel) => channel.id)),
      );
      expect(readSimplifiedSelection(procedure)).toEqual(selection);
    }
  });

  it("renders a root suture-anchor guide pin without a socket or tunnel volume", () => {
    const selection = configured("LATERAL_ROOT", {
      rootLocation: "both",
      tibia: bone({ preparation: "suture_anchor_location" }),
    });
    const anatomy = buildSyntheticAnatomyMeshes();
    const plan = initializePendingChannelSurfacePlacements(
      replaceSimplifiedProcedure(createSyntheticDemoCase(), selection),
      anatomy,
    );
    const procedure = plan.procedures.at(-1)!;
    const channels = activeVariant(plan).channels.filter((channel) =>
      channel.procedureId === procedure.id,
    );
    expect(channels).toHaveLength(2);
    expect(channels.every((channel) => channel.geometryType === "rigid_pin")).toBe(true);

    const viewer = buildViewerScene({
      revision: 1,
      channels,
      procedureById: { [procedure.id]: "LATERAL_ROOT" },
      visibleProcedureIdentities: new Set(["LATERAL_ROOT"]),
      selectedChannelId: channels[0].id,
      anatomyMeshes: anatomy,
    });

    for (const channel of channels) {
      const generated = viewer.geometry.get(channel.id)!;
      expect(generated.recipeType).toBe("rigidPin");
      expect(generated.layers.some((layer) => layer.type === "pinTractAndOvershoot")).toBe(true);
      expect(generated.layers.some((layer) => layer.type === "boneRemovalOrCompaction")).toBe(false);
      expect(viewer.scene.meshes.some((mesh) =>
        mesh.channelId === channel.id && mesh.layer === "pins",
      )).toBe(true);
      expect(viewer.scene.meshes.some((mesh) =>
        mesh.channelId === channel.id && mesh.layer === "boneRemoval",
      )).toBe(false);
    }

    expect(viewer.scene.handles.find((handle) =>
      handle.channelId === channels[0].id && handle.kind === "aperture",
    )).toMatchObject({
      semanticRole: "start",
      label: `Start point - ${channels[0].label}`,
    });
    expect(viewer.scene.handles.find((handle) =>
      handle.channelId === channels[0].id && handle.kind === "endpoint",
    )).toMatchObject({
      semanticRole: "trajectory",
      label: `Trajectory - ${channels[0].label}`,
      trajectoryPivotPatientRas: channels[0].aperture,
    });
    expect(viewer.scene.labels?.some((label) =>
      label.channelId === channels[0].id && label.id.endsWith("-tunnel-label"),
    ) ?? false).toBe(false);
  });

  it("uses guide-pin dimensions when a root socket is changed to suture-anchor preparation", () => {
    const socketSelection = configured("MEDIAL_ROOT", {
      rootLocation: "both",
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const socketPlan = replaceSimplifiedProcedure(createSyntheticDemoCase(), socketSelection);
    const pinSelection = configured("MEDIAL_ROOT", {
      rootLocation: "both",
      tibia: bone({ preparation: "suture_anchor_location" }),
    });
    const pinPlan = replaceSimplifiedProcedure(socketPlan, pinSelection);
    const pinProcedure = pinPlan.procedures.at(-1)!;
    const pins = activeVariant(pinPlan).channels.filter((channel) =>
      channel.procedureId === pinProcedure.id,
    );

    expect(pins).toHaveLength(2);
    expect(pins.every((channel) =>
      channel.geometryType === "rigid_pin" &&
      channel.diameterMm === 3.5 &&
      channel.depthMm === 20,
    )).toBe(true);
  });

  it("uses a bone-surface Start and a separate Trajectory handle for every collateral anchor plan", () => {
    const selections: SimplifiedTechniqueSelection[] = [
      configured("MCL_POL_PMC", {
        femur: bone({ preparation: "anchor", count: 1, diameterMm: 4, depthMm: 18 }),
        tibia: bone({ preparation: "socket_with_guide_pin" }),
      }),
      configured("ALL", {
        femur: bone({ preparation: "anchor", diameterMm: 4, depthMm: 18 }),
        tibia: bone({ preparation: "anchor", diameterMm: 4, depthMm: 18 }),
      }),
      configured("LET", {
        femur: bone({ preparation: "anchor", diameterMm: 4, depthMm: 18 }),
      }),
      configured("PLC_FCL", {
        femur: bone({ preparation: "anchor", count: 2, diameterMm: 4, depthMm: 18 }),
        tibia: bone({ preparation: "none" }),
      }),
    ];

    for (const selection of selections) {
      const anatomy = buildSyntheticAnatomyMeshes();
      const plan = initializePendingChannelSurfacePlacements(
        replaceSimplifiedProcedure(createSyntheticDemoCase(), selection),
        anatomy,
      );
      const procedure = plan.procedures.at(-1)!;
      const anchor = activeVariant(plan).channels.find((channel) =>
        channel.procedureId === procedure.id && channel.geometryType === "anchor_pilot",
      )!;
      const scene = buildViewerScene({
        revision: 1,
        channels: [anchor],
        procedureById: { [procedure.id]: procedure.structure },
        visibleProcedureIdentities: new Set([procedure.structure]),
        selectedChannelId: anchor.id,
        anatomyMeshes: anatomy,
      }).scene;

      expect(scene.handles.find((handle) => handle.kind === "aperture")).toMatchObject({
        semanticRole: "start",
        label: `Start point - ${anchor.label}`,
      });
      expect(scene.handles.find((handle) => handle.kind === "endpoint")).toMatchObject({
        semanticRole: "trajectory",
        label: `Trajectory - ${anchor.label}`,
      });
    }
  });

  it("uses an ipsilateral deep Start for collateral sockets and a 3.5 mm generic guide pin for every socket", () => {
    const selections: SimplifiedTechniqueSelection[] = [
      configured("MCL_POL_PMC", {
        femur: bone({ preparation: "socket_with_guide_pin" }),
        tibia: bone({ preparation: "socket_with_guide_pin" }),
      }),
      configured("ALL", {
        femur: bone({ preparation: "socket_with_guide_pin" }),
        tibia: bone({ preparation: "socket_with_guide_pin" }),
      }),
      configured("LET", { femur: bone({ preparation: "socket_with_guide_pin" }) }),
      configured("PLC_FCL", {
        femur: bone({ preparation: "socket_with_guide_pin", count: 2 }),
        tibia: bone({ preparation: "posterior_socket_with_guide_pin" }),
      }),
    ];
    for (const selection of selections) {
      const preset = buildSimplifiedTechniquePreset(selection);
      expect(preset.channelSeeds.every((seed) => seed.trajectoryControlMode === "blind_socket_tip")).toBe(true);
      expect(preset.channelSeeds.every((seed) => seed.initialPlanningValues?.guidePinDiameterMm === 3.5)).toBe(true);
      expect(preset.channelSeeds.every((seed) => seed.genericSeed.pilotDiameterMm?.[0] === 1)).toBe(true);
    }

    const acl = buildSimplifiedTechniquePreset(configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
    }));
    expect(acl.channelSeeds.every((seed) => seed.trajectoryControlMode === "outer_cortex_surface")).toBe(true);
    expect(acl.channelSeeds.every((seed) => seed.initialPlanningValues?.guidePinDiameterMm === 3.5)).toBe(true);
  });

  it("renders an ipsilateral socket pin and deep Start without a contralateral surface tether", () => {
    const selection = configured("MCL_POL_PMC", {
      femur: bone({ preparation: "socket_with_guide_pin" }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const plan = initializePendingChannelSurfacePlacements(
      replaceSimplifiedProcedure(createSyntheticDemoCase(), selection),
      buildSyntheticAnatomyMeshes(),
    );
    const procedure = plan.procedures.at(-1)!;
    const socket = activeVariant(plan).channels.find((channel) =>
      channel.procedureId === procedure.id && channel.bone === "femur",
    )!;
    expect(socket.trajectoryControlMode).toBe("blind_socket_tip");
    expect(socket.guidePin).toEqual({
      diameterMm: 3.5,
      provenance: "generic_parametric_visual_seed",
    });
    expect(socket.endpointSurfaceAttachment).toBeNull();
    expect(socket.surfacePlacement?.endpointMethod).toBe("blind_socket_tip");

    const viewer = buildViewerScene({
      revision: 2,
      channels: [socket],
      procedureById: { [procedure.id]: "MCL_POL_PMC" },
      visibleProcedureIdentities: new Set(["MCL_POL_PMC"]),
      selectedChannelId: socket.id,
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
    });
    const pinLayer = viewer.scene.meshes.find((mesh) => mesh.channelId === socket.id && mesh.layer === "pins");
    const start = viewer.scene.handles.find((handle) => handle.kind === "endpoint");
    expect(pinLayer?.color).toBe("#f28c28");
    expect(start).toMatchObject({
      semanticRole: "start",
      color: "#f28c28",
    });
    expect(start?.surfaceConstraint).toBeUndefined();
    expect(start?.position[0]).toBeCloseTo(socket.aperture[0] + socket.vector[0] * socket.depthMm!, 8);
    expect(start?.position[1]).toBeCloseTo(socket.aperture[1] + socket.vector[1] * socket.depthMm!, 8);
    expect(start?.position[2]).toBeCloseTo(socket.aperture[2] + socket.vector[2] * socket.depthMm!, 8);
    const pinPrimitive = viewer.geometry.get(socket.id)?.layers.find((layer) => layer.type === "pinTractAndOvershoot")?.primitives[0];
    expect(pinPrimitive?.supportRadiusMm).toBe(1.75);
  });

  it("keeps every device-chain selection explicitly incomplete", () => {
    const selection = configured("ALL", {
      femur: bone({ preparation: "anchor", diameterMm: 4, depthMm: 18 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const updated = replaceSimplifiedProcedure(createSyntheticDemoCase(), selection);
    const procedure = updated.procedures.at(-1)!;
    const channels = activeVariant(updated).channels.filter((channel) => channel.procedureId === procedure.id);
    expect(channels).toHaveLength(2);
    for (const channel of channels) {
      expect(channel.instrumentChain.completionState).toBe("incomplete");
      expect(channel.instrumentChain.manufacturerId).toBeNull();
      expect(channel.instrumentChain.productVariantId).toBeNull();
      expect(channel.instrumentChain.guideInstrumentId).toBeNull();
      expect(channel.instrumentChain.pinInstrumentId).toBeNull();
    }
    expect(readSimplifiedSelection(procedure)).toEqual(selection);
  });

  it("renders clinician-entered anchors as drilled sockets with an inline trajectory rod", () => {
    const selection = configured("MCL_POL_PMC", {
      femur: bone({ preparation: "anchor", count: 2, diameterMm: 4.75, depthMm: 22 }),
      tibia: bone({ preparation: "socket_with_guide_pin" }),
    });
    const plan = initializePendingChannelSurfacePlacements(
      replaceSimplifiedProcedure(createSyntheticDemoCase(), selection),
      buildSyntheticAnatomyMeshes(),
    );
    const procedure = plan.procedures.at(-1)!;
    const channels = activeVariant(plan).channels.filter((channel) => channel.procedureId === procedure.id);
    const anchor = channels.find((channel) => channel.geometryType === "anchor_pilot")!;
    const viewer = buildViewerScene({
      revision: 1,
      channels,
      procedureById: { [procedure.id]: procedure.structure },
      visibleProcedureIdentities: new Set(["MCL_POL_PMC"]),
      selectedChannelId: anchor.id,
      anatomyMeshes: buildSyntheticAnatomyMeshes(),
    });
    expect(viewer.scene.meshes.some((mesh) => mesh.channelId === anchor.id && mesh.layer === "boneRemoval")).toBe(true);
    expect(viewer.scene.handles.find((handle) => handle.channelId === anchor.id && handle.kind === "aperture")).toMatchObject({
      semanticRole: "start",
      label: `Start point - ${anchor.label}`,
      surfaceConstraint: expect.objectContaining({ mode: "nearest_surface" }),
    });
    expect(viewer.scene.handles.find((handle) => handle.channelId === anchor.id && handle.kind === "endpoint")).toMatchObject({
      semanticRole: "trajectory",
      label: `Trajectory - ${anchor.label}`,
      trajectoryPivotPatientRas: anchor.aperture,
    });
  });

  it("atomically replaces one structure while preserving unrelated procedure geometry", () => {
    const source = createSyntheticDemoCase();
    const unrelatedPclIds = new Set(activeVariant(source).channels.filter((channel) => {
      const procedure = source.procedures.find((item) => item.id === channel.procedureId);
      return procedure?.structure === "PCL";
    }).map((channel) => channel.id));
    const first = replaceSimplifiedProcedure(source, configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    }));
    const second = replaceSimplifiedProcedure(first, configured("ACL", {
      femur: bone({ bundle: "double_bundle", preparation: "full_tunnel" }),
      tibia: bone({ bundle: "double_bundle", preparation: "socket_with_guide_pin" }),
    }));
    const aclProcedureIds = new Set(second.procedures.filter((procedure) => procedure.structure === "ACL").map((procedure) => procedure.id));
    const aclChannels = activeVariant(second).channels.filter((channel) => aclProcedureIds.has(channel.procedureId));
    expect(aclChannels).toHaveLength(4);
    expect(activeVariant(second).channels.filter((channel) => unrelatedPclIds.has(channel.id))).toHaveLength(unrelatedPclIds.size);
    const activeIds = new Set(activeVariant(second).channels.map((channel) => channel.id));
    expect(activeVariant(second).sequence.every((step) => !step.channelId || activeIds.has(step.channelId))).toBe(true);
    expect(JSON.parse(JSON.stringify(second)).variants[0].channels).toEqual(second.variants[0].channels);
  });

  it("preserves a matched channel's patient-space placement, tethers, and edited dimensions", () => {
    const selection = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    });
    const first = initializePendingChannelSurfacePlacements(
      replaceSimplifiedProcedure(createSyntheticDemoCase(), selection),
      buildSyntheticAnatomyMeshes(),
    );
    const firstProcedure = first.procedures.at(-1)!;
    const authored = structuredClone(first);
    const femoralIndex = authored.variants[0].channels.findIndex((channel) =>
      channel.procedureId === firstProcedure.id && channel.semanticKey === "femur-single-1",
    );
    const femoral = authored.variants[0].channels[femoralIndex];
    femoral.aperture = [12, 21, 34];
    femoral.vector = [0.36, -0.48, 0.8];
    femoral.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [12, 21, 34],
      directionPatientRas: [0.36, -0.48, 0.8],
    };
    femoral.surfacePlacement = {
      state: "clinician_edited",
      method: "manual_trajectory_drag",
      meshIds: ["femur"],
      endpointMethod: "nearest_surface_projection",
    };
    femoral.diameterMm = 8.35;
    femoral.crossSection = { kind: "circle", diameterMm: 8.35 };
    femoral.depthMm = 23.5;
    femoral.orientationDeg = 17;
    femoral.dimensionsMm = { clinicianSettingMm: 4.2 };
    femoral.guidePin = { diameterMm: 4.1, provenance: "clinician_entered_planning_value" };
    const apertureAttachment = structuredClone(femoral.apertureSurfaceAttachment);
    const endpointAttachment = structuredClone(femoral.endpointSurfaceAttachment);

    const updated = replaceSimplifiedProcedure(authored, selection);
    const updatedProcedure = updated.procedures.at(-1)!;
    const preserved = activeVariant(updated).channels.find((channel) =>
      channel.procedureId === updatedProcedure.id && channel.semanticKey === "femur-single-1",
    )!;

    expect(preserved.aperture).toEqual([12, 21, 34]);
    expect(preserved.vector).toEqual([0.36, -0.48, 0.8]);
    expect(preserved.centerline).toEqual(femoral.centerline);
    expect(preserved.apertureSurfaceAttachment).toEqual(apertureAttachment);
    expect(preserved.endpointSurfaceAttachment).toEqual(endpointAttachment);
    expect(preserved.surfacePlacement).toEqual(femoral.surfacePlacement);
    expect(preserved.diameterMm).toBe(8.35);
    expect(preserved.crossSection).toEqual({ kind: "circle", diameterMm: 8.35 });
    expect(preserved.depthMm).toBe(23.5);
    expect(preserved.orientationDeg).toBe(17);
    expect(preserved.dimensionsMm).toEqual({ clinicianSettingMm: 4.2 });
    expect(preserved.guidePin).toEqual({ diameterMm: 4.1, provenance: "clinician_entered_planning_value" });
  });

  it("carries the first matched trajectory through a bundle/preparation change and leaves added channels pending", () => {
    const singleSelection = configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
      tibia: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
    });
    const first = replaceSimplifiedProcedure(createSyntheticDemoCase(), singleSelection);
    const firstProcedure = first.procedures.at(-1)!;
    const authored = structuredClone(first);
    const femoral = authored.variants[0].channels.find((channel) =>
      channel.procedureId === firstProcedure.id && channel.semanticKey === "femur-single-1",
    )!;
    femoral.aperture = [7, 8, 9];
    femoral.vector = [0, 1, 0];
    femoral.centerline = {
      kind: "rigid",
      aperturePatientRasMm: [7, 8, 9],
      directionPatientRas: [0, 1, 0],
    };
    femoral.surfacePlacement = {
      state: "clinician_edited",
      method: "manual_surface_drag",
      meshIds: ["femur-mask"],
      endpointMethod: "nearest_surface_projection",
    };

    const doubleSelection = configured("ACL", {
      femur: bone({ bundle: "double_bundle", preparation: "full_tunnel" }),
      tibia: bone({ bundle: "single_bundle", preparation: "socket_with_guide_pin" }),
    });
    const updated = replaceSimplifiedProcedure(authored, doubleSelection);
    const updatedProcedure = updated.procedures.at(-1)!;
    const femoralChannels = activeVariant(updated).channels.filter((channel) =>
      channel.procedureId === updatedProcedure.id && channel.bone === "femur",
    );
    const am = femoralChannels.find((channel) => channel.semanticKey === "femur-AM-1")!;
    const pl = femoralChannels.find((channel) => channel.semanticKey === "femur-PL-2")!;
    expect(am.geometryType).toBe("round_full_tunnel");
    expect(am.aperture).toEqual([7, 8, 9]);
    expect(am.vector).toEqual([0, 1, 0]);
    expect(am.surfacePlacement?.state).toBe("clinician_edited");
    expect(pl.aperture).toEqual([0, 0, 0]);
    expect(pl.surfacePlacement?.state).toBe("pending_default");
  });

  it("retains slider edits for an unchanged anchor selection but honors newly entered anchor values", () => {
    const initialSelection = configured("LET", {
      femur: bone({ preparation: "anchor", diameterMm: 4.5, depthMm: 20 }),
    });
    const first = replaceSimplifiedProcedure(createSyntheticDemoCase(), initialSelection);
    const firstProcedure = first.procedures.at(-1)!;
    const authored = structuredClone(first);
    const anchor = authored.variants[0].channels.find((channel) => channel.procedureId === firstProcedure.id)!;
    anchor.diameterMm = 5.25;
    anchor.crossSection = { kind: "circle", diameterMm: 5.25 };
    anchor.depthMm = 24;

    const unchanged = replaceSimplifiedProcedure(authored, initialSelection);
    const unchangedProcedure = unchanged.procedures.at(-1)!;
    const unchangedAnchor = activeVariant(unchanged).channels.find((channel) => channel.procedureId === unchangedProcedure.id)!;
    expect(unchangedAnchor.diameterMm).toBe(5.25);
    expect(unchangedAnchor.depthMm).toBe(24);

    const explicitlyChanged = replaceSimplifiedProcedure(unchanged, configured("LET", {
      femur: bone({ preparation: "anchor", diameterMm: 6, depthMm: 27 }),
    }));
    const changedProcedure = explicitlyChanged.procedures.at(-1)!;
    const changedAnchor = activeVariant(explicitlyChanged).channels.find((channel) => channel.procedureId === changedProcedure.id)!;
    expect(changedAnchor.diameterMm).toBe(6);
    expect(changedAnchor.crossSection).toEqual({ kind: "circle", diameterMm: 6 });
    expect(changedAnchor.depthMm).toBe(27);
  });

  it("uses bone/order fallback to preserve legacy channels that predate semantic keys", () => {
    const source = createSyntheticDemoCase();
    const legacyFemoral = activeVariant(source).channels.find((channel) => channel.id === "acl-femoral")!;
    expect(legacyFemoral.semanticKey).toBeUndefined();
    const updated = replaceSimplifiedProcedure(source, configured("ACL", {
      femur: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
      tibia: bone({ bundle: "single_bundle", preparation: "full_tunnel" }),
    }));
    const updatedProcedure = updated.procedures.at(-1)!;
    const newFemoral = activeVariant(updated).channels.find((channel) =>
      channel.procedureId === updatedProcedure.id && channel.bone === "femur",
    )!;
    expect(newFemoral.aperture).toEqual(legacyFemoral.aperture);
    expect(newFemoral.vector).toEqual(legacyFemoral.vector);
    expect(newFemoral.depthMm).toEqual(legacyFemoral.depthMm);
    expect(newFemoral.diameterMm).toEqual(legacyFemoral.diameterMm);
  });
});
