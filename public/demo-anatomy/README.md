# Bundled demo anatomy

This directory contains two geometry-only, de-identified MRI-derived display
surfaces for the public Multilig Planner demonstration:

- `femur.mat-viewer-mesh.json`: femur, patient RAS millimeters, 15,770
  vertices and 31,536 triangles.
- `tibia.mat-viewer-mesh.json`: tibia, patient RAS millimeters, 23,350
  vertices and 46,520 triangles.

The files contain vertices, triangle indices, a bone label, frame/unit schema,
and unreviewed mesh-quality metadata. They do not contain source MRI pixels,
DICOM headers, label maps, patient/study identifiers, local paths, inference
reports, or model files.

These surfaces and the associated planning fixture are research/demo-only and
remain unreviewed. No fibula or safety anatomy is bundled. The tibial display
surface has 178 boundary edges and is not watertight. They must not be treated
as a validated clinical segmentation or evidence of safety. Public use remains
subject to the study consent, data-use agreement, and institutional policy that
govern the source study.
