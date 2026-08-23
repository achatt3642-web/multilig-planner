# MAT Viewer v2 provenance

- Canonical source checkout: local MAT Planner checkout selected with `MAT_PLANNER_ROOT`
- Canonical source commit: `1321e0297a124c2af0ea5bc4949038cbc21cad4d`
- Source file: `knee_planner/assets/viewer_v2_client_stub.html`
- Imported SHA-256 before the local dependency-path patch: `25cd3f51d2f71ada3f7afeb6d6ac9d70aaec6c85f87d002cade9acd504a12a8d`
- Coordinate contract: canonical RAS patient space, millimeters, `X=ML`, `Y=AP`, `Z=SI`

The Multilig Planner integration keeps Viewer v2 behind a postMessage adapter. Local additions are limited to planning-layer rendering, editing handles, clipping/cross-section overlays, and parent-driven standard views. The canonical camera, OrbitControls settings, Z-up orientation, material conventions, and existing MAT message/API behavior remain unchanged.
