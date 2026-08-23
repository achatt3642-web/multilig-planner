import type { CoordinateFrame, Matrix4, Vector3 } from "./types";

export const IDENTITY_MATRIX4: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/** DICOM patient coordinates are LPS; canonical planner patient space is RAS. */
export const DICOM_LPS_TO_PATIENT_RAS: Matrix4 = [
  -1, 0, 0, 0,
  0, -1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const MATRIX_EPSILON = 1e-12;

export function multiplyMatrix4(left: Matrix4, right: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[row * 4 + index] * right[index * 4 + column];
      }
      result[row * 4 + column] = value;
    }
  }
  return result as unknown as Matrix4;
}

/**
 * Invert a finite, nonsingular homogeneous transform with pivoted
 * Gauss-Jordan elimination.  An explicit error is safer than propagating NaN
 * into geometry or falsely evaluating a clearance.
 */
export function invertMatrix4(matrix: Matrix4): Matrix4 {
  const augmented = Array.from({ length: 4 }, (_, row) => [
    ...matrix.slice(row * 4, row * 4 + 4),
    ...IDENTITY_MATRIX4.slice(row * 4, row * 4 + 4),
  ]);

  for (let column = 0; column < 4; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < 4; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }

    const pivot = augmented[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < MATRIX_EPSILON) {
      throw new Error("Coordinate transform is singular or non-finite");
    }

    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    for (let index = 0; index < 8; index += 1) {
      augmented[column][index] /= pivot;
    }

    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = 0; index < 8; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }

  return augmented.flatMap((row) => row.slice(4, 8)) as unknown as Matrix4;
}

export function transformPoint(matrix: Matrix4, point: Vector3): Vector3 {
  const [x, y, z] = point;
  const homogeneous = [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3],
    matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7],
    matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11],
    matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15],
  ];
  const w = homogeneous[3];
  if (!Number.isFinite(w) || Math.abs(w) < MATRIX_EPSILON) {
    throw new Error("Coordinate transform maps point to an invalid homogeneous coordinate");
  }
  return [homogeneous[0] / w, homogeneous[1] / w, homogeneous[2] / w];
}

/** Transform a direction without applying translation. */
export function transformVector(matrix: Matrix4, vector: Vector3): Vector3 {
  const [x, y, z] = vector;
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z,
    matrix[4] * x + matrix[5] * y + matrix[6] * z,
    matrix[8] * x + matrix[9] * y + matrix[10] * z,
  ];
}

/** Return the matrix that maps `from` coordinates directly into `to`. */
export function transformBetweenFrames(from: CoordinateFrame, to: CoordinateFrame): Matrix4 {
  return multiplyMatrix4(invertMatrix4(to.transformToPatientRas), from.transformToPatientRas);
}

export function transformPointBetweenFrames(
  point: Vector3,
  from: CoordinateFrame,
  to: CoordinateFrame,
): Vector3 {
  return transformPoint(transformBetweenFrames(from, to), point);
}

export function transformVectorBetweenFrames(
  vector: Vector3,
  from: CoordinateFrame,
  to: CoordinateFrame,
): Vector3 {
  return transformVector(transformBetweenFrames(from, to), vector);
}

export interface VoxelToPatientRasInput {
  originLpsMm: Vector3;
  /** Direction of increasing voxel i in DICOM LPS. */
  iDirectionLps: Vector3;
  /** Direction of increasing voxel j in DICOM LPS. */
  jDirectionLps: Vector3;
  /** Direction of increasing voxel k in DICOM LPS. */
  kDirectionLps: Vector3;
  spacingMm: Vector3;
}

/**
 * Construct the reversible voxel-IJK to patient-RAS affine while preserving
 * anisotropic source spacing and DICOM orientation.
 */
export function createVoxelToPatientRasTransform(input: VoxelToPatientRasInput): Matrix4 {
  const { originLpsMm, iDirectionLps, jDirectionLps, kDirectionLps, spacingMm } = input;
  const voxelToLps: Matrix4 = [
    iDirectionLps[0] * spacingMm[0], jDirectionLps[0] * spacingMm[1], kDirectionLps[0] * spacingMm[2], originLpsMm[0],
    iDirectionLps[1] * spacingMm[0], jDirectionLps[1] * spacingMm[1], kDirectionLps[1] * spacingMm[2], originLpsMm[1],
    iDirectionLps[2] * spacingMm[0], jDirectionLps[2] * spacingMm[1], kDirectionLps[2] * spacingMm[2], originLpsMm[2],
    0, 0, 0, 1,
  ];
  return multiplyMatrix4(DICOM_LPS_TO_PATIENT_RAS, voxelToLps);
}

export function assertValidCoordinateFrame(frame: CoordinateFrame): void {
  if (frame.units !== "mm") {
    throw new Error(`Coordinate frame ${frame.id} must use millimetres`);
  }
  if (frame.transformToPatientRas.some((value) => !Number.isFinite(value))) {
    throw new Error(`Coordinate frame ${frame.id} contains a non-finite transform`);
  }
  // Inversion checks both nonsingularity and numerical finiteness.
  invertMatrix4(frame.transformToPatientRas);
}
