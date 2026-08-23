import { describe, expect, it } from "vitest";
import type { ViewerMeshPayload } from "../viewer/types";
import {
  projectIntraArticularEntryToTibialPlateau,
  projectPatientRasPointToMesh,
  projectPatientRasPointToTibialSuperiorEnvelope,
  type TibialPlateauSurfaceRegion,
} from "./surfaceTether";

const squareMesh = (): ViewerMeshPayload => ({
  id: "tibia-surface",
  name: "Reviewed tibia surface",
  vertices: [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ],
  faces: [[0, 1, 2], [0, 2, 3]],
  color: "#fff",
  opacity: 1,
  layer: "bones",
  anatomyBone: "tibia",
  analysisCategory: "tibia",
});

const reviewedPlateau = (overrides: Partial<TibialPlateauSurfaceRegion> = {}): TibialPlateauSurfaceRegion => ({
  id: "plateau-region-1",
  bone: "tibia",
  anatomyRegion: "tibial_plateau",
  meshId: "tibia-surface",
  faceIndices: [1],
  sourceAssetId: "labelmap-sha256-plateau",
  method: "clinician_annotation",
  reviewStatus: "approved",
  verifiedBy: "clinician-1",
  verifiedAt: "2026-08-02T14:00:00Z",
  ...overrides,
});

describe("patient-RAS surface tethering", () => {
  it("projects to the exact nearest point on a specified mesh triangle", () => {
    const result = projectPatientRasPointToMesh([7.5, 2.5, 5], squareMesh());
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.closestPointPatientRasMm).toEqual([7.5, 2.5, 0]);
    expect(result.distanceMm).toBe(5);
    expect(result.squaredDistanceMm2).toBe(25);
    expect(result.triangle).toEqual({
      meshId: "tibia-surface",
      faceIndex: 0,
      vertexIndices: [0, 1, 2],
      stableId: "tibia-surface:face:0",
    });
    expect(result.barycentric.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    expect(result.surfaceNormalPatientRas).toEqual([0, 0, 1]);
    expect(result.coordinateSpace).toBe("patient_ras");
    expect(result.units).toBe("mm");
  });

  it("projects to triangle edges rather than an infinite plane", () => {
    const result = projectPatientRasPointToMesh([14, 3, 0], squareMesh());
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.closestPointPatientRasMm).toEqual([10, 3, 0]);
    expect(result.distanceMm).toBe(4);
    expect(result.triangle.faceIndex).toBe(0);
  });

  it("uses stable face-order tie breaking independent of mask ordering", () => {
    const result = projectPatientRasPointToMesh([5, 5, 3], squareMesh(), { faceIndices: [1, 0, 1] });
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.triangle.faceIndex).toBe(0);
    expect(result.closestPointPatientRasMm).toEqual([5, 5, 0]);
  });

  it("constrains tibial entry to only the explicitly reviewed plateau faces", () => {
    const mesh = squareMesh();
    mesh.vertices.push([0, 0, 10], [10, 0, 10], [0, 10, 10]);
    mesh.faces.push([4, 5, 6]);
    const region = reviewedPlateau({ faceIndices: [2] });

    const unconstrained = projectPatientRasPointToMesh([2, 2, 1], mesh);
    const constrained = projectIntraArticularEntryToTibialPlateau([2, 2, 1], mesh, region);
    expect(unconstrained.status).toBe("projected");
    expect(constrained.status).toBe("projected");
    if (unconstrained.status !== "projected" || constrained.status !== "projected") return;
    expect(unconstrained.closestPointPatientRasMm).toEqual([2, 2, 0]);
    expect(constrained.closestPointPatientRasMm).toEqual([2, 2, 10]);
    expect(constrained.distanceMm).toBe(9);
    expect(constrained.triangle.faceIndex).toBe(2);
    expect(constrained.constraint).toEqual({
      kind: "tibial_plateau_region",
      regionId: "plateau-region-1",
      sourceAssetId: "labelmap-sha256-plateau",
      verifiedBy: "clinician-1",
      verifiedAt: "2026-08-02T14:00:00Z",
    });
  });

  it("does not infer a plateau when the explicit region is absent or unapproved", () => {
    const missing = projectIntraArticularEntryToTibialPlateau([2, 2, 3], squareMesh(), null);
    const unapproved = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      reviewedPlateau({ reviewStatus: "needs_correction" }),
    );
    expect(missing).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_missing" });
    expect(unapproved).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_unapproved" });
  });

  it("fails closed for missing provenance, mesh mismatch, and invalid masks", () => {
    const unverified = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      reviewedPlateau({ verifiedBy: null }),
    );
    const mismatch = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      reviewedPlateau({ meshId: "different-tibia" }),
    );
    const invalidMask = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      reviewedPlateau({ faceIndices: [99] }),
    );
    expect(unverified).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_unverified" });
    expect(mismatch).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_mesh_mismatch" });
    expect(invalidMask).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_invalid" });
  });

  it("runtime-validates the region and mesh anatomy identities before approving a plateau", () => {
    const wrongRegionBone = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      { ...reviewedPlateau(), bone: "femur" } as unknown as TibialPlateauSurfaceRegion,
    );
    const wrongRegionName = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      squareMesh(),
      { ...reviewedPlateau(), anatomyRegion: "proximal_tibia" } as unknown as TibialPlateauSurfaceRegion,
    );
    const wrongMesh = squareMesh();
    wrongMesh.anatomyBone = "femur";
    const wrongMeshIdentity = projectIntraArticularEntryToTibialPlateau(
      [2, 2, 3],
      wrongMesh,
      reviewedPlateau(),
    );

    expect(wrongRegionBone).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_invalid" });
    expect(wrongRegionName).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_invalid" });
    expect(wrongMeshIdentity).toMatchObject({ status: "not_evaluated", reason: "tibial_plateau_region_mesh_mismatch" });
  });

  it("skips degenerate faces and reports not evaluated when none remain", () => {
    const mesh = squareMesh();
    mesh.faces = [[0, 0, 0]];
    const result = projectPatientRasPointToMesh([2, 2, 3], mesh);
    expect(result).toMatchObject({
      status: "not_evaluated",
      reason: "no_valid_triangles",
      units: "mm",
      coordinateSpace: "patient_ras",
    });
  });

  it("rejects non-finite dragged coordinates without projecting", () => {
    const result = projectPatientRasPointToMesh([Number.NaN, 2, 3], squareMesh());
    expect(result).toMatchObject({ status: "not_evaluated", reason: "invalid_point" });
  });
});

describe("user-defined tibial superior envelope", () => {
  const layeredTibia = (): ViewerMeshPayload => ({
    id: "layered-tibia",
    name: "Tibia with inferior and superior surfaces",
    vertices: [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
      [0, 0, 10],
      [10, 0, 10],
      [10, 10, 10],
      [0, 10, 10],
    ],
    faces: [
      [0, 1, 2], [0, 2, 3],
      [4, 5, 6], [4, 6, 7],
    ],
    color: "#fff",
    opacity: 1,
    layer: "bones",
    anatomyBone: "tibia",
    analysisCategory: "tibia",
  });

  it("selects the highest vertical intersection rather than the surface nearest source Z", () => {
    const result = projectPatientRasPointToTibialSuperiorEnvelope([2, 2, -1], layeredTibia());
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;

    expect(result.closestPointPatientRasMm[0]).toBeCloseTo(2, 12);
    expect(result.closestPointPatientRasMm[1]).toBeCloseTo(2, 12);
    expect(result.closestPointPatientRasMm[2]).toBe(10);
    expect(result.distanceMm).toBeCloseTo(11, 12);
    expect(result.triangle.faceIndex).toBe(2);
    expect(result.barycentric[0]).toBeCloseTo(0.8, 12);
    expect(result.barycentric[1]).toBeCloseTo(0, 12);
    expect(result.barycentric[2]).toBeCloseTo(0.2, 12);
    expect(result.constraint).toEqual({
      kind: "tibial_superior_envelope",
      definition: "maximum_patient_ras_z_at_requested_xy",
      method: "user_defined_superior_envelope",
      ruleVersion: "1",
      sourceMeshId: "layered-tibia",
      reviewStatus: "not_clinician_approved",
      resolution: "vertical_intersection",
      xyDistanceMm: 0,
    });
  });

  it("interpolates the superior Z and exact barycentric identity on a sloped triangle", () => {
    const mesh = layeredTibia();
    mesh.vertices = [[0, 0, 4], [10, 0, 14], [0, 10, 24]];
    mesh.faces = [[0, 1, 2]];

    const result = projectPatientRasPointToTibialSuperiorEnvelope([2, 3, -20], mesh);
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;

    expect(result.closestPointPatientRasMm[0]).toBeCloseTo(2, 12);
    expect(result.closestPointPatientRasMm[1]).toBeCloseTo(3, 12);
    expect(result.closestPointPatientRasMm[2]).toBeCloseTo(12, 12);
    expect(result.barycentric[0]).toBeCloseTo(0.5, 12);
    expect(result.barycentric[1]).toBeCloseTo(0.2, 12);
    expect(result.barycentric[2]).toBeCloseTo(0.3, 12);
    expect(Math.hypot(...result.surfaceNormalPatientRas)).toBeCloseTo(1, 12);
  });

  it("falls back outside the XY footprint to the nearest supported point, then chooses its highest Z", () => {
    const result = projectPatientRasPointToTibialSuperiorEnvelope([14, 3, 10], layeredTibia());
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;

    expect(result.closestPointPatientRasMm).toEqual([10, 3, 10]);
    expect(result.distanceMm).toBe(4);
    expect(result.triangle.faceIndex).toBe(2);
    expect(result.constraint).toMatchObject({
      kind: "tibial_superior_envelope",
      resolution: "nearest_xy_fallback",
      xyDistanceMm: 4,
      reviewStatus: "not_clinician_approved",
    });
  });

  it("breaks equal-Z ties by stable face index", () => {
    const mesh = layeredTibia();
    mesh.vertices.push([0, 0, 10], [10, 0, 10], [10, 10, 10]);
    mesh.faces.push([8, 9, 10]);

    const result = projectPatientRasPointToTibialSuperiorEnvelope([7, 2, 100], mesh);
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.closestPointPatientRasMm[0]).toBeCloseTo(7, 12);
    expect(result.closestPointPatientRasMm[1]).toBeCloseTo(2, 12);
    expect(result.closestPointPatientRasMm[2]).toBe(10);
    expect(result.triangle.faceIndex).toBe(2);
    expect(result.triangle.stableId).toBe("layered-tibia:face:2");
  });

  it("selects the superior point when an edge-on triangle has collapsed XY support", () => {
    const mesh = layeredTibia();
    mesh.vertices = [[2, 2, 0], [2, 2, 15], [2, 4, 7]];
    mesh.faces = [[0, 1, 2]];

    const result = projectPatientRasPointToTibialSuperiorEnvelope([2, 2, -10], mesh);
    expect(result.status).toBe("projected");
    if (result.status !== "projected") return;
    expect(result.closestPointPatientRasMm).toEqual([2, 2, 15]);
    expect(result.barycentric).toEqual([0, 1, 0]);
    expect(result.constraint).toMatchObject({ resolution: "vertical_intersection", xyDistanceMm: 0 });
  });

  it("fails closed for a non-tibia identity and malformed triangle references", () => {
    const wrongBone = layeredTibia();
    wrongBone.anatomyBone = "femur";
    const malformed = layeredTibia();
    malformed.faces = [[0, 1, 99]];

    expect(projectPatientRasPointToTibialSuperiorEnvelope([2, 2, 0], wrongBone)).toMatchObject({
      status: "not_evaluated",
      reason: "tibial_plateau_region_mesh_mismatch",
    });
    expect(projectPatientRasPointToTibialSuperiorEnvelope([2, 2, 0], malformed)).toMatchObject({
      status: "not_evaluated",
      reason: "invalid_mesh",
    });
  });
});
