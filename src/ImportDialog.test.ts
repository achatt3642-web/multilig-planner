import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportDialog, type SegmentationUiState } from "./App";
import { createSyntheticDemoCase } from "./app/caseFactory";

const idleSegmentation: SegmentationUiState = {
  status: "idle",
  progress: 0,
  message: "No source selected.",
  file: null,
  jobId: null,
};

function importDialogMarkup(
  existingGeometryImportMode?: "enabled" | "coming_soon",
  segmentationUi: SegmentationUiState = idleSegmentation,
): string {
  const plan = createSyntheticDemoCase();
  return renderToStaticMarkup(createElement(ImportDialog, {
    sources: [],
    anatomy: plan.anatomy,
    review: plan.imaging.review,
    onReview: () => undefined,
    inputRef: createRef<HTMLInputElement>(),
    existingGeometryImportMode,
    segmentationInputRef: createRef<HTMLInputElement>(),
    segmentationUi,
    onFiles: () => undefined,
    onSegmentationSource: () => undefined,
    onRunSegmentation: () => undefined,
    onStopSegmentation: () => undefined,
    onClose: () => undefined,
  }));
}

function existingGeometryControl(markup: string): string {
  return markup.match(/<button[^>]*class="import-drop"[^>]*>.*?<\/button>/)?.[0] ?? "";
}

describe("imaging import dialog", () => {
  it("makes the public-demo existing-geometry import a non-interactive coming-soon control", () => {
    const markup = importDialogMarkup("coming_soon");
    const control = existingGeometryControl(markup);

    expect(markup).toContain("Case imaging &amp; segmentation review");
    expect(markup).toContain("Accepts DICOM MRI and NIfTI.");
    expect(markup).not.toContain("immutable label maps, and surface meshes");
    expect(markup).not.toContain("Uses MAT Planner&#x27;s existing Python environment");
    expect(control).toContain("Import option coming soon");
    expect(control).toContain('disabled=""');
    expect(control).not.toContain("Import existing segmentation or geometry");
    expect(markup).not.toContain('accept=".dcm,.dicom,.nii,.nii.gz,.nrrd,.mha,.mhd,.seg,.stl,.obj,.ply"');
  });

  it("preserves the full application's existing-geometry import by default", () => {
    const markup = importDialogMarkup();
    const control = existingGeometryControl(markup);

    expect(control).toContain("Import existing segmentation or geometry");
    expect(control).not.toContain("disabled");
    expect(markup).toContain("immutable label maps, and surface meshes");
    expect(markup).toContain("Uses MAT Planner&#x27;s existing Python environment");
    expect(markup).toContain('accept=".dcm,.dicom,.nii,.nii.gz,.nrrd,.mha,.mhd,.seg,.stl,.obj,.ply"');
  });

  it("omits an empty bundled-demo summary while preserving operational status messages", () => {
    const bundledMarkup = importDialogMarkup("coming_soon", {
      status: "completed",
      progress: 1,
      message: "",
      file: null,
      jobId: null,
    });
    const operationalMarkup = importDialogMarkup("coming_soon", {
      status: "completed",
      progress: 1,
      message: "2 MRI-derived bone meshes loaded. Review remains required.",
      file: null,
      jobId: null,
    });

    expect(bundledMarkup).not.toContain('class="segmentation-message"');
    expect(operationalMarkup).toContain("2 MRI-derived bone meshes loaded. Review remains required.");
  });

  it("keeps selected, running, and failed public segmentation feedback visible", () => {
    for (const status of ["selected", "running", "failed"] as const) {
      const message = `Operational ${status} message.`;
      const markup = importDialogMarkup("coming_soon", {
        status,
        progress: status === "running" ? 0.5 : 0,
        message,
        file: null,
        jobId: null,
      });
      expect(markup).toContain(message);
    }
  });
});
