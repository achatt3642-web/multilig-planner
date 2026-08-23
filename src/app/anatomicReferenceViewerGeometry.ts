import type { ViewerLinePayload, ViewerMeshPayload } from "../viewer/types";
import type {
  AnatomicReferencePlane,
  AnatomicReferenceFrame,
  EvaluatedAnatomicReferenceFrame,
  ReferencePlaneId,
} from "../geometry/anatomicReferencePlanes";
import { add3, scale3, type Vec3 } from "../geometry/mesh";

export interface AnatomicReferenceViewerGeometry {
  meshes: ViewerMeshPayload[];
  lines: ViewerLinePayload[];
}

const PLANE_COLORS: Record<ReferencePlaneId, string> = {
  joint_line: "#53d4ff",
  posterior_condylar: "#a78bfa",
  midline: "#f4c86a",
};

function toVec3(value: readonly [number, number, number]): Vec3 {
  return { x: value[0], y: value[1], z: value[2] };
}

function toTuple(value: Vec3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function planeCorners(plane: AnatomicReferencePlane): [number, number, number][] {
  const origin = toVec3(plane.originPatientRasMm);
  const u = scale3(toVec3(plane.axisUPatientRas), plane.halfExtentUMm);
  const v = scale3(toVec3(plane.axisVPatientRas), plane.halfExtentVMm);
  return [
    toTuple(add3(add3(origin, scale3(u, -1)), scale3(v, -1))),
    toTuple(add3(add3(origin, u), scale3(v, -1))),
    toTuple(add3(add3(origin, u), v)),
    toTuple(add3(add3(origin, scale3(u, -1)), v)),
  ];
}

function planePayload(plane: AnatomicReferencePlane): { mesh: ViewerMeshPayload; outline: ViewerLinePayload } {
  const corners = planeCorners(plane);
  const color = PLANE_COLORS[plane.id];
  return {
    mesh: {
      id: `anatomic-reference-plane:${plane.id}`,
      name: plane.label,
      vertices: corners,
      faces: [[0, 1, 2], [0, 2, 3]],
      color,
      opacity: 0.085,
      layer: "measurements",
      analysisCategory: "anatomic_reference_plane",
    },
    outline: {
      id: `anatomic-reference-plane-outline:${plane.id}`,
      points: [...corners, corners[0]],
      color,
      opacity: 0.72,
      layer: "measurements",
    },
  };
}

function landmarkSphere(
  id: string,
  name: string,
  center: readonly [number, number, number],
  color: string,
): ViewerMeshPayload {
  const latitudeSegments = 8;
  const longitudeSegments = 12;
  const radiusMm = 1.75;
  const vertices: number[][] = [];
  const faces: number[][] = [];
  for (let latitude = 0; latitude <= latitudeSegments; latitude += 1) {
    const phi = Math.PI * latitude / latitudeSegments;
    for (let longitude = 0; longitude <= longitudeSegments; longitude += 1) {
      const theta = 2 * Math.PI * longitude / longitudeSegments;
      vertices.push([
        center[0] + radiusMm * Math.sin(phi) * Math.cos(theta),
        center[1] + radiusMm * Math.sin(phi) * Math.sin(theta),
        center[2] + radiusMm * Math.cos(phi),
      ]);
    }
  }
  for (let latitude = 0; latitude < latitudeSegments; latitude += 1) {
    for (let longitude = 0; longitude < longitudeSegments; longitude += 1) {
      const a = latitude * (longitudeSegments + 1) + longitude;
      const b = a + longitudeSegments + 1;
      faces.push([a, b, a + 1], [b, b + 1, a + 1]);
    }
  }
  return {
    id,
    name,
    vertices,
    faces,
    color,
    opacity: 0.92,
    layer: "measurements",
    analysisCategory: "anatomic_reference_landmark",
  };
}

export function buildAnatomicReferenceViewerGeometry(
  frame: AnatomicReferenceFrame,
): AnatomicReferenceViewerGeometry {
  if (frame.evaluationState !== "evaluated") return { meshes: [], lines: [] };
  const evaluated: EvaluatedAnatomicReferenceFrame = frame;
  const payloads = [evaluated.jointLine, evaluated.posteriorCondylar, evaluated.midline].map(planePayload);
  const definition = evaluated.jointLineDefinition;
  const lateral = definition.lateralSuperiorPointPatientRasMm;
  const medial = definition.medialSuperiorPointPatientRasMm;
  const posteromedial = definition.medialPosteriorSuperiorPointPatientRasMm;
  const landmarks = [
    landmarkSphere(
      "anatomic-reference-landmark:joint-line:lateral-superior",
      "Joint line · lateral-superior tibial point",
      lateral,
      "#8be4ff",
    ),
    landmarkSphere(
      "anatomic-reference-landmark:joint-line:medial-superior",
      "Joint line · medial-superior tibial point",
      medial,
      "#8be4ff",
    ),
    landmarkSphere(
      "anatomic-reference-landmark:joint-line:medial-posterior-superior",
      "Joint line · posterior-superior medial tibial point",
      posteromedial,
      "#d9f6ff",
    ),
  ];
  return {
    meshes: [...payloads.map((payload) => payload.mesh), ...landmarks],
    lines: [
      ...payloads.map((payload) => payload.outline),
      {
        id: "joint-line-defining-triangle",
        points: [
          [...lateral],
          [...medial],
          [...posteromedial],
          [...lateral],
        ],
        color: PLANE_COLORS.joint_line,
        opacity: 0.95,
        layer: "measurements",
      },
      {
        id: "posterior-condylar-contact-line",
        points: [
          [...evaluated.posteriorCondylarLine.endpointAPatientRasMm],
          [...evaluated.posteriorCondylarLine.endpointBPatientRasMm],
        ],
        color: PLANE_COLORS.posterior_condylar,
        opacity: 1,
        layer: "measurements",
      },
    ],
  };
}
