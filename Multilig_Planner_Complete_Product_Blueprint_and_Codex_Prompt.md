# Multilig Planner
## Complete product blueprint and ready-to-paste Codex build prompt

Version 1.0 — 2026-08-02

Multilig Planner is a clinician-directed, patient-specific 3D planning workspace for multiligament knee surgery. It imports a clinical MRI or an MRI-derived segmentation, creates editable femur, tibia, and fibula models, and lets a surgeon plan every tunnel, socket, pilot hole, trough, anchor, and fixation device using the intended operative technique and exact instrument chain.

This specification is a software and product-design document. It is not an operative guide, a medical recommendation, or a claim that any product is available, cleared, indicated, or mutually compatible. All dimensions below are editable planning seeds or catalog facts; the operating clinician must select final values based on the patient, graft, current local IFU, and institutionally verified tray.

The companion file, Multilig_Planner_Device_Catalog_and_Codex_Prompt.md, is the detailed, source-linked manufacturer catalog. It should be stored beside this file in the application repository and treated as the initial device-data source.

---

# Part I — Product concept

## 1. Product thesis

Multilig Planner should behave like patient-specific CAD for knee reconstruction.

Its central object is not a named operation such as ACL or PLC. Its central object is a planned bone channel with:

- a patient-specific position and trajectory;
- a geometry recipe that represents how the selected tools actually remove or alter bone;
- an exact instrument chain;
- a graft and fixation strategy;
- a sequence state;
- source and verification metadata;
- full-volume collision and clearance results.

Procedure and technique presets create sensible groups of channel objects, but the channel objects are authoritative. A surgeon can begin with an anatomic PLC preset, change one femoral socket to an anchor pilot, substitute an institution-defined cutter, or deliberately share a channel with another construct without fighting the preset.

The product should answer five practical questions:

1. Where will every planned pin, tunnel, socket, trough, anchor, graft, and implant be in this patient?
2. What exact guide, sleeve, pin, cutter, size, depth, and fixation device will create or occupy it?
3. Which planned bone-removal volumes or hardware envelopes intersect or leave an inadequate cortical bridge?
4. How do access, drilling direction, retrograde deployment, flexible reaming, and pin overshoot change the risk picture?
5. What order should the planned channels be pinned, reamed, and fixed so the plan remains reproducible?

## 2. Product principles

1. **One workspace.** Reuse MAT Planner Viewer v2 and place all workflow controls in panels, accordions, buttons, drawers, and dialogs. Do not make a separate procedure tab for ACL, PCL, PLC, or any other structure.
2. **Exact tools are explicit.** The surgeon selects manufacturer, family, exact product or SKU when known, guide, side, sleeve, pin, cutter, size, depth, graft, and fixation for every channel.
3. **Technique is a preset, not a constraint.** Named and institution-defined techniques instantiate editable geometry.
4. **Bone change, access, and implant are separate volumes.** A tunnel volume is not the same as the reamer access envelope or retained screw/button/anchor volume.
5. **Analyze solids, not centerlines.** Collision and clearance calculations use complete 3D bore, socket, pilot, hardware, and access volumes.
6. **Unknown is not safe.** If a danger structure, previous tunnel, physis, or hardware has not been segmented or registered, its status is not evaluated.
7. **No invented product facts.** Missing geometry-critical dimensions stay null and block a complete analysis until verified.
8. **Plans remain reproducible.** Store immutable catalog versions, coordinate frames, user overrides, sources, and the exact geometry recipe used.
9. **Surgeon remains in control.** The app may suggest a compatible option or warn about a conflict, but it does not autonomously commit a device or operative decision.
10. **Patient privacy is designed in.** Prefer local or institution-controlled processing, de-identification, encrypted storage, explicit export, and a complete audit trail.

## 3. Intended users

- Sports medicine and trauma surgeons planning complex or revision multiligament cases.
- Fellows, residents, and surgical teams reviewing a surgeon-authored plan.
- Radiology or engineering staff correcting segmentation and mesh quality.
- Institutional catalog administrators maintaining locally verified trays, devices, and IFUs.
- Researchers comparing planned geometry, technique variants, or postoperative imaging.

## 4. One-workspace Viewer v2 layout

The application has a single primary route and a single planning canvas.

### Top command bar

- Case name and laterality.
- Import MRI/DICOM, NIfTI, segmentation, or mesh.
- Save, undo, redo, plan version, and compare variant.
- Viewer buttons: reset camera, standard views, clipping, cross-section, measurement, screenshot.
- Analysis status and export.

### Left workflow panel

Use collapsible sections rather than top-level tabs:

1. **Case & Imaging**
   - Import MRI or segmentation.
   - Confirm de-identification, laterality, units, coordinate frame, and image-to-mesh transform.
   - Run, review, or correct femur, tibia, and fibula segmentation.
   - Add optional cartilage, physis, previous tunnels, hardware, osteotomy implants, popliteal neurovascular region, and other user-defined safety anatomy.
2. **Procedures**
   - Quick-add buttons: ACL, PCL, PLC/FCL, MCL/POL/PMC, ALL, LET, Medial Root, Lateral Root, Custom.
   - Every button opens a compact technique chooser and then adds editable constructs to a procedure tree.
   - Multi-select visibility, color, lock, duplicate, remove, and variant actions.
3. **Technique**
   - Named preset, citation/provenance, graft pattern, bundle count, and shared-channel intent.
   - Edit footprint points and channel relationships.
4. **Instruments**
   - Manufacturer, family, exact product/SKU, guide, laterality, hook/arm, sleeve/bullet, pin, reamer/cutter/dilator, size, and depth stop.
   - Generic Parametric and Institution Defined are always available.
5. **Graft & Fixation**
   - Graft type and measured dimensions.
   - Button, interference screw, sheath, anchor, post/washer, staple, or no implant.
6. **Tunnel Geometry**
   - Bone, aperture, vector/end point, full tunnel versus socket, depth, cortical channel, shape, dimensions, twist, flare, taper, and overshoot.
7. **Sequence**
   - Pin, inspect, ream, pass graft, and place fixation steps.
   - Drag to reorder and flag sequence-dependent conflicts.

### Center canvas

Reuse the actual MAT Planner Viewer v2 implementation:

- same coordinate system and image-to-mesh transforms;
- same camera, zoom, orbit, pan, clipping, cross-section, selection, opacity, and mesh-rendering behavior;
- same visual hierarchy and interaction conventions;
- no rewritten or parallel viewer unless repository constraints make an adapter impossible.

The canvas displays:

- femur, tibia, fibula, optional patella, cartilage, and MRI slices;
- procedure footprints and landmarks;
- channel bone-removal volumes;
- guide pins and predicted overshoot;
- tool access and deployment envelopes;
- graft volumes;
- retained fixation and surface hardware;
- previous tunnels/hardware;
- conditional danger structures;
- edge-to-edge clearance markers and conflict overlays.

Direct manipulation should support:

- dragging either aperture on the bone surface;
- translating or rotating a selected axis;
- editing depth with an in-scene handle;
- rotating a noncircular cross-section;
- snapping to a footprint, local surface normal, existing channel, or an explicitly chosen shared aperture;
- numeric entry for every transform.

### Right inspector

The right panel changes with selection but remains in the same workspace:

- selected construct/channel summary;
- exact tool chain with source and verification status;
- geometry parameters and derived measurements;
- graft and fixation;
- compatibility warnings;
- cortical bridge, breakout, and collision results;
- nearest conflicting objects;
- notes, verification checkbox, and audit history.

### Bottom channel table and sequence strip

Use a collapsible table/timeline with one row per channel:

- procedure and bundle;
- bone;
- shape;
- selected cutter and size;
- tunnel length or socket depth;
- fixation;
- sequence step;
- status;
- worst clearance.

This table is the fastest way to audit a large case without hiding the 3D view.

## 5. Core workflow

1. Create a de-identified case and import clinical MRI/DICOM, an existing label map, or surface meshes.
2. Confirm laterality, scale, DICOM orientation, MRI-to-mesh registration, and segmentation quality.
3. Segment or import femur, tibia, and fibula. Store both source voxels/labels and derived meshes.
4. Add procedures from quick-add buttons.
5. Choose a technique preset for each procedure.
6. Review and edit anatomical footprint points.
7. For each channel, select the exact instrument and fixation chain.
8. Create the initial patient-specific geometry and adjust it in Viewer v2.
9. Place all virtual guide pins and inspect exits/overshoot before any virtual reaming.
10. Analyze full-volume tunnel, socket, access, hardware, cortex, articular, and safety relationships.
11. Set the drill/ream/fix sequence and review sequence-dependent conflicts.
12. Create named alternatives, compare them as ghost overlays, and select the intended plan.
13. Export a de-identified PDF/report, plan JSON, screenshots, and permitted mesh files.

## 6. MRI and segmentation behavior

The app must accommodate ordinary clinical MRI quality rather than assume a research scan.

- Import DICOM series with orientation and spacing intact; support NIfTI and existing label maps as secondary inputs.
- Preserve a reversible mapping among DICOM patient coordinates, voxel coordinates, segmentation coordinates, mesh coordinates, and Viewer v2 world coordinates.
- Require laterality confirmation and show a visible orientation cube.
- Segment femur, tibia, and fibula separately. Patella and cartilage are optional but useful.
- Provide slice-by-slice correction, brush/erase, connected-component cleanup, hole repair, and mesh smoothing controls that do not overwrite the source label map.
- Record model version, confidence or uncertainty when available, manual corrections, reviewer, and approval time.
- Run mesh checks for manifoldness, disconnected components, self-intersection, normals, scale, and excessive smoothing.
- Never infer a neurovascular clearance from bone MRI alone. A user may import or segment a posterior danger region, but otherwise the related analysis reads not evaluated.
- Permit an imaging-only demo mode with synthetic meshes, but clearly label it nonclinical.

---

# Part II — Procedure and technique library

## 7. Important rule for all size fields

Three different concepts must remain separate:

1. **Catalog limits:** exact selectable sizes documented for a specific instrument.
2. **Preset seed:** an editable starting value or broad UI range associated with a technique.
3. **Final plan value:** the surgeon-selected value matched to the measured graft, patient anatomy, intended fixation, and current IFU.

The application may use the ranges below to validate inputs and populate generic presets. It must not present them as recommended operative sizes. A branded device can expose only its verified catalog sizes; an institution-defined device can expose only locally entered sizes.

All linear units are millimeters and all angular units are degrees.

## 8. ACL procedure family

Required technique presets:

- single-bundle transtibial;
- single-bundle independent anteromedial portal;
- single-bundle outside-in;
- flexible femoral reaming;
- all-inside femoral and tibial sockets;
- full-tunnel soft-tissue graft;
- bone-patellar tendon-bone or other bone-block graft;
- double-bundle anteromedial and posterolateral;
- ribbon, oval, rectangular, or C-shaped anatomic tunnel;
- repair or augmentation using anchor pilots;
- physeal-sparing and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| Femoral single-bundle | round full tunnel; round antegrade socket; retro socket plus pilot; stepped button tunnel; oval/rectangular/C-shaped socket | round diameter 7–12; socket depth 15–35; cortical passing channel 2.4–5 |
| Tibial single-bundle | round full tunnel; antegrade socket; retro socket plus pilot; stepped tunnel; oval/rectangular/C-shaped tunnel | round diameter 7–12; full length anatomy-derived; socket depth 20–40 |
| Double-bundle AM | round or oval socket/tunnel | diameter 5–10; depth 15–35 |
| Double-bundle PL | round or oval socket/tunnel | diameter 4.5–9; depth 15–30 |
| Bone-block channel | round, rectangular, trapezoid, keyhole, or custom bone-block profile | round 8–12; rectangular seed profiles such as 5×10 or 6×10; depth matched to measured plug |
| Repair/augmentation | anchor pilot, transosseous passing channel, or no-large-tunnel onlay | pilot 1.5–5.5; depth from verified anchor recipe |

Geometry-specific requirements:

- Transtibial femoral drilling must link the reachable femoral direction to the current tibial tunnel and selected offset guide.
- Independent portal and flexible workflows must model the intra-articular access envelope and medial femoral condyle clearance.
- Retrograde workflows are a union of a pilot tract, deployed cutter envelope, blind socket, and any smaller cortical channel.
- Button fixation requires a cortical passing channel, button flip/deployment envelope, and cortex contact pose.
- Interference fixation requires the screw/sheath volume, graft volume, and their relative position inside the channel.

## 9. PCL procedure family

Required technique presets:

- single-bundle transtibial;
- single-bundle all-inside;
- outside-in femoral socket;
- flexible or rigid femoral reaming;
- double-bundle anterolateral and posteromedial;
- tibial inlay with trough/recess;
- avulsion/repair with pilot channels or anchors;
- physeal-sparing and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| Femoral single-bundle | round full tunnel; antegrade socket; outside-in socket; retro socket; stepped tunnel | diameter 8–12.5; socket depth 20–35 |
| Tibial transtibial | round full tunnel or socket; retro socket plus pilot | diameter 8–12.5; full length anatomy-derived; socket depth 20–45 |
| Double-bundle AL | round or oval socket/tunnel | diameter 7–12; depth 20–35 |
| Double-bundle PM | round or oval socket/tunnel | diameter 5–9; depth 15–30 |
| Tibial inlay | open posterior trough, rectangular/oval recess, bone-block bed, screw pilots | user-drawn outline; width 8–18; depth 3–12; wall slope and access envelope explicit |
| Repair/avulsion | one or more small transosseous channels, anchor pilots, or screw tunnels | pilot 1.5–6; custom trajectory and overshoot |

Geometry-specific requirements:

- Show the posterior pin exit and configurable overshoot before reaming.
- Treat posterior danger anatomy as not evaluated unless imported or segmented.
- Support the acute turn or killer-turn visualization of the transtibial graft path as a graft-path metric, not as a tunnel collision.
- A tibial inlay is a CSG trough/recess with saw, burr, osteotome, or drill access envelopes; it is not approximated by one cylinder.
- Double-bundle femoral apertures need edge-to-edge bridge measurements between their full socket volumes.

## 10. PLC and FCL procedure family

The UI label should be PLC/FCL, with each component visible as a named construct.

Required technique presets:

- anatomic two-graft or LaPrade-style FCL, popliteus, and popliteofibular reconstruction;
- Arciero-style;
- Larson or modified Larson fibular sling;
- isolated FCL reconstruction;
- isolated popliteus or popliteofibular reconstruction;
- repair, augmentation, or onlay;
- institution-defined and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| FCL femoral | round socket/full tunnel; retro socket; anchor pilot | diameter 5–9; socket depth 20–40 |
| Popliteus femoral | round socket/full tunnel; retro socket; anchor pilot | diameter 5–9; socket depth 20–40 |
| Fibular head | round full tunnel, socket, paired pilots, or no-large-tunnel sling/onlay | diameter 4–8; length anatomy-derived |
| Tibial popliteofibular channel | round full tunnel, anterior socket, posterior socket, or retrograde socket | diameter 6–10; length anatomy-derived; socket depth 20–45 |
| Repair/onlay | anchor pilots, transosseous channels, staple legs, post screw | pilot 1.5–6; locally verified depth |

Geometry-specific requirements:

- Provide fibular-head fracture-risk views using minimum edge-to-cortex distance and tunnel-to-proximal-tibiofibular-joint distance.
- Model the paired femoral sockets independently and measure their bridges to the ACL femoral tunnel, ALL/LET fixation, and one another.
- Store guide-arm identity and approach direction because a posterior-to-anterior tibial channel has a different access and overshoot envelope from an anterior-to-posterior channel.
- Larson-style sling presets may create only a fibular tunnel plus femoral fixation; do not force the full anatomic PLC channel set.

## 11. MCL, POL, and posteromedial corner procedure family

The UI label should be MCL/POL/PMC and allow the superficial MCL, deep MCL, POL, and posteromedial capsule to be selected separately.

Required technique presets:

- anatomic superficial MCL reconstruction;
- anatomic superficial MCL plus POL/PMC;
- isolated POL reconstruction;
- modified Lind-type or semitendinosus-based reconstruction;
- single-bundle and double-bundle;
- repair, internal-brace augmentation, anchor/onlay;
- institution-defined and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| sMCL femoral | round socket/full tunnel; retro socket; anchor pilot | diameter 5–8; socket depth 20–40 |
| sMCL proximal tibial | socket, short full tunnel, anchor pilot, staple/post fixation, or onlay | diameter 4–8; socket depth 15–35 |
| sMCL distal tibial | socket, anchor pilot, staple/post fixation, or onlay | diameter 4–8; socket depth 15–35 |
| POL femoral | round socket/full tunnel; retro socket; anchor pilot | diameter 4–8; socket depth 15–35 |
| POL tibial/soft-tissue fixation | socket, anchor pilot, transosseous channel, or onlay | diameter 2–8; depth from selected device |
| Repair/augmentation | anchor pilot, paired pilots, post screw, staple legs, no-large-tunnel onlay | pilot 1.5–6; locally verified depth |

Geometry-specific requirements:

- Analyze MCL/POL femoral volumes against PCL femoral sockets and previous medial hardware.
- Surface fixation must include washer, staple, button, or anchor envelope and not merely the pilot.
- Allow a technique to reuse a graft or share fixation without silently merging the underlying bone volumes.

## 12. ALL procedure family

Required technique presets:

- independent femoral and tibial sockets;
- shared femoral socket with ACL when explicitly intended;
- double-strand transosseous reconstruction;
- anchor/onlay reconstruction;
- repair or augmentation;
- institution-defined and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| ALL femoral | round socket/full tunnel; shared aperture/channel; anchor pilot; onlay | diameter 4–7; socket depth 15–30 |
| ALL tibial single | round socket; short full tunnel; anchor pilot | diameter 3.5–7; depth 15–30 |
| ALL tibial paired | two small transosseous channels or anchor pilots | diameter 2–5 each; spacing explicit |
| Repair/onlay | anchor pilot, staple legs, no-large-tunnel fixation | pilot 1.5–5.5 |

Geometry-specific requirements:

- Shared ACL/ALL channels are a deliberate relationship with a shared-channel flag; geometric overlap alone remains a collision.
- Analyze femoral ALL geometry against ACL, FCL, popliteus, and LET fixation.
- Store knee-flexion/tensioning notes as plan metadata without presenting an automated clinical recommendation.

## 13. LET procedure family

Required technique presets:

- modified Lemaire;
- MacIntosh-style or institution-defined strip technique;
- femoral interference-screw socket;
- anchor fixation;
- staple fixation;
- transosseous fixation;
- no-large-tunnel onlay;
- custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| Femoral LET socket | round socket/full tunnel; stepped socket; anchor pilot | diameter 4.5–8; socket depth 15–35 |
| Transosseous LET | short full tunnel or paired channels | diameter 3–7; anatomy-derived length |
| Staple/post | two staple-leg pilots or screw pilot plus surface hardware | pilot 1.5–6; spacing/device footprint explicit |
| Anchor/onlay | anchor pilot or no-large-tunnel surface fixation | pilot 1.5–5.5; depth from selected device |

Geometry-specific requirements:

- Passing the iliotibial-band strip beneath the FCL is represented as a soft-tissue path and relationship, not an invented bone tunnel.
- Analyze femoral fixation against ACL, FCL, popliteus, and ALL bone/hardware volumes.
- A no-large-tunnel technique still creates anchor, screw, or staple pilot geometry when applicable.

## 14. Medial and lateral meniscal root procedure families

Medial Root and Lateral Root are distinct quick-add procedures. Each retains meniscus side, root footprint, and relationship to nearby cruciate tunnels.

Required technique presets:

- single transtibial pullout tunnel;
- double transtibial pullout tunnels;
- retrograde root socket plus passing channel;
- direct suture anchor;
- intentionally shared/coalesced channel;
- repair of root-adjacent radial tear with no bone channel;
- institution-defined and custom.

Required channel types:

| Channel | Shapes/modes | Generic editable seed |
|---|---|---|
| Single transtibial pullout | small round full tunnel | diameter 2.4–4.5; length anatomy-derived |
| Double transtibial pullout | two small round full tunnels | diameter 2.4–4 each; aperture spacing explicit |
| Retrograde root socket | pilot tract plus larger blind socket and passing channel | socket diameter 5–7; socket depth 5–15; pilot/passing channel 2.4–4 |
| Direct anchor | drill/punch/tap pilot plus retained anchor | pilot commonly 1.5–3.5 but only exact verified device values are selectable |
| Shared/coalesced | shared segment or intentionally intersecting channels | explicit shared geometry and rationale required |
| No-bone-channel repair | no channel; optional anchor pilot | noLargeTunnel true |

Geometry-specific requirements:

- Root apertures are placed on the selected medial or lateral root footprint, not at a generic tibial point.
- Analyze root channels against ACL and PCL tibial tunnels, PLC tibial tunnels, tibial eminence, cortex, articular surface, and previous tunnels/hardware.
- A current 6 mm fixed retrograde root cutter is a device-specific option, not a universal root-socket default.
- Direct anchors require exact pilot, punch/tap, anchor expansion, insertion-axis, and access-envelope data when known.

## 15. Revision and cross-procedure options

Every procedure supports:

- prior tunnel import or manual reconstruction;
- prior screw, button, staple, plate, anchor, and graft-bone-dowel objects;
- staged tunnel grafting;
- coring/trephine workflows;
- over-reaming and custom tunnel enlargement;
- custom circular or noncircular bone dowels;
- custom apertures and trajectories;
- physeal object and avoidance rules;
- intentional tunnel convergence or shared fixation with mandatory rationale;
- variant comparison and revision provenance.

Generic revision geometry may expose 5–20 mm circular diameters and custom profiles only as unrestricted planning inputs. It must not imply a clinically appropriate revision size.

---

# Part III — Tunnel, socket, and bone-preparation geometry

## 16. Canonical geometry classes

Every geometry recipe generates one or more labeled volumes.

| Class | Bone result | Required parameters |
|---|---|---|
| Guide pin/K-wire/Beath pin | small cylindrical tract, possibly bicortical | pin diameter, start/end, tip shape, eyelet/head, planned overshoot |
| Flexible pin | pin tract plus curved access path | pin diameter, minimum bend radius, curve, intraosseous segment, exit |
| Full round tunnel | constant circular through-cylinder clipped to bone | diameter, centerline, cortical intersections, cutter length |
| Antegrade blind socket | circular or shaped blind subtraction | aperture, direction, depth, cross-section, bottom shape |
| Retrograde socket | small pilot tract plus larger inside-out blind socket | pilot diameter, cutter profile, deployment envelope, depth, cortical bridge |
| Stepped button tunnel | graft socket/tunnel plus smaller cortical channel | graft diameter/depth, cortical channel diameter/length, transition |
| Flexible-reamed socket | usually straight intraosseous socket plus curved approach envelope | reamer head/shaft, guide curve, bend radius, depth, condyle clearance |
| Oval tunnel/socket | elliptical or stadium cross-section | major/minor axes, depth, rotation, taper/twist |
| Rectangular tunnel/socket | rounded or sharp rectangular cross-section | width, height, corner radius, depth, rotation, taper/twist |
| C-shaped/ribbon/slot tunnel | parametric or polygonal noncircular profile | polygon/profile, thickness, width, open-side orientation, depth |
| Overlapping-hole+dilator | union of pilot holes transformed by a shape-specific dilator | hole centers/diameters, dilator profile, sequence, depth, orientation |
| Sequential dilated/compacted tunnel | compacted rather than purely excised volume | ordered profiles, final shape, depth, compaction flag |
| Coring/trephine channel | annular kerf and separable bone core | inner/outer diameter, kerf, depth, distal predrill, core state |
| Anchor pilot | short drilled, punched, or tapped blind hole | drill/punch profile, depth, taper, tap diameters, insertion axis |
| Screw or sheath envelope | retained fixation inside a channel | outer/core diameter, length, taper, threads, graft offset |
| Button/plate envelope | surface implant plus passing channel and deployment path | implant mesh/dimensions, cortex pose, flip envelope, channel |
| Post/washer/staple | pilot(s) and surface hardware | screw/leg diameters, depths, spacing, washer/staple footprint |
| PCL inlay trough/recess | open posterior CSG volume | outline, depth, wall angle, corners, bone-block pose, tool access |
| Chamfer/notch/keyhole | local subtraction at an aperture | profile, radius/width/depth, azimuth, tool envelope |
| No-large-tunnel/onlay | no graft tunnel; optional fixation pilots remain | noLargeTunnel flag plus anchor/staple/screw recipes |

## 17. Shape model

Use a typed cross-section representation:

- circle: diameter;
- ellipse: major and minor diameters;
- stadium: width, height, end radius;
- rounded rectangle: width, height, corner radius;
- rectangle: width and height;
- C-profile: outer radius, inner radius, opening angle, orientation;
- slot/ribbon: width, thickness, end shape;
- polygon: ordered 2D points in a local plane;
- imported profile: versioned 2D contour with scale and source.

Each channel also stores:

- proximal and distal aperture definitions;
- centerline or piecewise centerline;
- local cross-section frame;
- depth or full-thickness mode;
- taper and flare;
- twist along the path;
- bottom/end-cap profile;
- cutter versus compaction bone-preparation mode;
- optional chamfer/notch;
- planned versus measured postoperative geometry.

## 18. Volume layers

Never collapse these into a single mesh:

1. **Planned bone removal or compaction volume.**
2. **Pin tract and planned tip overshoot.**
3. **Instrument access and swept volume.**
4. **Cutter deployment/retraction volume.**
5. **Graft or bone-block volume.**
6. **Retained fixation volume.**
7. **Surface hardware and deployment/flip volume.**
8. **User-defined safety margin volume.**

Each layer has its own visibility button, collision category, opacity, color, and provenance.

## 19. Derived measurements

For every channel compute, where applicable:

- tunnel length and socket depth;
- aperture centroid, area, and major/minor dimensions;
- intraosseous volume;
- entry and exit coordinates in patient and bone-local frames;
- direction vector and anatomical angles;
- remaining cortical bridge at socket end;
- minimum distance to external cortex;
- minimum distance to articular surface;
- edge-to-edge distance to every other planned and previous volume;
- distance to physis and imported danger structures;
- hardware-to-hardware and hardware-to-tunnel clearance;
- predicted pin exit and overshoot;
- access-envelope intersection;
- graft bend/turn metric;
- aperture overlap and bridge between paired sockets.

Distances are signed edge-to-edge distances between complete volumes:

- positive means separated;
- zero means touching;
- negative means intersecting.

## 20. Collision states

- **Conflict:** full 3D volumes intersect unexpectedly.
- **Below user threshold:** separated, but the minimum edge-to-edge bridge is below the selected threshold.
- **Clear:** evaluated and at or above threshold.
- **Intentional/shared:** overlap has an explicit relationship and rationale; still show the geometry and measurements.
- **Not evaluated:** a required object or geometry recipe is absent or unverified.

Never display a green safe state for an unsegmented posterior neurovascular structure, missing physis, unknown implant geometry, or unverified device dimension.

High-priority pair groupings:

- ACL femoral versus FCL, popliteus, ALL, and LET femoral volumes;
- PCL femoral versus sMCL, POL, and PMC femoral volumes;
- ACL/PCL tibial versus medial/lateral root channels;
- cruciate tibial versus PLC tibial channel;
- paired PLC femoral sockets versus one another and ACL;
- fibular tunnel versus fibular cortex and proximal tibiofibular joint;
- PCL pin/reamer overshoot versus imported posterior danger structures;
- all new objects versus previous tunnels, hardware, osteotomy implants, physis, cortex, and articular surface.

---

# Part IV — Exact instrument and device selection

## 21. Selection chain per channel

The instrument panel must require an explicit chain:

1. catalog region and institutional availability set;
2. manufacturer or Generic/Institution Defined;
3. product family;
4. exact product, model, and SKU when known;
5. procedure-specific guide and laterality;
6. hook, arm, offset, angle, or targeting mode;
7. sleeve, bullet, depth stop, or cortical protector;
8. guide pin/wire with exact diameter and type;
9. cutter, drill, reamer, dilator, punch, tap, or coring device;
10. exact size/profile and cutting mode;
11. depth/full-tunnel setting and overshoot;
12. graft type and measured dimensions;
13. fixation family, exact implant/SKU/size, and preparation tools;
14. verification status and source.

The UI should show the chain as connected selectable chips. An incomplete or incompatible chain is visible and actionable; the application never silently substitutes another product.

## 22. Manufacturer families in the initial catalog

The detailed facts, current-source links, and status cautions are in the companion device catalog. The initial application seed must include at least these families:

### Arthrex

- FlipCutter III and current root-specific FlipCutter II record;
- RetroConstruction guides, hooks, sleeves, and depth stops;
- flexible, low-profile, full-thickness cannulated, headed, and coring reamers;
- tunnel dilators;
- transportal and transtibial ACL guides;
- ACL and PCL ToolBoxes and double-bundle PCL guides;
- collateral ligament reconstruction guide set;
- meniscal-root transtibial guide system and SutureLoc option;
- TightRope II, TightRope SB, buttons/extenders;
- FastThread, GraftBolt, SwiveLock, FiberTak, posts, washers, and staples.

### Smith+Nephew

- ACUFEX TRUNAV retrograde system and PINPOINT guides;
- extra-articular guide records with local-component verification;
- meniscal-root repair system;
- ULTRABUTTON, ENDOBUTTON, and XTENDOBUTTON;
- BIOSURE interference fixation;
- Q-FIX anchor geometry.

### Stryker

- VersiTomic flexible, RR retrograde, rigid, and ISI families;
- procedure-specific ACL/PCL/collateral/root guide arms;
- Conquest/SLOT institution-verified tray records;
- ProCinch, G-Lok, and Biosteon fixation;
- Omega and Iconix anchor/root geometry.

### Zimmer Biomet

- SwitchCut retrograde system;
- Precision Flexible and Precision ACL modular trays;
- Anatomy Specific Guide placeholder requiring verified local components;
- ToggleLoc, AFX/AperFix II, and ComposiTCP;
- institution-verified all-suture anchor records.

### DePuy Synthes / Mitek

- TWISTR retrograde and Cruciate+ rigid/flexible instrumentation;
- RIGIDLOOP cortical suspension;
- INTRAFIX ADVANCE sheath/screw;
- MILAGRO ADVANCE interference screw.

### CONMED

- Infinity retro reamers, pins, guides, and dilator;
- Constant Diameter, Sentinel/GraftMax Flex, and Badger reamers;
- Infinity, GraftMax, and XO buttons;
- GENESYS interference screws;
- Y-Knot PRO Flex anchor geometry.

### Medacta SportsMed

- M-ARS rectangular and C-shaped overlapping-hole-plus-dilator system;
- Mecta ACL single-bundle and Mecta PCL instrumentation;
- rigid, flexible, oval, and shape-specific reamer/dilator trays;
- FairFix, MBlock, MectaLoop, MectaScrew, and locally verified peripheral anchors.

### Generic and local catalog

- rigid cannulated drill/reamer;
- low-profile/headed reamer;
- flexible reamer;
- adjustable and fixed retrograde cutter;
- guide pins, Beath pins, K-wires, sleeves, bullets, and protectors;
- dilators/compactors;
- coring reamers/trephines;
- anchor drills, punches, taps, and insertion tools;
- burrs, saws, osteotomes, rasps, and trough templates;
- interference screws, sheaths, cortical buttons, plates, posts, washers, staples, and anchors;
- custom/institution-defined devices and retired historical records.

## 23. Catalog facts that must remain exact

Examples of current manufacturer-documented size families are seeded in the companion catalog, including:

- Arthrex FlipCutter III: 3.5 mm pathway; current catalog cutter settings 6 and 7–12 in 0.5 increments.
- Smith+Nephew ACUFEX TRUNAV: 2.4 mm guide pin, 4.9 mm antegrade drill, and 5.5–12 mm retrograde sizes in 0.5 increments.
- Stryker VersiTomic flexible reamers: 4.5–12 mm in 0.5 increments; RR records must preserve cutter/shaft pairings.
- Zimmer Biomet SwitchCut: 6–12 mm including half sizes; Precision Flexible: 4.5–12 mm including half sizes.
- DePuy TWISTR: 6–12 mm including half sizes.
- CONMED Infinity current source set: 6–10 mm in 0.5 increments, plus 11 and 12 mm.
- Medacta M-ARS: overlapping circular holes plus rectangular or C-shaped dilators, not a round-cylinder approximation.

These are seed catalog facts, not clinical recommendations. Exact SKU, market, tray compatibility, and current IFU require source and region verification.

## 24. Catalog architecture

Use versioned records rather than hard-coded vendor conditionals:

- Manufacturer;
- ProductFamily;
- ProductVariant or SKU;
- Instrument;
- GeometryRecipe;
- CompatibilityEdge;
- CatalogSource;
- RegionAvailability;
- InstitutionOverride;
- CatalogVersion.

Required status values:

- manufacturer_documented;
- region_ifu_check_required;
- legacy_or_transition_unclear;
- institution_defined;
- generic_parametric;
- retired_by_institution.

Manufacturer documented means only that a current official manufacturer page or document was located. It must never render as available, approved, recommended, or compatible without a distinct verified record.

---

# Part V — Data and computation model

## 25. Core entities

Use the repository's conventions, but preserve these concepts.

~~~ts
type Millimeters = number;
type Degrees = number;
type UUID = string;

interface PlanCase {
  id: UUID;
  pseudonymousLabel: string;
  laterality: "left" | "right";
  sourceStudyIds: UUID[];
  coordinateFrames: CoordinateFrame[];
  anatomyIds: UUID[];
  procedureIds: UUID[];
  planVariantIds: UUID[];
  activeVariantId: UUID;
  catalogVersionId: UUID;
  createdAt: string;
  updatedAt: string;
}

interface CoordinateFrame {
  id: UUID;
  kind: "dicom_patient" | "voxel" | "segmentation" | "mesh" | "viewer_world" | "bone_local";
  units: "mm";
  transformToPatient: number[][];
  source: string;
  verifiedBy?: string;
  verifiedAt?: string;
}

interface AnatomyObject {
  id: UUID;
  kind:
    | "femur" | "tibia" | "fibula" | "patella" | "cartilage"
    | "physis" | "danger_region" | "previous_tunnel" | "previous_hardware"
    | "osteotomy_hardware" | "custom";
  sourceVolumeId?: UUID;
  labelMapId?: UUID;
  meshAssetId: UUID;
  coordinateFrameId: UUID;
  segmentationProvenance: SegmentationProvenance;
  quality: MeshQuality;
  reviewStatus: "unreviewed" | "needs_correction" | "approved";
}

interface ProcedureInstance {
  id: UUID;
  structure:
    | "ACL" | "PCL" | "PLC_FCL" | "MCL_POL_PMC"
    | "ALL" | "LET" | "MEDIAL_ROOT" | "LATERAL_ROOT" | "CUSTOM";
  techniquePresetId: UUID;
  techniqueName: string;
  citation?: string;
  constructIds: UUID[];
  notes?: string;
}

interface Construct {
  id: UUID;
  procedureId: UUID;
  name: string;
  bundle?: string;
  footprintIds: UUID[];
  channelIds: UUID[];
  graftId?: UUID;
  relationshipIds: UUID[];
}

interface ChannelPlan {
  id: UUID;
  constructId: UUID;
  name: string;
  boneId: UUID;
  mode:
    | "full_tunnel" | "antegrade_socket" | "retrograde_socket"
    | "stepped_tunnel" | "anchor_pilot" | "trough"
    | "chamfer_notch" | "no_large_tunnel" | "custom";
  axis: CenterlineDefinition;
  crossSection: CrossSection;
  depth?: Millimeters;
  fullThickness: boolean;
  taper?: number;
  twistDegrees?: Degrees;
  preparationMode: "cut" | "dilate_compact" | "core" | "punch" | "tap" | "custom";
  instrumentChainId?: UUID;
  graftId?: UUID;
  fixationIds: UUID[];
  geometryLayerIds: UUID[];
  intentionalRelationshipIds: UUID[];
  verification: VerificationState;
}

type CrossSection =
  | { kind: "circle"; diameter: Millimeters }
  | { kind: "ellipse"; major: Millimeters; minor: Millimeters; rotation: Degrees }
  | { kind: "stadium"; width: Millimeters; height: Millimeters; rotation: Degrees }
  | { kind: "rounded_rectangle"; width: Millimeters; height: Millimeters; cornerRadius: Millimeters; rotation: Degrees }
  | { kind: "rectangle"; width: Millimeters; height: Millimeters; rotation: Degrees }
  | { kind: "c_profile"; outerRadius: Millimeters; innerRadius: Millimeters; opening: Degrees; rotation: Degrees }
  | { kind: "slot"; width: Millimeters; thickness: Millimeters; rotation: Degrees }
  | { kind: "polygon"; points: [number, number][]; rotation: Degrees; sourceId?: UUID };

interface InstrumentChain {
  id: UUID;
  region: string;
  manufacturerId?: UUID;
  familyId?: UUID;
  productVariantId?: UUID;
  guideId?: UUID;
  guideSide?: "left" | "right" | "universal";
  guideSettings: Record<string, number | string | boolean>;
  sleeveId?: UUID;
  pinId?: UUID;
  cutterId?: UUID;
  cutterSizeId?: UUID;
  depthSetting?: Millimeters;
  fixationPreparationInstrumentIds: UUID[];
  compatibilityState: "complete" | "incomplete" | "warning" | "incompatible";
  sourceIds: UUID[];
  verifiedByUser: boolean;
}

interface GeometryRecipe {
  id: UUID;
  version: number;
  class: string;
  requiredParameters: string[];
  boneVolumeGenerator: string;
  pinVolumeGenerator?: string;
  accessEnvelopeGenerator?: string;
  deploymentEnvelopeGenerator?: string;
  implantVolumeGenerator?: string;
  uncertainty?: Record<string, number>;
  sourceIds: UUID[];
  verificationStatus: string;
}

interface AnalysisResult {
  id: UUID;
  planVariantId: UUID;
  objectAId: UUID;
  objectBId: UUID;
  signedClearanceMm?: number;
  state: "conflict" | "below_threshold" | "clear" | "intentional_shared" | "not_evaluated";
  closestPointA?: [number, number, number];
  closestPointB?: [number, number, number];
  thresholdMm?: number;
  explanation: string;
  geometryVersionIds: UUID[];
}
~~~

## 26. Geometry engine

The implementation should:

1. Build geometry in patient-space millimeters and transform only for display.
2. Use robust CSG or signed-distance/mesh operations to clip planned volumes to each bone.
3. Keep analytic primitives for editing and derived triangulated meshes for display/collision.
4. Generate deterministic meshes from the same parameters and version the generator.
5. Support polygonal extrusion/sweep for noncircular profiles and explicit local cross-section orientation.
6. Generate retrograde geometry as separate pilot, deployment, socket, and cortical-channel volumes.
7. Generate flexible workflows as intraosseous geometry plus a distinct curved access envelope.
8. Generate M-ARS-like geometry from overlapping drill holes and the final dilator profile.
9. Compute closest surface points and signed clearances using a BVH, SDF, or another tested full-volume method.
10. Cache expensive mesh and collision results by geometry hash.
11. Carry uncertainty from segmentation and unverified device dimensions into the result rather than hiding it.

## 27. State, history, and plan variants

- All clinically meaningful edits are undoable/redoable.
- Save immutable plan revisions and named branches such as Plan A and Plan B.
- A plan references a frozen catalog version.
- Updating a catalog never mutates an old case.
- Comparing variants can use side-by-side numeric tables or ghosted 3D overlays in Viewer v2.
- Record who changed a channel, what changed, why, and when.
- A deliberately shared channel requires a relationship record and rationale.

## 28. Exports

At minimum:

- human-readable de-identified plan report;
- plan JSON with schema version, coordinate frames, procedures, channels, exact tool chains, sources, and analysis results;
- per-channel measurements and sequence table;
- screenshots and standard views;
- STL/OBJ/PLY or repository-supported mesh output for planned volumes when permitted;
- CSV summary for research use;
- warnings and not-evaluated items prominently listed.

Do not export patient identifiers by default. Never imply that an exported mesh is a patient-specific surgical guide unless a separately validated guide-design/manufacturing workflow exists.

---

# Part VI — Delivery scope and acceptance criteria

## 29. Suggested implementation stages

### Stage 1: production-quality vertical slice

- Reuse Viewer v2 in a one-workspace shell.
- Import existing meshes/segmentations and validate orientation/scale.
- Quick-add every required procedure.
- Create and edit generic circular full tunnels, antegrade sockets, retro sockets, anchor pilots, and no-large-tunnel constructs.
- Select a full instrument chain from a small versioned seed catalog.
- Render separate bone, pin, access, graft, and hardware volumes.
- Compute full-volume collisions and signed clearance.
- Save plan JSON and export a plan summary.

### Stage 2: complete technique and geometry library

- All procedure presets in this document.
- Oval, rectangular, C-profile, slot, polygon, dilated, coring, stepped, and trough geometries.
- Current manufacturer families from the companion catalog.
- Drilling-sequence timeline, variant comparison, previous tunnel/hardware import, and conditional danger anatomy.

### Stage 3: clinical imaging workflow

- MRI/DICOM ingestion and de-identification.
- Bone segmentation inference, manual correction, quality control, and review states.
- Versioned model/provenance and local or institution-controlled inference.
- Validated coordinate/frame handoff into Viewer v2.

### Stage 4: institutionalization and validation

- Catalog administration, local IFU/source review, tray availability, and regional status.
- Role-based access, audit, encrypted storage, retention policy, and deployment controls.
- Geometry accuracy, transform, reproducibility, usability, and clinical-validation test protocols.

## 30. Minimum acceptance scenarios

1. A user imports left femur, tibia, and fibula models; laterality and orientation are visible and verified.
2. In the same workspace, the user adds ACL, PCL, PLC, MCL/POL, ALL, LET, medial root, and lateral root plans without opening procedure tabs.
3. An ACL all-inside preset creates separate femoral and tibial retro sockets with pilot tracts and editable depths.
4. A PCL transtibial plan shows the posterior pin exit and marks neurovascular clearance not evaluated when no danger structure is present.
5. An anatomic PLC preset creates two independent femoral sockets, a fibular tunnel, and a tibial tunnel.
6. A medial-root double-tunnel preset creates two small full tunnels and reports their clearances to ACL/PCL tibial volumes.
7. A direct root-anchor option creates a pilot/anchor volume without inventing a 6 mm root tunnel.
8. A LET anchor/onlay option sets noLargeTunnel while retaining the anchor pilot and implant envelope.
9. A user can select manufacturer, family, SKU, guide, sleeve, pin, cutter, exact size, depth, and fixation for one channel; missing choices remain visibly incomplete.
10. Selecting a retrograde cutter produces a pilot tract, deployed-cutter envelope, socket, and cortical bridge measurement.
11. Selecting a flexible system produces a separate curved access envelope.
12. Selecting a rectangular/C-shaped system produces noncircular bone geometry and preserves cross-section rotation.
13. Two centerlines that do not intersect but whose bore volumes overlap are reported as a conflict.
14. Two deliberately coalesced channels are reported as intentional/shared only after an explicit relationship and rationale.
15. The app reports signed edge-to-edge clearance and shows the closest points in Viewer v2.
16. Missing device dimensions or safety anatomy produce not evaluated, never clear.
17. A saved plan reloads with identical geometry, catalog version, transforms, and analysis results.
18. Plan JSON and report export include all exact instrument selections, warnings, and source statuses without patient identifiers.

## 31. Testing expectations

- Unit tests for coordinate transforms, cross-section generation, socket depth, retrograde unions, noncircular profiles, and catalog compatibility.
- Property tests for deterministic geometry and transform round trips.
- Collision fixtures for separated, touching, intersecting, contained, intentional/shared, and missing-geometry cases.
- Snapshot or visual-regression tests for Viewer v2 layer rendering.
- Integration tests for each quick-add procedure and every geometry class.
- Persistence migration tests and frozen-catalog reproducibility tests.
- Security tests for de-identification, authorization, export, and audit behavior.
- Performance tests using a realistic multilig case with many meshes and channel layers.

---

# Part VII — Ready-to-paste Codex prompt

Copy the entire text block below into Codex from the root of the target repository. Place this blueprint and Multilig_Planner_Device_Catalog_and_Codex_Prompt.md in the repository when possible.

~~~text
You are building Multilig Planner, a clinician-directed 3D planning application for multiligament knee surgery. Work in the existing repository and implement a production-quality vertical slice. Do not replace a functioning architecture merely to match a preferred stack.

PRODUCT OUTCOME
Multilig Planner imports a clinical knee MRI or MRI-derived segmentation, creates editable femur/tibia/fibula models, and lets a surgeon plan all bone channels and fixation for ACL, PCL, PLC/FCL, MCL/POL/PMC, ALL, LET, medial meniscal root, lateral meniscal root, and custom constructs. The surgeon selects the exact technique and exact instrument chain for each channel. The application creates the corresponding patient-specific 3D geometry, evaluates full-volume conflicts and clearances, and exports a reproducible plan.

REPOSITORY DISCOVERY FIRST
1. Read AGENTS.md and all repository instructions.
2. Inspect package manifests, routes, state management, tests, persistence, import/export, and build scripts.
3. Find MAT Planner and the actual Viewer v2 implementation. Identify its coordinate system, image/mesh transforms, camera, clipping, cross-section, selection, opacity, controls, rendering conventions, and styles.
4. Search for existing segmentation, tunnel/axis, CSG, mesh, collision, catalog, and plan-version code.
5. Run the existing tests and build before editing.
6. Write a short implementation plan tied to actual files, then implement it. Ask only about a truly blocking decision that cannot be resolved from the repository or this prompt.

NONNEGOTIABLE UX
- Reuse MAT Planner Viewer v2 through the narrowest practical adapter. Preserve its camera, controls, coordinate conventions, clipping, selection, and visual language.
- Use one main planning workspace and one center Viewer v2 canvas.
- Do not create separate top-level procedure tabs.
- Put controls in a top command bar, collapsible left workflow panel, contextual right inspector, and optional collapsible bottom channel/sequence table.
- Left panel sections: Case & Imaging; Procedures; Technique; Instruments; Graft & Fixation; Tunnel Geometry; Sequence.
- Procedure quick-add buttons: ACL, PCL, PLC/FCL, MCL/POL/PMC, ALL, LET, Medial Root, Lateral Root, Custom.
- Global Viewer buttons: bones, landmarks, MRI slices, tunnels/sockets, pins, access/deployment envelopes, grafts, hardware, previous tunnels/hardware, safety anatomy, clipping, cross-section, measurements, opacity, standard views.
- Direct manipulation and numeric entry must both work for aperture, vector, depth, dimensions, and noncircular orientation.

CLINICAL CONTROL
- A named technique is only a preset that creates editable construct/channel objects.
- Never silently select a manufacturer, product, guide, pin, cutter, size, depth, graft, or fixation.
- For every channel the explicit chain is:
  region/institution set -> manufacturer or Generic/Institution Defined -> product family -> exact product/model/SKU -> guide and side -> hook/arm/offset/angle -> sleeve/bullet/depth stop -> pin -> drill/reamer/cutter/dilator/punch/tap -> exact size/profile -> depth/full-tunnel setting -> graft -> fixation implant and preparation.
- Incomplete or incompatible selections remain visible. Warn and ask the user to resolve them; never substitute silently.
- Store source, market/region, checked date, status, catalog version, and user verification.
- Missing geometry-critical data produce not evaluated and cannot produce a reassuring clearance.

IMAGING AND SEGMENTATION
- Accept DICOM MRI, NIfTI, existing label maps, and repository-supported surface meshes.
- Preserve source spacing/orientation and reversible transforms among DICOM patient, voxel, label-map, mesh, Viewer world, and bone-local frames.
- Require laterality and scale verification.
- Segment or import femur, tibia, and fibula separately. Optional objects include patella, cartilage, physis, previous tunnels, previous hardware, osteotomy implants, and user-defined danger regions.
- If segmentation inference already exists, reuse it. If no validated inference service exists, implement the import/review/correction interfaces and a clearly labeled mock or adapter boundary rather than pretending an unvalidated model is clinical.
- Keep source label maps immutable. Store manual correction and mesh-quality provenance.
- If posterior neurovascular or other risk anatomy is absent, show not evaluated.

PROCEDURE PRESETS
Implement data-driven presets that create these editable channel sets:

ACL:
- single-bundle transtibial, independent anteromedial portal, outside-in, flexible reaming, all-inside bilateral sockets, full-tunnel soft tissue, bone-block/BTB, double-bundle AM/PL, ribbon/oval/rectangular/C-shaped, repair/anchor, physeal-sparing, custom.
- generic seed: single-bundle round 7–12 mm; sockets 15–40 mm depending on bone; double-bundle channels 4.5–10 mm; measured bone-block profiles and custom noncircular shapes.

PCL:
- single-bundle transtibial, all-inside, outside-in/flexible/rigid femoral, double-bundle AL/PM, tibial inlay trough, repair/avulsion, physeal-sparing, custom.
- generic seed: round 8–12.5 mm; femoral sockets 20–35 mm; tibial sockets up to 45 mm; double-bundle 5–12 mm; custom inlay trough.

PLC/FCL:
- anatomic two-graft/LaPrade-style, Arciero-style, Larson/modified Larson, isolated FCL, isolated popliteus/popliteofibular, repair/onlay, custom.
- create only channels required by the chosen technique: FCL femoral, popliteus femoral, fibular-head, PLC tibial, and/or anchor pilots.
- generic seeds: femoral/fibular 4–9 mm, tibial 6–10 mm, sockets 20–45 mm.

MCL/POL/PMC:
- anatomic sMCL, sMCL plus POL/PMC, isolated POL, modified Lind-type, single/double bundle, repair/internal brace/onlay, custom.
- possible channels: sMCL femoral, proximal/distal tibial, POL femoral/tibial, anchor/staple/post pilots.
- generic seeds: graft channels 4–8 mm and sockets 15–40 mm; device-verified pilot sizes.

ALL:
- independent femoral/tibial sockets, explicitly shared ACL femoral channel, double-strand/transosseous, anchor/onlay, repair, custom.
- generic seeds: 3.5–7 mm graft channels, 15–30 mm sockets, device-verified pilots.

LET:
- modified Lemaire, institution-defined strip technique, interference-screw socket, anchor, staple, transosseous, no-large-tunnel onlay, custom.
- generic seeds: 4.5–8 mm socket, 15–35 mm depth, or device-verified pilot/staple/post geometry.

MEDIAL AND LATERAL MENISCAL ROOT:
- separate procedure identities; single transtibial, double transtibial, retro socket, direct anchor, explicitly shared/coalesced, no-bone-channel repair, custom.
- generic seeds: pullout channels 2.4–4.5 mm; retro socket 5–7 mm diameter and 5–15 mm depth with 2.4–4 mm passing channel; device-verified anchor pilot.

All ranges are editable generic UI seeds, not recommendations. Branded selections expose only verified catalog sizes. The final plan value is explicitly chosen by the clinician.

GEOMETRY TYPES
Implement typed, parametric geometry for:
- rigid and flexible guide pins with tip overshoot;
- round full tunnels;
- antegrade blind sockets;
- retrograde pilot + deployment envelope + blind socket + cortical channel;
- stepped button tunnels;
- flexible-reamed socket plus separate curved access envelope;
- ellipse, stadium, rectangle, rounded rectangle, C-profile, slot/ribbon, polygon, and imported 2D profiles;
- overlapping holes plus shape-specific dilator;
- sequential dilated/compacted tunnels;
- coring/trephine annulus and separable core;
- anchor drill/punch/tap pilot and retained anchor;
- interference screw/sheath and graft volumes;
- cortical button/plate and flip/deployment envelope;
- post/washer/staple pilots and surface hardware;
- PCL inlay trough/bone-block recess;
- chamfer/notch/keyhole;
- no-large-tunnel/onlay with any actual small fixation pilots.

Keep these as separate renderable/analyzable layers:
1. bone removal or compaction;
2. pin tract and overshoot;
3. instrument access/swept volume;
4. cutter deployment/retraction;
5. graft/bone block;
6. retained fixation;
7. surface hardware and flip/deployment;
8. safety margin.

DEVICE CATALOG
- Load Multilig_Planner_Device_Catalog_and_Codex_Prompt.md if present and convert its seed facts into structured versioned data. Do not parse markdown at runtime; create typed seed records and tests.
- At minimum include documented families from Arthrex, Smith+Nephew, Stryker, Zimmer Biomet, DePuy Synthes/Mitek, CONMED, and Medacta, plus Generic Parametric and Institution Defined records.
- Required families include FlipCutter/RetroConstruction; ACUFEX TRUNAV/PINPOINT; VersiTomic; SwitchCut/Precision; TWISTR/Cruciate+; Infinity/Sentinel/GraftMax/Badger; M-ARS/Mecta; and the associated guides, pins, rigid/flexible/coring/dilating tools, root systems, buttons, interference devices, anchors, posts, washers, and staples listed in the companion catalog.
- Keep products, variants/SKUs, instruments, geometry recipes, compatibility edges, sources, regions, and institutional overrides separate.
- Status values: manufacturer_documented, region_ifu_check_required, legacy_or_transition_unclear, institution_defined, generic_parametric, retired_by_institution.
- Manufacturer documented does not mean available, approved, recommended, or mutually compatible.
- Exact dimensions are nullable. Never invent one.
- Freeze the catalog version referenced by a saved plan.

CORE MODEL
Create or adapt typed entities for:
- PlanCase and PlanVariant;
- CoordinateFrame and transforms;
- AnatomyObject and SegmentationProvenance;
- ProcedureInstance, Construct, Footprint, and ChannelPlan;
- CrossSection and CenterlineDefinition;
- InstrumentChain;
- Manufacturer, ProductFamily, ProductVariant/SKU, Instrument, GeometryRecipe, CompatibilityEdge, CatalogSource, RegionAvailability, InstitutionOverride, CatalogVersion;
- GraftPlan and FixationPlan;
- GeometryLayer;
- IntentionalRelationship;
- AnalysisResult;
- SequenceStep;
- AuditEvent.

Use millimeters internally. Persist schema and geometry-generator versions.

GEOMETRY AND COLLISION ENGINE
- Build canonical geometry in patient space and transform it into Viewer v2.
- Keep editable analytic parameters and deterministic derived display/collision meshes.
- Use robust CSG, BVH, SDF, or equivalent tested full-volume methods.
- Never use centerline intersection as the collision decision.
- Compute signed edge-to-edge distance and closest points between all relevant bore, socket, pilot, access, graft, hardware, previous, cortex, articular, physis, and danger-region volumes.
- Positive distance is separation, zero is contact, negative is overlap.
- Results: conflict, below_threshold, clear, intentional_shared, not_evaluated.
- Intentional sharing requires an explicit relationship and rationale; mere overlap is a conflict.
- Show cortical bridge, cortex/articular breakout, predicted pin exit/overshoot, and nearest conflicting objects.
- Cache results by stable geometry hash and invalidate them on any relevant edit.

HIGH-PRIORITY ANALYSIS GROUPS
- ACL femoral versus FCL, popliteus, ALL, and LET.
- PCL femoral versus sMCL/POL/PMC.
- ACL/PCL tibial versus medial/lateral root.
- Cruciate tibial versus PLC tibial.
- Paired PLC femoral sockets versus one another and ACL.
- Fibular tunnel versus fibular cortex and proximal tibiofibular joint.
- PCL posterior overshoot versus imported danger anatomy.
- Everything versus prior tunnels/hardware, osteotomy hardware, physis, cortex, and articular surface.

SEQUENCE AND VARIANTS
- Let the user place and inspect all virtual pins before reaming.
- Provide a draggable sequence for pin, inspect, ream, graft pass, and fixation steps.
- Let users create named variants, compare values, and ghost one variant over another in Viewer v2.
- All meaningful edits support undo/redo and immutable plan revisions.

EXPORT
- De-identified human-readable plan report.
- Versioned plan JSON containing coordinate frames, procedures, channels, exact tool chains, sources, warnings, not-evaluated items, sequence, and analysis.
- Per-channel CSV and screenshots.
- Repository-supported mesh export for planned volumes.
- Do not label an export as a patient-specific surgical guide.

SAFETY AND PRIVACY
- This is clinician-directed planning, not autonomous navigation or an operative recommendation engine.
- Do not claim product approval, availability, indication, or compatibility.
- Do not mark absent anatomy or unknown device geometry safe.
- Prefer local/institution-controlled image processing and encrypted storage.
- De-identify by default; make any identifying export explicit and permission-controlled.
- Preserve source and user audit history.

IMPLEMENTATION ORDER
1. Reuse Viewer v2 and establish coordinate-transform tests.
2. Add the one-workspace shell and procedure/channel state model.
3. Add generic geometry classes and editing handles.
4. Add a small but properly versioned device catalog with exact instrument-chain selection.
5. Add full-volume collision/clearance and the right-side safety dashboard.
6. Add all required quick-add procedure presets and shape types.
7. Add persistence, variants, sequence, and exports.
8. Integrate the existing segmentation path or create a safe adapter/import/review boundary.
9. Expand catalog seeds from the companion file.
10. Run tests, build, lint, and a realistic multi-procedure performance fixture.

ACCEPTANCE TESTS
- One workspace can contain all required procedures without procedure tabs.
- ACL all-inside creates separate retro sockets with pilots and editable depths.
- PCL transtibial shows posterior exit and not evaluated when no danger structure is present.
- PLC anatomic preset can create two femoral sockets, fibular tunnel, and tibial tunnel.
- Root double-tunnel reports clearance to cruciate tibial tunnels.
- Direct root anchor and LET onlay do not invent large tunnels.
- Exact instrument chains remain incomplete until explicitly selected.
- Retrograde, flexible, noncircular, dilated, coring, anchor, hardware, and trough geometries render as different full volumes.
- Overlapping bore volumes are detected even when their centerlines do not intersect.
- Missing dimensions and missing safety anatomy produce not evaluated.
- Save/reload preserves identical geometry, catalog version, coordinate transforms, and results.
- Export includes exact selections, provenance, warnings, and no patient identifiers by default.

DELIVERY
- Implement, do not only describe.
- Preserve unrelated user changes.
- Add or update tests and seed data.
- Run the repository's tests, typecheck, lint, and production build.
- At the end, report the product behavior implemented, key files changed, test/build results, assumptions, known clinical-data gaps, and the safest next validation step.
~~~

---

# Part VIII — Product boundaries

## 32. What the app should not claim

- It does not recommend a surgery, graft, tunnel position, size, device, or sequence.
- It does not replace the current local IFU, tray check, or surgeon judgment.
- It does not infer neurovascular safety from an unsegmented structure.
- It does not claim that a manufacturer-documented product is available or cleared in a particular market.
- It does not assume cross-manufacturer compatibility.
- It does not transform a planning export into a surgical guide without a separate validated workflow.
- It does not hide segmentation, registration, catalog, or geometry uncertainty.

## 33. Recommended product language

Prefer:

- planned;
- selected by the clinician;
- manufacturer-documented;
- institution-verified;
- not evaluated;
- potential geometric conflict;
- calculated edge-to-edge clearance;
- patient-specific visualization;
- requires current IFU and local availability verification.

Avoid:

- optimal;
- safe;
- recommended;
- approved;
- guaranteed;
- compatible, unless a versioned and region-specific compatibility record supports the exact chain.

## 34. Definition of success

Multilig Planner succeeds when a surgeon can open one Viewer v2 workspace, add every planned ligament/root construct, choose the exact intended tools and fixation, see the actual geometry those choices create in the patient's femur/tibia/fibula, understand every evaluated conflict and every unevaluated uncertainty, compare alternatives, and export a reproducible plan without the software silently making a clinical choice.
