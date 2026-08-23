# Multilig Planner

Multilig Planner is a clinician-directed, local-first 3D planning vertical slice for multiligament knee surgery. It is planning software, not autonomous navigation, an operative recommendation engine, or a patient-specific surgical-guide generator.

## Run the application

```bash
npm install
npm run segmentation:serve
npm run dev
```

The segmentation service and web app run separately on loopback (`127.0.0.1:4190` and `127.0.0.1:4173`). The service uses MAT Planner's existing Python environment, model registry, and nnUNetv2 model files by default. Set `MAT_PLANNER_ROOT` or `MAT_PLANNER_PYTHON` only when that existing installation has moved. Derived local assets are written under the ignored `.multilig-local/` directory; source imaging and generated anatomy are never bundled into the web build.

Quality gate:

```bash
npm run check
npm run test:segmentation
```

To inspect an archive without inference:

```bash
./scripts/run_mat_nnunet_bridge.sh probe --input /absolute/path/to/knee-mri.tar.gz --storage-root .multilig-local/probe
```

The import dialog accepts a `.tar.gz`/`.tgz` DICOM MRI archive or `.nii`/`.nii.gz` volume for the local MAT nnUNetv2 path. It streams the upload, polls an opaque job, verifies every derived mesh by byte length and SHA-256, and imports femur/tibia in patient RAS millimeters. A successful import immediately saves a de-identified browser snapshot; reopening the same origin restores that case and reconnects the hash-verified local mesh assets without substituting synthetic bones. Browser storage is origin-specific. All laterality, scale, orientation, bone-identity, and mesh-quality gates remain explicitly unverified until clinician review.

## Implemented product slice

- One planning workspace with a center MAT Planner Viewer v2 canvas, collapsible workflow, channel inspector/safety dashboard, and channel/sequence drawer.
- Data-driven quick-add techniques for ACL, PCL, PLC/FCL, MCL/POL/PMC, ALL, LET, separate medial/lateral roots, and custom constructs. Presets create editable objects and never select a device or authoritative final dimension.
- Patient-RAS/mm coordinate model with reversible source-voxel, label-map, mesh, and Viewer transforms plus immutable imaging/import provenance. A narrow local bridge reuses MAT Planner's existing nnUNetv2 environment, registry, checkpoints, preprocessing, and label definitions; it is explicitly `research_only`, not clinically validated.
- Hash-verified femur/tibia label maps and patient-space display meshes can be imported, persisted as de-identified artifact references, restored from the local service, and used in Viewer v2 without falling back to synthetic bones. The MAT model does not predict fibula, so fibula and dependent safety checks remain visibly `not evaluated`.
- Parametric render/collision recipes for pins, tunnels, sockets, retro/flexible paths, noncircular profiles, dilation, coring, anchors, graft/fixation, buttons/plates, posts/washers/staples, troughs, chamfers, and no-large-tunnel onlays.
- Signed finite full-volume support analysis with stable geometry hashing, cache invalidation, explicit `not_evaluated` coverage, and clinician-authored intentional-sharing relationships scoped to bone-removal layers. Conservative bounds are labeled; no exact mesh/BVH clinical backend is claimed.
- Versioned device catalog transcribed into typed data from the companion catalog document. Unknown dimensions remain `null`; availability, indication, and assembled compatibility require regional/institutional verification.
- Immutable in-memory revisions with undo/redo, named/ghosted variants with value deltas, a pin-first draggable sequence through graft passage/fixation, integrity-checked de-identified browser snapshots, and JSON/report/CSV/OBJ plus selected-channel PNG exports.

## Architecture

- `src/domain/` — plan, anatomy, coordinate, procedure, channel, catalog, imaging, sequence, audit, and analysis types.
- `src/presets/` — all editable procedure/technique presets.
- `src/catalog/` — frozen seed catalog and exact-chain validation/resolution.
- `src/geometry/` — deterministic mesh recipes, signed full-volume clearance, hashing, and performance fixture.
- `src/imaging/` — DICOM/NIfTI/label-map/mesh intake, strict MAT nnUNetv2 API contract, hash-verified artifacts, and plan import.
- `scripts/mat_nnunet_bridge.py` — loopback-only research segmentation bridge with bounded archive/NIfTI intake, deterministic provenance, immutable derived assets, and a single inference slot.
- `src/store/` — immutable revision history and integrity-checked serialization.
- `src/export/` — de-identification, catalog-resolved plan export, reports, CSV, and meshes.
- `src/viewer/` — the narrow parent adapter to MAT Planner Viewer v2.
- `public/mat-viewer-v2.html` — preserved Viewer v2 client extended through a postMessage planning-scene protocol; provenance is recorded in `public/MAT_VIEWER_V2_PROVENANCE.md`.

## Coordinate and safety contract

Canonical analytic geometry is stored in patient RAS millimeters (`X=ML`, `Y=AP`, `Z=SI`) and transformed into Viewer world through explicit reversible matrices. Numeric clearance is never emitted for an absent required anatomy object or a missing geometry-critical component. A known collision in the available volumes is still reported, alongside a separate not-evaluated coverage result for unresolved volumes. Schema and geometry-generator versions are persisted; the seed catalog is frozen at `1.0.0`.

The included fallback anatomy is synthetic and nonclinical. The connected MAT model is also research-only: it has not been validated for this product, does not segment fibula or safety anatomy, and produced meshes still require identity, scale, orientation, topology, and surface-accuracy review. No encrypted institutional persistence layer or exact patient-mesh/BVH clearance backend is claimed. Browser storage is suitable only for a de-identified demonstration snapshot. Before any clinical validation, the safest next step is an independent radiology/engineering review of de-identified cases against approved reference segmentations, including landmark-based transform checks and surface-distance ground truth, before any surgical workflow evaluation.

## Hosted demonstration

The public demonstration is deployed separately at [multilig-planner.org](https://multilig-planner.org/). The GitHub Pages build is static and de-identified. It never contains the source MRI, label maps, MRI-derived patient meshes, local plan exports, or nnUNet model files. A new browser origin therefore opens with the synthetic test anatomy. MRI import and nnUNetv2 inference remain local-only through the loopback bridge described above; the public site does not upload clinical images or provide a clinical segmentation service.

The public build is produced by `.github/workflows/pages.yml`. It uses a relative asset base so the application, Viewer v2 iframe, logo, and vendored Three.js modules work both at a GitHub Pages project URL and at a future independently approved custom domain.
