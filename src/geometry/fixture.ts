import type { IntentionalRelationship } from "./collision";
import { generateGeometry, type GeneratedGeometry, type GeometryRecipe } from "./recipes";
import { vec2, vec3 } from "./mesh";

export const MULTI_PROCEDURE_FIXTURE_VERSION = "1.0.0";

export interface FixtureChannel {
  id: string;
  procedure: "ACL" | "PCL" | "PLC/FCL" | "MCL/POL/PMC" | "ALL" | "LET" | "Medial Root" | "Lateral Root";
  structure: string;
  bone: "femur" | "tibia" | "fibula";
  recipe: GeometryRecipe;
  geometry: GeneratedGeometry;
}

export interface MultiProcedureFixture {
  id: string;
  version: string;
  coordinateConvention: string;
  syntheticNonclinical: true;
  channels: FixtureChannel[];
  intentionalRelationships: IntentionalRelationship[];
  absentSafetyAnatomy: string[];
}

/**
 * Deterministic synthetic workload containing the high-priority tunnel groups.
 * It is deliberately not anatomical and must never be presented as a plan.
 */
export function createMultiProcedureFixture(): MultiProcedureFixture {
  const recipes: Array<Omit<FixtureChannel, "geometry">> = [
    {
      id: "acl-femoral-retro",
      procedure: "ACL",
      structure: "ACL femoral socket",
      bone: "femur",
      recipe: {
        id: "acl-femoral-retro",
        type: "retroSocket",
        pilot: { start: vec3(-10, 0, 25), end: vec3(34, 0, 25) },
        pilotDiameterMm: 3.5,
        socket: { start: vec3(0, 0, 25), end: vec3(28, 0, 25) },
        socketDiameterMm: 9,
        corticalChannel: { start: vec3(28, 0, 25), end: vec3(34, 0, 25) },
        corticalChannelDiameterMm: 4,
        deployment: { start: vec3(-1, 0, 25), end: vec3(4, 0, 25) },
        deployedCutterDiameterMm: 9,
        safetyMarginMm: 1,
      },
    },
    {
      id: "acl-tibial-retro",
      procedure: "ACL",
      structure: "ACL tibial socket",
      bone: "tibia",
      recipe: {
        id: "acl-tibial-retro",
        type: "retroSocket",
        pilot: { start: vec3(-6, 2, -5), end: vec3(18, 2, 32) },
        pilotDiameterMm: 3.5,
        socket: { start: vec3(0, 2, 4), end: vec3(12, 2, 23) },
        socketDiameterMm: 9,
        corticalChannel: { start: vec3(12, 2, 23), end: vec3(18, 2, 32) },
        corticalChannelDiameterMm: 4,
        deployment: { start: vec3(-1, 2, 3), end: vec3(3, 2, 9) },
        deployedCutterDiameterMm: 9,
      },
    },
    {
      id: "pcl-femoral-al",
      procedure: "PCL",
      structure: "PCL anterolateral femoral socket",
      bone: "femur",
      recipe: {
        id: "pcl-femoral-al",
        type: "blindSocket",
        socket: { start: vec3(0, -20, 21), end: vec3(26, -20, 21) },
        socketDiameterMm: 10,
        pilot: { tract: { start: vec3(-4, -20, 21), end: vec3(28, -20, 21) }, diameterMm: 2.4 },
      },
    },
    {
      id: "pcl-femoral-pm",
      procedure: "PCL",
      structure: "PCL posteromedial femoral socket",
      bone: "femur",
      recipe: {
        id: "pcl-femoral-pm",
        type: "blindSocket",
        socket: { start: vec3(0, -29, 20), end: vec3(23, -29, 20) },
        socketDiameterMm: 7,
        pilot: { tract: { start: vec3(-4, -29, 20), end: vec3(25, -29, 20) }, diameterMm: 2.4 },
      },
    },
    {
      id: "pcl-tibial",
      procedure: "PCL",
      structure: "PCL transtibial tunnel",
      bone: "tibia",
      recipe: {
        id: "pcl-tibial",
        type: "fullTunnel",
        tunnel: { start: vec3(-10, -18, -7), end: vec3(16, -18, 35) },
        diameterMm: 10,
        safetyMarginMm: 1,
      },
    },
    {
      id: "pcl-posterior-pin",
      procedure: "PCL",
      structure: "PCL posterior guide pin",
      bone: "tibia",
      recipe: {
        id: "pcl-posterior-pin",
        type: "rigidPin",
        tract: { start: vec3(-10, -18, -7), end: vec3(16, -18, 35) },
        diameterMm: 2.4,
        tipOvershootMm: 12,
      },
    },
    {
      id: "fcl-femoral",
      procedure: "PLC/FCL",
      structure: "FCL femoral socket",
      bone: "femur",
      recipe: {
        id: "fcl-femoral",
        type: "blindSocket",
        socket: { start: vec3(0, 6, 25), end: vec3(25, 6, 25) },
        socketDiameterMm: 6,
        pilot: { tract: { start: vec3(-5, 6, 25), end: vec3(27, 6, 25) }, diameterMm: 2.4 },
      },
    },
    {
      id: "popliteus-femoral",
      procedure: "PLC/FCL",
      structure: "Popliteus femoral socket",
      bone: "femur",
      recipe: {
        id: "popliteus-femoral",
        type: "blindSocket",
        socket: { start: vec3(0, 15, 24), end: vec3(24, 15, 24) },
        socketDiameterMm: 6,
      },
    },
    {
      id: "all-femoral-independent",
      procedure: "ALL",
      structure: "Independent ALL femoral socket",
      bone: "femur",
      recipe: {
        id: "all-femoral-independent",
        type: "blindSocket",
        socket: { start: vec3(1, 10, 27), end: vec3(20, 10, 27) },
        socketDiameterMm: 5,
        pilot: { tract: { start: vec3(-3, 10, 27), end: vec3(22, 10, 27) }, diameterMm: 2.4 },
      },
    },
    {
      id: "plc-fibular-head",
      procedure: "PLC/FCL",
      structure: "Fibular-head tunnel",
      bone: "fibula",
      recipe: {
        id: "plc-fibular-head",
        type: "profileTunnel",
        tunnel: { start: vec3(-25, 20, -14), end: vec3(-3, 20, -14) },
        profile: { kind: "ellipse", widthMm: 6, heightMm: 5 },
        orientationDeg: 20,
      },
    },
    {
      id: "plc-tibial",
      procedure: "PLC/FCL",
      structure: "PLC tibial tunnel",
      bone: "tibia",
      recipe: {
        id: "plc-tibial",
        type: "fullTunnel",
        tunnel: { start: vec3(-12, -10, 0), end: vec3(20, -10, 27) },
        diameterMm: 8,
      },
    },
    {
      id: "smcl-femoral",
      procedure: "MCL/POL/PMC",
      structure: "sMCL femoral socket",
      bone: "femur",
      recipe: {
        id: "smcl-femoral",
        type: "blindSocket",
        socket: { start: vec3(1, -13, 21), end: vec3(23, -13, 21) },
        socketDiameterMm: 6,
      },
    },
    {
      id: "medial-root-a",
      procedure: "Medial Root",
      structure: "Medial root pullout A",
      bone: "tibia",
      recipe: {
        id: "medial-root-a",
        type: "fullTunnel",
        tunnel: { start: vec3(-8, 7, -4), end: vec3(14, 7, 30) },
        diameterMm: 3.5,
      },
    },
    {
      id: "medial-root-b",
      procedure: "Medial Root",
      structure: "Medial root pullout B",
      bone: "tibia",
      recipe: {
        id: "medial-root-b",
        type: "fullTunnel",
        tunnel: { start: vec3(-8, 12, -4), end: vec3(14, 12, 30) },
        diameterMm: 3.5,
      },
    },
    {
      id: "lateral-root-anchor",
      procedure: "Lateral Root",
      structure: "Direct root anchor",
      bone: "tibia",
      recipe: {
        id: "lateral-root-anchor",
        type: "anchor",
        pilot: { start: vec3(2, 17, 25), end: vec3(2, 17, 17) },
        pilotDiameterMm: 2.4,
        anchor: { body: { start: vec3(2, 17, 25), end: vec3(2, 17, 19) }, diameterMm: 3.5 },
      },
    },
    {
      id: "let-onlay",
      procedure: "LET",
      structure: "No-large-tunnel LET onlay",
      bone: "femur",
      recipe: {
        id: "let-onlay",
        type: "noLargeTunnel",
        noLargeTunnel: true,
        smallPilots: [
          { tract: { start: vec3(4, 24, 23), end: vec3(11, 24, 23) }, diameterMm: 2.6 },
          { tract: { start: vec3(4, 29, 23), end: vec3(11, 29, 23) }, diameterMm: 2.6 },
        ],
        retainedFixation: [
          { body: { start: vec3(4, 24, 23), end: vec3(9, 24, 23) }, diameterMm: 3.5, label: "LET anchor A" },
          { body: { start: vec3(4, 29, 23), end: vec3(9, 29, 23) }, diameterMm: 3.5, label: "LET anchor B" },
        ],
      },
    },
    {
      id: "pcl-inlay-trough",
      procedure: "PCL",
      structure: "PCL inlay trough",
      bone: "tibia",
      recipe: {
        id: "pcl-inlay-trough",
        type: "trough",
        recess: { start: vec3(-20, -28, 2), end: vec3(-20, -28, 10) },
        profile: {
          kind: "polygon",
          points: [vec2(-7, -4), vec2(7, -4), vec2(8, 3), vec2(3, 6), vec2(-5, 5)],
        },
        orientationDeg: 15,
        wallSlopeDeg: 8,
      },
    },
  ];

  return {
    id: "synthetic-multiligament-performance-fixture",
    version: MULTI_PROCEDURE_FIXTURE_VERSION,
    coordinateConvention: "Synthetic patient space in millimetres; +X lateral, +Y anterior, +Z superior",
    syntheticNonclinical: true,
    channels: recipes.map((entry) => ({ ...entry, geometry: generateGeometry(entry.recipe) })),
    intentionalRelationships: [],
    absentSafetyAnatomy: ["posteriorNeurovascular", "physis", "previousHardware", "articularSurface"],
  };
}
