import { describe, expect, it } from "vitest";
import { buildSyntheticAnatomyMeshes } from "./channelGeometry";
import { deriveAnatomicReferenceFrame } from "../geometry/anatomicReferencePlanes";
import { buildAnatomicReferenceViewerGeometry } from "./anatomicReferenceViewerGeometry";

describe("anatomic reference Viewer payloads", () => {
  it("creates three translucent planes, three defining tibial points, and the accepted condylar line", () => {
    const frame = deriveAnatomicReferenceFrame(buildSyntheticAnatomyMeshes(), {
      laterality: "right",
      lateralityVerified: true,
      scaleVerified: true,
    });
    expect(frame.evaluationState).toBe("evaluated");
    if (frame.evaluationState !== "evaluated") return;
    const payload = buildAnatomicReferenceViewerGeometry(frame);
    const planeMeshes = payload.meshes.filter((mesh) =>
      mesh.analysisCategory === "anatomic_reference_plane");
    const landmarkMeshes = payload.meshes.filter((mesh) =>
      mesh.analysisCategory === "anatomic_reference_landmark");
    expect(planeMeshes).toHaveLength(3);
    expect(landmarkMeshes.map((mesh) => mesh.id)).toEqual([
      "anatomic-reference-landmark:joint-line:lateral-superior",
      "anatomic-reference-landmark:joint-line:medial-superior",
      "anatomic-reference-landmark:joint-line:medial-posterior-superior",
    ]);
    expect(payload.meshes.every((mesh) => mesh.layer === "measurements")).toBe(true);
    expect(payload.meshes.every((mesh) => mesh.channelId === undefined)).toBe(true);

    const expectedPointById = new Map([
      [
        "anatomic-reference-landmark:joint-line:lateral-superior",
        frame.jointLineDefinition.lateralSuperiorPointPatientRasMm,
      ],
      [
        "anatomic-reference-landmark:joint-line:medial-superior",
        frame.jointLineDefinition.medialSuperiorPointPatientRasMm,
      ],
      [
        "anatomic-reference-landmark:joint-line:medial-posterior-superior",
        frame.jointLineDefinition.medialPosteriorSuperiorPointPatientRasMm,
      ],
    ]);
    for (const marker of landmarkMeshes) {
      const expected = expectedPointById.get(marker.id)!;
      const boundsCenter = [0, 1, 2].map((axis) => {
        const values = marker.vertices.map((vertex) => vertex[axis]);
        return (Math.min(...values) + Math.max(...values)) / 2;
      });
      boundsCenter.forEach((component, index) => expect(component).toBeCloseTo(expected[index], 8));
    }

    expect(payload.lines.filter((line) =>
      line.id.startsWith("anatomic-reference-plane-outline:"))).toHaveLength(3);
    expect(payload.lines.some((line) => line.id === "posterior-condylar-contact-line")).toBe(true);
    const definingTriangle = payload.lines.find((line) => line.id === "joint-line-defining-triangle");
    expect(definingTriangle).toMatchObject({ layer: "measurements" });
    expect(definingTriangle?.points).toEqual([
      frame.jointLineDefinition.lateralSuperiorPointPatientRasMm,
      frame.jointLineDefinition.medialSuperiorPointPatientRasMm,
      frame.jointLineDefinition.medialPosteriorSuperiorPointPatientRasMm,
      frame.jointLineDefinition.lateralSuperiorPointPatientRasMm,
    ]);
  });
});
