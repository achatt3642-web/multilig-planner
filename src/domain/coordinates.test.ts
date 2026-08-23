import { describe, expect, it } from "vitest";
import type { CoordinateFrame, Matrix4, Vector3 } from "./types";
import {
  DICOM_LPS_TO_PATIENT_RAS,
  IDENTITY_MATRIX4,
  assertValidCoordinateFrame,
  createVoxelToPatientRasTransform,
  invertMatrix4,
  multiplyMatrix4,
  transformBetweenFrames,
  transformPoint,
  transformPointBetweenFrames,
  transformVector,
} from "./coordinates";

const frame = (id: string, transformToPatientRas: Matrix4): CoordinateFrame => ({
  id,
  kind: id === "voxel" ? "voxel" : "viewer_world",
  name: id,
  units: "mm",
  sourceConvention: id === "voxel" ? "IJK" : "VIEWER_WORLD",
  transformToPatientRas,
  source: "test fixture",
  scaleVerified: true,
});

const expectPointClose = (actual: Vector3, expected: Vector3): void => {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
};

describe("patient RAS coordinate transforms", () => {
  it("converts DICOM LPS into patient RAS", () => {
    expectPointClose(transformPoint(DICOM_LPS_TO_PATIENT_RAS, [12, -8, 30]), [-12, 8, 30]);
  });

  it("preserves source orientation and anisotropic voxel spacing", () => {
    const voxelToPatientRas = createVoxelToPatientRasTransform({
      originLpsMm: [100, 50, -20],
      iDirectionLps: [0, 1, 0],
      jDirectionLps: [1, 0, 0],
      kDirectionLps: [0, 0, -1],
      spacingMm: [0.5, 0.75, 3],
    });

    expectPointClose(transformPoint(voxelToPatientRas, [2, 4, 3]), [-103, -51, -29]);
    expectPointClose(transformVector(voxelToPatientRas, [2, 4, 3]), [-3, -1, -9]);
  });

  it("round trips voxel, patient, and Viewer coordinates without drift", () => {
    const voxel = frame("voxel", createVoxelToPatientRasTransform({
      originLpsMm: [90, 42, -12],
      iDirectionLps: [1, 0, 0],
      jDirectionLps: [0, 0, -1],
      kDirectionLps: [0, 1, 0],
      spacingMm: [0.6, 0.6, 2.4],
    }));
    const viewer = frame("viewer", [
      0.001, 0, 0, -0.09,
      0, 0, 0.001, 0.012,
      0, -0.001, 0, 0.042,
      0, 0, 0, 1,
    ]);
    const sourcePoint: Vector3 = [117.25, 73.5, 26.125];

    const viewerPoint = transformPointBetweenFrames(sourcePoint, voxel, viewer);
    const recovered = transformPointBetweenFrames(viewerPoint, viewer, voxel);
    expectPointClose(recovered, sourcePoint);

    const voxelToViewer = transformBetweenFrames(voxel, viewer);
    const viewerToVoxel = invertMatrix4(voxelToViewer);
    const identity = multiplyMatrix4(viewerToVoxel, voxelToViewer);
    identity.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY_MATRIX4[index], 10));
  });

  it("rejects a singular frame rather than permitting false geometry", () => {
    const singular = frame("viewer", [
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    expect(() => assertValidCoordinateFrame(singular)).toThrow(/singular/i);
  });
});
