import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ViewerMeshPayload } from "../viewer/types";
import { deriveAnatomicReferenceFrame } from "./anatomicReferencePlanes";

const femurPath = process.env.MULTILIG_FEMUR_MESH;
const tibiaPath = process.env.MULTILIG_TIBIA_MESH;
const patientIt = femurPath && tibiaPath ? it : it.skip;

interface StoredViewerMesh {
  bone: "femur" | "tibia";
  vertices: number[][];
  faces: number[][];
}

function loadPatientMesh(path: string, bone: "femur" | "tibia"): ViewerMeshPayload {
  const stored = JSON.parse(readFileSync(path, "utf8")) as StoredViewerMesh;
  if (stored.bone !== bone) throw new Error(`Expected ${bone} mesh at ${path}`);
  return {
    id: `patient-${bone}`,
    name: `${bone} patient regression mesh`,
    vertices: stored.vertices,
    faces: stored.faces,
    color: "#ccd6d8",
    opacity: 0.22,
    layer: "bones",
    anatomyBone: bone,
  };
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("current de-identified MRI anatomic reference planes", () => {
  patientIt("derives the requested three-point tibial joint plane for the current right-knee mesh", () => {
    const frame = deriveAnatomicReferenceFrame([
      loadPatientMesh(femurPath!, "femur"),
      loadPatientMesh(tibiaPath!, "tibia"),
    ], {
      laterality: "right",
      lateralityVerified: false,
      scaleVerified: false,
    });

    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;
    expect(frame.algorithmVersion).toBe("4");
    expect(frame.jointLineDefinition).toMatchObject({
      method: "three_tibial_plateau_fourth_points",
      ruleVersion: "1",
      medialLateralAssignment: "provisional_patient_right_is_lateral",
      lateralityUsed: "right",
    });

    const expectedLandmarks = {
      lateralSuperiorPointPatientRasMm: [95.366338, -16.123224, -22.462293],
      medialSuperiorPointPatientRasMm: [39.015179, -9.676253, -26.47271],
      medialPosteriorSuperiorPointPatientRasMm: [43.376481, -23.911348, -26.47271],
    } as const;
    for (const [key, expected] of Object.entries(expectedLandmarks)) {
      const actual = frame.jointLineDefinition[key as keyof typeof expectedLandmarks];
      actual.forEach((component, index) => expect(component).toBeCloseTo(expected[index], 5));
      const offsetFromPlane = actual.map(
        (component, index) => component - frame.jointLine.originPatientRasMm[index],
      );
      expect(Math.abs(dot(offsetFromPlane, frame.jointLine.normalPatientRas))).toBeLessThan(1e-6);
    }

    const definition = frame.jointLineDefinition;
    expect(definition.lateralSuperiorPointPatientRasMm[0]).toBeGreaterThanOrEqual(
      definition.lateralFourthMinimumLateralProjectionMm,
    );
    expect(definition.medialSuperiorPointPatientRasMm[0]).toBeLessThanOrEqual(
      definition.medialFourthMaximumLateralProjectionMm,
    );
    expect(definition.medialPosteriorSuperiorPointPatientRasMm[0]).toBeLessThanOrEqual(
      definition.medialFourthMaximumLateralProjectionMm,
    );
    expect(definition.lateralSuperiorPointPatientRasMm[0]).toBeGreaterThan(
      definition.lateralTibialSpinePointPatientRasMm[0],
    );
    expect(definition.medialLandmarkSeparationMm).toBeGreaterThanOrEqual(
      definition.minimumMedialLandmarkSeparationMm,
    );
    expect(definition.medialPosteriorOffsetMm).toBeGreaterThanOrEqual(
      definition.minimumMedialPosteriorOffsetMm,
    );
    expect(definition.triangleSine).toBeGreaterThanOrEqual(definition.minimumTriangleSine);

    expect(frame.jointLine.normalPatientRas[0]).toBeCloseTo(-0.073535, 5);
    expect(frame.jointLine.normalPatientRas[1]).toBeCloseTo(-0.0225294, 5);
    expect(frame.jointLine.normalPatientRas[2]).toBeCloseTo(0.9970381, 5);
    expect(Math.abs(dot(frame.jointLine.normalPatientRas, frame.posteriorCondylar.normalPatientRas))).toBeLessThan(1e-6);
    expect(Math.abs(dot(frame.jointLine.normalPatientRas, frame.midline.normalPatientRas))).toBeLessThan(1e-6);
    expect(Math.abs(dot(frame.posteriorCondylar.normalPatientRas, frame.midline.normalPatientRas))).toBeLessThan(1e-6);
    expect(dot(frame.posteriorCondylar.normalPatientRas, [0, 1, 0])).toBeGreaterThan(0);
    expect(dot(frame.midline.normalPatientRas, [1, 0, 0])).toBeGreaterThan(0);

    for (const endpoint of [
      frame.posteriorCondylarLine.endpointAPatientRasMm,
      frame.posteriorCondylarLine.endpointBPatientRasMm,
    ]) {
      const offsetFromPlane = endpoint.map(
        (component, index) => component - frame.posteriorCondylar.originPatientRasMm[index],
      );
      expect(Math.abs(dot(offsetFromPlane, frame.posteriorCondylar.normalPatientRas))).toBeLessThan(1e-6);
    }
  });
});
