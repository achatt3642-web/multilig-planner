import { describe, expect, it } from "vitest";
import { generateGeometry, type GeometryRecipe } from "./recipes";
import { vec2, vec3, type ProfileDefinition } from "./mesh";

const xSegment = (start: number, end: number, y = 0, z = 0) => ({
  start: vec3(start, y, z),
  end: vec3(end, y, z),
});

describe("parametric geometry recipes", () => {
  it("keeps retro pilot, socket, cortical channel, and deployment as distinct volumes", () => {
    const base: GeometryRecipe = {
      id: "retro",
      type: "retroSocket",
      pilot: xSegment(-5, 35),
      pilotDiameterMm: 3.5,
      socket: xSegment(0, 25),
      socketDiameterMm: 9,
      corticalChannel: xSegment(25, 35),
      corticalChannelDiameterMm: 4,
      deployment: xSegment(-1, 4),
      deployedCutterDiameterMm: 9,
    };
    const initial = generateGeometry(base);
    const deeper = generateGeometry({ ...base, socket: xSegment(0, 30) });
    expect(initial.complete).toBe(true);
    expect(initial.layers.map((layer) => layer.type)).toEqual([
      "boneRemovalOrCompaction",
      "pinTractAndOvershoot",
      "cutterDeploymentRetraction",
    ]);
    expect(initial.layers[0].primitives).toHaveLength(3);
    expect(initial.layers[1].primitives[0].supportRadiusMm).toBe(1.75);
    expect(generateGeometry({ ...base, pilotDiameterMm: 4 }).geometryHash).not.toBe(initial.geometryHash);
    const initialCortical = initial.layers[0].primitives.find((part) => part.sourceComponent === "cortical channel");
    const deeperCortical = deeper.layers[0].primitives.find((part) => part.sourceComponent === "cortical channel");
    expect(deeper.geometryHash).not.toBe(initial.geometryHash);
    expect(deeperCortical).toEqual(initialCortical);
  });

  it("keeps the flexible access sweep separate from the straight final socket", () => {
    const geometry = generateGeometry({
      id: "flex",
      type: "flexibleReamedSocket",
      socket: xSegment(0, 25),
      socketDiameterMm: 9,
      accessPath: [vec3(-15, -12, 0), vec3(-8, -5, 0), vec3(0, 0, 0)],
      accessDiameterMm: 5,
      minimumBendRadiusMm: 35,
    });
    expect(geometry.layers).toHaveLength(2);
    expect(geometry.layers[0].type).toBe("boneRemovalOrCompaction");
    expect(geometry.layers[0].primitives[0].segments).toHaveLength(1);
    expect(geometry.layers[1].type).toBe("instrumentAccessSweptVolume");
    expect(geometry.layers[1].primitives[0].segments).toHaveLength(2);
  });

  it("models rigid and flexible guide-pin overshoot", () => {
    const rigid = generateGeometry({
      id: "rigid-pin",
      type: "rigidPin",
      tract: xSegment(0, 30),
      diameterMm: 2.4,
      tipOvershootMm: 8,
    });
    const flexible = generateGeometry({
      id: "flex-pin",
      type: "flexiblePin",
      path: [vec3(0, 0, 0), vec3(10, 3, 0), vec3(25, 3, 0)],
      diameterMm: 2.4,
      tipOvershootMm: 8,
      minimumBendRadiusMm: 30,
    });
    expect(rigid.layers[0].primitives).toHaveLength(2);
    expect(flexible.layers[0].primitives[0].segments).toHaveLength(2);
    expect(flexible.layers[0].primitives).toHaveLength(2);
  });

  it("keeps a full-tunnel guide pin and overshoot in a separate analyzable layer", () => {
    const geometry = generateGeometry({
      id: "pcl-transtibial",
      type: "fullTunnel",
      tunnel: xSegment(0, 40),
      diameterMm: 10,
      pinDiameterMm: 2.4,
      tipOvershootMm: 12,
    });
    expect(geometry.complete).toBe(true);
    expect(geometry.layers.map((layer) => layer.type)).toEqual([
      "boneRemovalOrCompaction",
      "pinTractAndOvershoot",
    ]);
    expect(geometry.layers[1].primitives).toHaveLength(2);
    expect(geometry.layers[1].primitives[1].segments[0].end.x).toBe(52);
  });

  const profiles: ProfileDefinition[] = [
    { kind: "ellipse", widthMm: 9, heightMm: 6 },
    { kind: "stadium", widthMm: 10, heightMm: 4 },
    { kind: "rectangle", widthMm: 9, heightMm: 4 },
    { kind: "roundedRectangle", widthMm: 9, heightMm: 4, cornerRadiusMm: 1 },
    { kind: "cProfile", outerRadiusMm: 5, innerRadiusMm: 2, gapAngleDeg: 60 },
    { kind: "slot", lengthMm: 10, widthMm: 3 },
    { kind: "ribbon", widthMm: 10, thicknessMm: 2 },
    { kind: "polygon", points: [vec2(-4, -2), vec2(4, -2), vec2(3, 2), vec2(-3, 2)] },
    { kind: "importedProfile", sourceId: "profile-1", points: [vec2(-4, -2), vec2(4, -2), vec2(2, 3), vec2(-3, 2)] },
  ];

  it("preserves every supported noncircular cross-section and orientation", () => {
    const geometries = profiles.map((profile, index) => generateGeometry({
      id: `profile-${index}`,
      type: "profileTunnel",
      tunnel: xSegment(0, 25),
      profile,
      orientationDeg: 17,
      twistDeg: 8,
    }));
    expect(new Set(geometries.map((geometry) => geometry.geometryHash)).size).toBe(profiles.length);
    geometries.forEach((geometry, index) => {
      expect(geometry.complete).toBe(true);
      expect(geometry.layers[0].metadata).toMatchObject({
        profileKind: profiles[index].kind,
        orientationDeg: 17,
        twistDeg: 8,
      });
      expect(geometry.layers[0].mesh.indices.length).toBeGreaterThan(0);
      expect(geometry.layers[0].primitives[0].analysisMode).toBe("conservativeSupportRadius");
    });
  });

  it("emits distinct layers for advanced preparation and retained hardware recipes", () => {
    const recipes: Array<{ recipe: GeometryRecipe; expected: string[] }> = [
      {
        recipe: {
          id: "overlap",
          type: "overlappingDilator",
          pilotHoles: [
            { tract: xSegment(0, 25, -2), diameterMm: 4.5 },
            { tract: xSegment(0, 25, 0), diameterMm: 4.5 },
            { tract: xSegment(0, 25, 2), diameterMm: 4.5 },
          ],
          finalTunnel: xSegment(0, 25),
          finalProfile: { kind: "cProfile", outerRadiusMm: 5, innerRadiusMm: 2, gapAngleDeg: 70 },
          orientationDeg: 12,
          finalPreparation: "compacted",
          dilatorAccess: { segment: xSegment(-10, 25), profile: { kind: "rectangle", widthMm: 10, heightMm: 6 } },
        },
        expected: ["boneRemovalOrCompaction", "boneRemovalOrCompaction", "instrumentAccessSweptVolume"],
      },
      {
        recipe: {
          id: "dilated",
          type: "sequentialDilated",
          tunnel: xSegment(0, 30),
          stages: [
            { profile: { kind: "ellipse", widthMm: 6, heightMm: 5 } },
            { profile: { kind: "ellipse", widthMm: 8, heightMm: 6 } },
          ],
          orientationDeg: 20,
          mode: "compacted",
        },
        expected: ["boneRemovalOrCompaction", "boneRemovalOrCompaction"],
      },
      {
        recipe: {
          id: "coring",
          type: "coringTrephine",
          cut: xSegment(0, 25),
          innerDiameterMm: 8,
          outerDiameterMm: 10,
          coreState: "separable",
          distalPredrill: { tract: xSegment(20, 30), diameterMm: 11 },
        },
        expected: ["boneRemovalOrCompaction", "graftOrBoneBlock", "boneRemovalOrCompaction"],
      },
      {
        recipe: {
          id: "anchor",
          type: "anchor",
          pilot: xSegment(0, 10),
          pilotDiameterMm: 2.4,
          punchDiameterMm: 2.8,
          tapMajorDiameterMm: 3.5,
          anchor: { body: xSegment(0, 8), diameterMm: 4 },
          accessPath: { points: [vec3(-10, -4, 0), vec3(0, 0, 0)], diameterMm: 5 },
        },
        expected: ["boneRemovalOrCompaction", "retainedFixation", "instrumentAccessSweptVolume"],
      },
      {
        recipe: {
          id: "screw",
          type: "interferenceScrew",
          screw: xSegment(0, 25),
          screwOuterDiameterMm: 9,
          screwCoreDiameterMm: 5,
          sheath: { body: xSegment(0, 25), outerDiameterMm: 10 },
          graft: { body: xSegment(0, 25, 2), diameterMm: 8 },
        },
        expected: ["retainedFixation", "retainedFixation", "graftOrBoneBlock"],
      },
      {
        recipe: {
          id: "button",
          type: "corticalButton",
          channel: xSegment(0, 8),
          channelDiameterMm: 4.5,
          button: { body: xSegment(8, 9), profile: { kind: "roundedRectangle", widthMm: 12, heightMm: 4, cornerRadiusMm: 1 } },
          flipEnvelope: { path: xSegment(7, 16), diameterMm: 14 },
        },
        expected: ["boneRemovalOrCompaction", "surfaceHardwareAndFlipDeployment", "surfaceHardwareAndFlipDeployment"],
      },
      {
        recipe: {
          id: "post",
          type: "postWasher",
          pilot: xSegment(0, 15),
          pilotDiameterMm: 3.2,
          post: xSegment(0, 14),
          postDiameterMm: 5,
          washer: { body: xSegment(0, 1), profile: { kind: "ellipse", widthMm: 12, heightMm: 12 } },
        },
        expected: ["boneRemovalOrCompaction", "retainedFixation", "surfaceHardwareAndFlipDeployment"],
      },
      {
        recipe: {
          id: "staple",
          type: "staple",
          legPilots: [{ tract: xSegment(0, 12, -3), diameterMm: 2.5 }, { tract: xSegment(0, 12, 3), diameterMm: 2.5 }],
          retainedLegs: [{ body: xSegment(0, 11, -3), diameterMm: 3 }, { body: xSegment(0, 11, 3), diameterMm: 3 }],
          bridge: { body: xSegment(0, 2), profile: { kind: "rectangle", widthMm: 10, heightMm: 3 } },
        },
        expected: ["boneRemovalOrCompaction", "retainedFixation", "surfaceHardwareAndFlipDeployment"],
      },
      {
        recipe: {
          id: "trough",
          type: "trough",
          recess: xSegment(0, 8),
          profile: { kind: "polygon", points: [vec2(-7, -4), vec2(7, -4), vec2(6, 5), vec2(-5, 6)] },
          orientationDeg: 10,
          wallSlopeDeg: 8,
          accessEnvelope: { path: [vec3(-10, -6, 0), vec3(0, 0, 0)], diameterMm: 8 },
        },
        expected: ["boneRemovalOrCompaction", "instrumentAccessSweptVolume"],
      },
      {
        recipe: {
          id: "chamfer",
          type: "chamfer",
          cut: xSegment(0, 4),
          apertureDiameterMm: 12,
          innerDiameterMm: 8,
          accessEnvelope: { path: xSegment(-8, 4), diameterMm: 6 },
        },
        expected: ["boneRemovalOrCompaction", "instrumentAccessSweptVolume"],
      },
      {
        recipe: {
          id: "onlay",
          type: "noLargeTunnel",
          noLargeTunnel: true,
          smallPilots: [{ tract: xSegment(0, 8), diameterMm: 2.4 }],
          retainedFixation: [{ body: xSegment(0, 6), diameterMm: 3.5 }],
        },
        expected: ["boneRemovalOrCompaction", "retainedFixation"],
      },
    ];

    for (const { recipe, expected } of recipes) {
      const geometry = generateGeometry(recipe);
      expect(geometry.complete, `${recipe.id} should be complete`).toBe(true);
      expect(geometry.layers.map((layer) => layer.type)).toEqual(expected);
      expect(geometry.layers.every((layer) => layer.mesh.positions.length > 0)).toBe(true);
    }
  });

  it("adds an independently selectable safety layer", () => {
    const geometry = generateGeometry({
      id: "margin",
      type: "fullTunnel",
      tunnel: xSegment(0, 20),
      diameterMm: 8,
      safetyMarginMm: 2,
    });
    expect(geometry.layers.map((layer) => layer.type)).toEqual(["boneRemovalOrCompaction", "safetyMargin"]);
    expect(geometry.layers[1].primitives[0].supportRadiusMm).toBe(6);
  });

  it("keeps missing device dimensions explicit and suppresses false geometry", () => {
    const geometry = generateGeometry({
      id: "unknown-anchor",
      type: "anchor",
      pilot: xSegment(0, 8),
      pilotDiameterMm: null,
      anchor: { body: xSegment(0, 6), diameterMm: null },
    });
    expect(geometry.complete).toBe(false);
    expect(geometry.missingDimensions).toEqual(["anchor.diameterMm", "pilotDiameterMm"]);
    expect(geometry.layers).toHaveLength(0);
  });
});
