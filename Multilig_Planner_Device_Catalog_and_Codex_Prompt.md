# Multilig Planner
## Geometry-aware tunnel-device catalog and Codex implementation prompt

Version 1.0 — source check completed 2026-08-01

This document is a software-planning specification, not an operative guide, medical recommendation, purchasing catalog, or statement of regulatory clearance. A product is marked **manufacturer-documented** only when a current official manufacturer page or manufacturer-hosted document was located. It does not mean the product, size, indication, or combination is available or cleared in every market. The application must require the clinician to verify the current local IFU, tray contents, and product availability.

This is intended to be a comprehensive, geometry-aware seed catalog of the major publicly documented systems used to create or occupy bone tunnels, sockets, pilot holes, and troughs in multiligament knee surgery. It is deliberately extensible because no static public list can cover every regional SKU, hospital-specific tray, legacy system still in service, or generic/OEM instrument.

---

# Part I — What the planner must represent

## 1. Device-status vocabulary

Use these statuses independently of manufacturer and technique:

| Status | Meaning in the app |
|---|---|
| `manufacturer_documented` | An official current manufacturer product page or current catalog was found. Availability and indication still require local IFU confirmation. |
| `region_ifu_check_required` | The family is documented, but exact size, catalog number, market, compatibility, or indication has not been confirmed for the user's region. |
| `legacy_or_transition_unclear` | The name occurs in older material, an acquired/divested portfolio, or a current tray interface without a clearly current standalone product listing. |
| `institution_defined` | A local tray, reusable instrument, generic drill/reamer, or product entered and verified by the user's institution. |
| `generic_parametric` | A geometry-only stand-in with no manufacturer claim. |
| `retired_by_institution` | Kept for historical plans but hidden from new-case defaults. |

Never convert `manufacturer_documented` into “available,” “approved,” “recommended,” or “compatible” without a separate region-specific record and source.

## 2. Geometry classes

Every catalog item that changes bone or occupies bone needs one or more geometry recipes. Model the **planned bone-removal volume**, the **instrument access/swept volume**, and the **retained implant volume** separately.

| Geometry class | Resulting bone geometry | Required model parameters |
|---|---|---|
| Rigid guide pin / K-wire / Beath pin | Small cylindrical tract, possibly bicortical | diameter, length, tip overshoot, eyelet/spade head, start/end points, drilling direction |
| Flexible guide pin | Small tract whose access path curves but whose intraosseous segment may be approximately straight | pin diameter, minimum bend radius, guide curvature, intraosseous centerline, predicted exit |
| Full-thickness cannulated drill or reamer | Constant-diameter cylindrical tunnel | diameter, tunnel length, cutter length, direction, cortical exits |
| Headed/acorn/low-profile rigid reamer | Cylinder or blind socket plus a distinct insertion envelope | head diameter, shaft diameter, flute length, socket depth, portal/access path |
| Flexible reamer | Usually a straight intraosseous socket/tunnel plus a curved approach envelope | reamer diameter, flexible shaft/head geometry, guide/pin, socket depth, minimum bend radius, medial-condyle clearance |
| Adjustable retrograde reamer | Pilot tract plus a larger inside-out blind socket | pilot diameter, deployed cutter diameter, socket depth, blade deployment envelope, cortical bridge, cutting direction |
| Fixed-size retrograde reamer | Pilot tract plus fixed-diameter inside-out socket | pilot/shaft diameter, cutter diameter, socket depth, deployment/closure envelope |
| Antegrade/retrograde hybrid | Small antegrade tract or channel plus optional retrograde socket | antegrade diameter, retrograde diameter, socket depth, pin diameter, transition |
| Stepped button tunnel | Graft socket/tunnel plus a smaller cortical passing channel | graft diameter/depth, cortical channel diameter/length, button flip clearance |
| Sequential dilator / compactor | Final compacted tunnel, not purely excised bone | sequence of profiles, final cross-section, depth, compaction flag |
| Coring reamer / trephine | Annular kerf and removable/retained cylindrical bone core | inner/outer diameters, kerf, depth, core state, distal predrill |
| Overlapping drills plus dilator | Union of two or more pilot cylinders transformed into a noncircular tunnel | hole centers/diameters, dilator cross-section, orientation, size class, depth |
| Shape-specific tunnel | Oval, rectangular, C-shaped, slot, trapezoid, or custom cross-section | 2D cross-section polygon/parametric profile, twist, taper, depth, orientation |
| Anchor pilot / punch / tap | Short blind pilot hole with optional tapping or punched expansion | pilot diameter, depth, taper, tap major/minor diameter, insertion axis, anchor volume |
| Interference screw / sheath | Implant occupying a tunnel, usually beside or around graft | outer/core diameter, length, taper, thread envelope, sheath geometry, offset from graft |
| Cortical button / plate | Surface hardware plus small passing channel | plate dimensions, curvature, flip envelope, channel, cortex contact pose |
| Post screw / washer / staple | One or more pilot holes plus surface hardware | screw or leg diameters/depths, spacing, washer/staple envelope, cortex pose |
| PCL inlay trough / bone-block recess | Open posterior trough, slot, or custom CSG volume | outline, width, depth, wall slope, saw/burr/osteotome access envelopes |
| Aperture chamfer / notch | Local subtraction at an existing tunnel mouth | chamfer radius, notch width/depth, azimuth, tool envelope |
| No-bone-removal/onlay technique | No graft tunnel; may still have small anchors, staple legs, or screw pilots | explicit `noLargeTunnel=true`, plus any anchor/hardware geometry |

The app must never approximate collision analysis using centerlines alone. Clearance is measured edge-to-edge between the complete planned volumes, including pilot tracts, sockets, cortical channels, implant envelopes, and predicted pin overshoot.

## 3. Scope of the device catalog

Include a product when it affects at least one of the following:

- tunnel, socket, pilot-hole, trough, or aperture shape;
- trajectory or reachable-angle constraints;
- socket/tunnel depth or retained cortical bridge;
- access or instrument swept volume;
- hardware occupying bone or resting on cortex;
- compatibility filtering needed to assemble the intended instrument chain.

Graft harvest, suture passing, cameras, pumps, and general arthroscopy instruments can be stored as optional case-equipment records, but they are outside this geometry seed unless they alter a planned bone volume.

---

# Part II — Manufacturer device seed catalog

## 4. Arthrex

Official catalog hub: [Knee: Next Generation in Repair and Reconstruction](https://www.arthrex.com/resources/LB1-0115-en-US/knee-next-generation-in-repair-and-reconstruction)

### Tunnel and socket creation

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented in Multilig Planner | Source |
|---|---|---|---|
| FlipCutter III drill | AR-1204FF; 3.5 mm pin pathway; cutter settings 6 mm and 7–12 mm in 0.5 mm steps in the 2026 catalog (do not invent a current 6.5 mm setting) | Adjustable inside-out socket with retained cortex; ACL, PCL, root, and other difficult-to-reach sockets | [Official page](https://www.arthrex.com/knee/flipcutter-iii-drill) |
| RetroConstruction guide set | AR-1510S / AR-1510HR; 2.4 mm antegrade sleeves; 3.5 mm FlipCutter sleeves; 7 and 10 mm stepped sleeves; AR-1250F 3.5 mm predrill | Adjustable C-ring, procedure-specific marking hooks, entry point, guide angle, stepped depth stop | [Official page](https://www.arthrex.com/knee/retroconstruction-drill-guide-system-instrument-set) |
| Flexible Reamer System | 7–11 mm in 0.5 mm steps; AR-1400F-70 through -110 with flexible pin; corresponding flexible TightRope-pin variants; curved guide AR-1800F | Flexible medial-portal approach; model both the tunnel and the curved access envelope | [Official page](https://www.arthrex.com/knee/flexible-reamer) |
| Low-Profile Reamers | Live/product listings support 5–13 mm whole sizes plus 11.5 and 12.5 mm; verify any other half size locally before enabling | Thin shaft, short two-flute/flat-profile rigid reamer; medial-portal, transtibial, PCL, or collateral socket | [Official page](https://www.arthrex.com/knee/low-profile-reamers) |
| Full-thickness cannulated drills | Reusable 4, 5, 6, 7, 8, 9, 10, 11, 12, 15 mm; sterile 4–12 mm in 0.5 mm steps plus 15 mm; 2.4 mm pin pathway | Full tunnel or antegrade socket for cruciate and extra-articular reconstructions | [Official page](https://www.arthrex.com/knee/sterile-cannulated-reamers) |
| Cannulated headed reamers | 5–14 mm whole sizes, AR-1405 through AR-1414 in the 2026 catalog | Headed/acorn antegrade reamer, including offset-guide workflows | [2026 catalog](https://www.arthrex.com/resources/LB1-0115-en-US/knee-next-generation-in-repair-and-reconstruction) |
| Disposable Coring Reamers | 7–14 mm whole-size family; distal 10 mm predrill is specified as 1 mm larger than the chosen coring reamer; 13/14 mm also described for ACL retightening | Annular kerf, removable core, distal predrill, revision grafting workflow | [Official page](https://www.arthrex.com/knee/disposable-coring-reamers) |
| Tunnel Dilators | 5.5–12 mm in 0.5 mm steps with T-handle | Sequential compaction/dilation, stored as a different bone-preparation mode from cutting | [2026 catalog](https://www.arthrex.com/resources/LB1-0115-en-US/knee-next-generation-in-repair-and-reconstruction) |
| Transportal ACL guides | 4–8 mm offsets | Medial-portal femoral back-wall/offset constraint | [Low-profile reamer page](https://www.arthrex.com/knee/low-profile-reamers) |
| Transtibial femoral ACL guides | 4, 5, 6, 7, 8 mm offsets; paired size bands in the catalog | Over-the-top reference and femoral trajectory constrained through the tibial tunnel | [2026 catalog](https://www.arthrex.com/resources/LB1-0115-en-US/knee-next-generation-in-repair-and-reconstruction) |
| ACL ToolBox | AR-1900S; RetroConstruction interfaces for 2.4 mm pins, 3.0 mm RetroDrill interface, and 3.5 mm FlipCutter | Tray/preset compatibility record, not a single cutter | [Official page](https://www.arthrex.com/knee/acl-toolbox) |
| PCL ToolBox | AR-1269S; PCL contour hooks, drills/reamers, double-bundle guides, popliteal protector/elevator/rasps | Full transtibial, all-inside, double-bundle, and inlay workflow container | [Official page](https://www.arthrex.com/knee/pcl-toolbox) |
| Double-bundle PCL guides | AR-5015SS; 6–12 mm guide faces | Two femoral PCL socket apertures with bundle, diameter, and cartilage-margin constraints | [PCL ToolBox](https://www.arthrex.com/knee/pcl-toolbox) |
| Collateral Ligament Reconstruction Set | AR-5500S; 2.4 mm Zebra pin; 6–10 mm cannulated drills; fibular, tibial, and femoral marking hooks; parallel drill guide | FCL/PLC and MCL/POL trajectories; parallel-guide spacing and divergence; fibular-head fracture envelope | [Official page](https://www.arthrex.com/knee/collateral-ligament-reconstruction-set) |
| Tunnel/notch shaping instruments | Tunnel/notchplasty rasp, osteotome, and interference-screw/RetroScrew notchers in current catalog | Local aperture chamfer, notch, or keyhole geometry | [Interference-screw page](https://www.arthrex.com/knee/interference-screws-1) |
| Meniscal-root transtibial system | Current root kit contains a fixed 6 mm FlipCutter II; point-to-point and over-the-back hooks; 5/7.5/10 mm offsets and adjustable guide angles described in the catalog | 6 mm retrograde root socket plus transosseous channel; single/double tunnel variants | [Official page](https://www.arthrex.com/knee/meniscal-root-repair) |
| SutureLoc root implant | AR-4551; 2.4 mm cannulated drill pin | Direct root anchor pilot with no large transtibial socket | [Official page](https://www.arthrex.com/knee/sutureloc-implant) |

### Geometry-relevant fixation and onlay alternatives

| System/device | Selectable facts and model behavior | Source |
|---|---|---|
| TightRope II / FiberTag TightRope II RT, BTB, ABS | Adjustable cortical suspension; retain button/channel/flip-envelope records; concave/flat/oblong button geometries and extenders must be catalog data, not guessed | [FiberTag TightRope II](https://www.arthrex.com/knee/fibertag-tightrope-ii-implant), [TightRope II ABS](https://www.arthrex.com/knee/acl-tightrope-ii-attachable-button-system) |
| TightRope SB | Current all-suture cortical-button family; creates a passing channel but avoids a metal button volume | [Official page](https://www.arthrex.com/knee/tightrope-sb-implants) |
| FastThread BioComposite / PEEK screws | 6×20; 7–10×20; 7–12×30 mm families; represent screw thread envelope, tap/notcher, and graft offset | [Official page](https://www.arthrex.com/knee/interference-screws-1) |
| GraftBolt | 7–10 mm sheath-and-screw tibial fixation with matching dilators | [Official page](https://www.arthrex.com/knee/interference-screws-1) |
| SwiveLock tenodesis / BioComposite SwiveLock | Socket/anchor fixation used in collateral, ALL, LET, and repair constructs; exact drill, tap/punch, diameter, and length are device-record fields | [Collateral fixation](https://www.arthrex.com/knee/collateral-ligament-graft-fixation) |
| Knee FiberTak family | Standard pilot commonly 2.6 mm with current drill/punch variants; Double Knotless is documented for LET/ALL; represent small anchor pilot and expanded all-suture anchor | [Official page](https://www.arthrex.com/knee/knee-fibertak-anchor) |
| MCL InternalBrace kit | Two 4.75×15 mm SwiveLock implants; 4.5 mm drill; 2.4 mm pins; pilot/anchor construct rather than graft tunnels | [Official page](https://www.arthrex.com/knee/mcl-internalbrace-ligament-augmentation-repair) |
| ALL/LET transosseous or socket kit | 2.4 mm pin, 4.5 and 7 mm drills, and SwiveLock options; also support newer no-large-socket FiberTak onlay | [ALL reconstruction](https://www.arthrex.com/knee/anterolateral-ligament-reconstruction), [LET](https://www.arthrex.com/knee/iliotibial-band-tenodesis) |
| Extra-articular FiberTag TightRope | Common chain uses 4 mm passing channel plus 6 mm low-profile socket and cortical suspension | [Official page](https://www.arthrex.com/knee/extra-articular-fibertag-tightrope-implant) |
| Cortical posts, washers, and staples | Model screw pilot/thread envelope, washer footprint, or paired staple legs; keep exact local part number/size selectable | [Instrument sets](https://www.arthrex.com/knee/instrument-sets) |

Arthrex status cautions:

- FlipCutter II is not globally “discontinued”: it remains documented in a current 6 mm meniscal-root kit. Older standalone FlipCutter II size ranges should remain `legacy_or_transition_unclear`.
- RetroDrill interfaces remain in current ToolBox descriptions, but a current standalone size family was not verified. Store the interface as current and the standalone product as unclear.
- PCL inlay remains a current technique category, while older dedicated implant bills of material require local verification.
- Classic Delta/Bio-Interference/TransFix and RetroScrew implant listings found only in older material must not silently replace the current FastThread/TightRope choices.

## 5. Smith+Nephew

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| ACUFEX TRUNAV Retrograde Drill | 2.4 mm guide wire; 4.9 mm antegrade channel; 5.5–12 mm retrograde sockets in 0.5 mm steps; retractable cutting blade | Pin-guided concentric antegrade/retrograde ACL/PCL socket; pilot, socket, deployment, and retained cortex | [Official page](https://www.smith-nephew.com/en/health-care-professionals/products/sports-medicine/acufex-trunav-retrograde-drill) |
| ACUFEX PINPOINT Anatomic ACL Guide | Pivoting guide system paired with TRUNAV | Guide pose, entry point, pivot angle, footprint target, and compatible wire/drill chain | [Official page](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/acufex-pinpoint-anatomic-acl-guide-system-ppl) |
| ACUFEX EXTRA-ARTICULAR Reconstruction Guide | Current related-product listing; exact local guide arms and sleeves require IFU/tray confirmation | Extra-articular trajectory and convergence planning | [Official solution page](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/acufex-trunav-retrograde-drilling-suture-solutions) |
| MENISCAL ROOT Repair System | Single tunnel: 2.4 mm pin with 4.5 mm cannulated overdrill. Double tunnel: 2.8 mm drill set, approximately 5 mm separation in the published technique. Current guide offsets 5–8 mm; aimers designed around tibial eminence | One or two small transosseous tunnels with offset and aperture constraints | [Official page](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/meniscal-root-repair-system), [single-tunnel technique](https://smith-nephew.stylelabs.cloud/api/public/content/14836-Meniscal_Root_1-tunnel?download=true&v=76e9d383), [double-tunnel technique](https://smith-nephew.stylelabs.cloud/api/public/content/9ad981b1db834b8d982872fbd0f8967b?download=true&v=9c79c71a) |
| ACUFEX DIRECTOR ELITE / rigid cannulated reaming | A current 2025 LET technique uses a 2.4 mm K-wire and 8 mm cannulated headed reamer to a 20 mm socket; a substantive current standalone product page was not located | Generic guidewire-based rigid socket recipe with technique-specific 8×20 mm example; mark component availability `region_ifu_check_required` | [2025 official technique](https://smith-nephew.stylelabs.cloud/api/public/content/09026-V3-Lemaire-BIOSURE-REGENESORB-Technique-Guide?download=true&v=b8096699) |
| ULTRABUTTON Adjustable Fixation Device family | Femoral and tibial adjustable suspension. Current brochure: small TIB button 12 mm, 4.4 mm peg, for 4.9–7 mm tunnel; medium 15 mm, 7 mm peg, for 7.5–10 mm; large 18 mm, 10 mm peg, for 10.5–13 mm. Store the accessory 4.5 mm drill where applicable | Cortical channel, button footprint, peg, flip/seat clearance, adjustable-loop graft depth | [Official page](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/ultrabutton-adjustable-fixation-device), [official brochure](https://smith-nephew.stylelabs.cloud/api/public/content/05224_ULTRABUTTON-Family_brochure?download=true&v=d8e8ef83) |
| ENDOBUTTON CL ULTRA / XTENDOBUTTON | Fixed-loop fixation uses a 4.5 mm cortical passing tunnel plus graft socket in current/hosted technique material; older official catalog lists 10–60 mm loops in 5 mm steps and must be region-verified; XTENDOBUTTON has oval/round extensions | Cortical plate/extension volume and passing channel | [ENDOBUTTON](https://www.smith-nephew.com/en/health-care-professionals/products/sports-medicine/endobutton-cl-ultra-fixation-device-ppl), [XTENDOBUTTON](https://www.smith-nephew.com/en/health-care-professionals/products/sports-medicine/xtendobutton-fixation-device) |
| BIOSURE REGENESORB / BIOSURE HA-PK | Interference-screw families; exact diameter/length/SKU remains a required region-specific record | Thread envelope, tunnel occupancy, aperture position, optional tap/notch | [REGENESORB](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/biosure-regenesorb-interference-screw), [HA-PK](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/biosure-ha-pk-interference-screw-ppl) |
| BIOSURE SYNC | Tibial fixation device; dimensions/compatibility require current IFU record | Tibial in-tunnel hardware volume | [Official page](https://www.smith-nephew.com/en/health-care-professionals/products/sports-medicine/biosure-sync-tibial-fixation-device-ppl) |
| Q-FIX All-Suture Anchor family for knee | 1.8 and 2.8 mm anchor families, including knotless 1.8 mm; straight, curved, and crown guides; 1.8 mm flexible/twist drilling and 2.8 mm drill/punch options in the current family brochure | LET/collateral/repair onlay pilot, curved access path where chosen, and deployed radial anchor envelope | [Official knee page](https://www.smith-nephew.com/en-us/health-care-professionals/products/sports-medicine/q-fix-all-suture-anchor-knee), [official family brochure](https://smith-nephew.stylelabs.cloud/api/public/content/8b2c435d4b2e48aeb494d1d1ba7a4dbc?download=true&v=8664ee21) |

Do not mark ACUFEX DIRECTOR ELITE as a fully `manufacturer_documented` standalone family solely from its appearance in a current technique; keep it `region_ifu_check_required`. Keep CLANCY and unsupported older guide names in the legacy import alias table only.

## 6. Stryker

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| VersiTomic Flexible Reaming System | 4.5–12 mm in 0.5 mm steps; flexible SMA guide pin; straight and side-specific 5/6/7 mm offset medial-portal guides | Flexible AM or transtibial ACL/PCL reaming; store curved approach envelope and intraosseous axis | [Official page](https://www.stryker.com/us/en/sports-medicine/products/versitomic-flexible-reaming-system.html) |
| VersiTomic RR | Fixed retro reamers: 4.5 mm shaft with 6–10 mm cutters in 0.5 mm steps, then 6 mm shaft with 11 and 12 mm cutters; self-deploying flat tooth, removable K-wire, 10 mm cortex-proximity marks | Outside-in pilot plus blind socket; ACL/PCL/root-specific guide arms; deployment and pin-removal pathway | [Technique guide](https://www.stryker.com/content/dam/stryker/sports-medicine/procedures/acl-reconstruction/Versitomic%20RR%20all-inside%20ACL%20reconstruction%20technique%20guide.pdf) |
| VersiTomic RR guide system | Guide body; 4.5/6.0 mm stepped bullets; ACL tibial elbow/oval arms; right/left ACL femoral arms; PCL tibial/femoral arms; meniscal-root arm | Exact guide/side/arm selection per channel | [Technique guide](https://www.stryker.com/content/dam/stryker/sports-medicine/procedures/acl-reconstruction/Versitomic%20RR%20all-inside%20ACL%20reconstruction%20technique%20guide.pdf) |
| VersiTomic RR root system | 4.5×6.0 mm retro reamer and dedicated root arm/hook/point | Small 6 mm retro socket, transosseous pathway, optional nearby fixation pilot | [Root technique](https://www.stryker.com/content/dam/stryker/sports-medicine/procedures/meniscal-repair/resources/Versitomic%20RR%20meniscal%20root%20repair%20system%20surgical%20technique%20guide%20%20%284%29.pdf) |
| VersiTomic rigid ACL/PCL instruments | Current product page still links rigid technique documents. ACL cannulated drills 4.5–12 mm in 0.5 mm steps. PCL document lists a protected tibial cup/backstop, 2.4 mm pin, single/double-bundle arm, cannulated drills 5–11.5 mm in 0.5 mm steps, and three-flute femoral reamers 5–12 mm in 0.5 mm steps; exact local availability requires confirmation because technique revisions are older | Rigid cruciate tunnel recipes and posterior protective-instrument access envelope | [ACL guide](https://www.stryker.com/content/dam/stryker/sports-medicine/products/versitomicflexiblereamingandinterferencescrewsystem/resources/ACL%20Technique%20Guide.pdf), [PCL guide](https://www.stryker.com/content/dam/stryker/sports-medicine/products/versitomicflexiblereamingandinterferencescrewsystem/resources/PCL%20Technique%20Guide.pdf) |
| VersiTomic ISI | 35-degree flexible screwdrivers, curved graft-protection slide, 2.3 mm tunnel notcher, and 6–10 mm taps; parallel interference-screw insertion without hyperflexion | Screw access trajectory, notcher volume, tap envelope, and screw/graft parallelism | [Official page](https://www.stryker.com/us/en/sports-medicine/products/versitomic-isi.html) |
| Conquest Manual / SLOT instrumentation | Conquest is listed in the current ACL portfolio but detailed local components require tray verification. Do not classify SLOT as a cruciate/root tunnel system; its documented 8×10 mm slot use is meniscal transplantation | Generic rigid/manual entry for Conquest only; keep SLOT in a separate MAT module if needed | [ACL portfolio](https://www.stryker.com/us/en/sports-medicine/procedures/ACL-reconstruction.html) |
| ProCinch | Standard/reverse tension, open-loop, no-button, and slotted-button configurations. Current brochure pairings: 11 mm concave or 8×12 mm oval for 4–7 mm tunnel; 14 mm for 7–9 mm; 20 mm for 9–12 mm | Adjustable cortical fixation, button footprint, centering contour, and channel | [Official page](https://www.stryker.com/us/en/sports-medicine/products/ProCinch-adjustable-suspensory-fixation-system.html), [official brochure](https://www.stryker.com/content/dam/stryker/sports-medicine/products/procinchadjustablefixationsystem/resources/1000903908RevD.pdf) |
| G-Lok / Biosteon | Current ACL portfolio lists fixed suspensory and interference-screw fixation | Button/channel or screw envelope; exact local sizes required | [ACL portfolio](https://www.stryker.com/us/en/sports-medicine/procedures/ACL-reconstruction.html) |
| Omega 3.9 mm knotless anchor / 11 mm concave button | Root technique documents an adjacent 3.9 mm anchor pilot or button alternative | Root-fixation pilot/hardware collision with the root tunnel | [Root technique](https://www.stryker.com/content/dam/stryker/sports-medicine/procedures/meniscal-repair/resources/Versitomic%20RR%20meniscal%20root%20repair%20system%20surgical%20technique%20guide%20%20%284%29.pdf) |
| Iconix / Iconix Knotless | 1.4 and 2.3 mm all-suture anchor pilot families with straight, 12-degree, and 25-degree guide options | Small onlay/repair anchor pilot, guide access envelope, and deployed anchor; not a graft-sized tunnel | [Iconix](https://www.stryker.com/us/en/sports-medicine/products/iconix-all-suture-anchor.html), [Iconix Knotless](https://www.stryker.com/us/en/sports-medicine/products/Iconix-Knotless.html) |

## 7. Zimmer Biomet

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| SwitchCut Reaming System | Self-flipping retro reamer; 6–12 mm including half sizes; right/left femoral guides and point-to-point tibial guide | Outside-in pilot plus blind socket, deployment envelope, side-specific guide constraint | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/switchcut-reaming-system.html) |
| Precision Flexible Reaming System | 4.5–12 mm including half sizes; two-plane bend; 5–6, 7–8, 9–10, 11–12, and universal guide-offset options | Flexible medial-portal access at 90 degrees; tunnel and curved access volumes | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/precision-flexible-instrumentation.html) |
| Precision ACL Tray Systems | Modular caddies: rigid reamer, SwitchCut, curved aimer, rigid aimer; separate interference-screw and WasherLoc trays. Current tray layout lists transtibial rigid aimers 7–13 mm, medial aimers 6–12 mm, acorn reamers 5–10 mm in 0.5 mm steps plus 11 mm, low-profile reamers 7–10.5 mm in 0.5 mm steps, cannulated drills 5–10 mm in 0.5 mm steps plus 11/12/13 mm, and dilators 7–11 mm in 0.5 mm steps; honor region limitations in the document | Tray/compatibility container spanning rigid, flexible, retro, and dilation workflows | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/precision-acl-tray-systems.html), [official tray layout](https://www.zimmerbiomet.com/content/dam/zb-corporate/en/products/specialties/sports-medicine/precision-acl-tray-systems/0439.3-GLBL-en-Precision-Instrument-Implant-Prep-Tray-Layouts-Digital.pdf) |
| Anatomy Specific Guide | Listed in the current multiligament knee instrumentation portfolio; exact components must be verified from the local tray/current labeling | Generic anatomy-specific multiligament guide entry until component-level data are loaded | [Current portfolio](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine.html) |
| ToggleLoc with ZipLoop / ToggleLoc Flip Inline | ToggleLoc workflows use a 4.5 mm cortical passage plus graft socket in current techniques. Flip Inline adjustable loop is documented from 15–60 mm and can close to 5 mm from the button; extender/washer bailout geometry must be selectable | Cortical channel, flip/seat envelope, plate/extender dimensions, graft insertion depth | [ToggleLoc ZipLoop](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/toggleloc-device-with-ziploop-technology.html), [Flip Inline](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/toggleloc-flip-in-line.html) |
| AperFix II tibial sheath and screw | Current documented tibial sizes 8×30, 9×30, 10×30, and 11×30 mm; current materials include multiligament tibial fixation | In-tunnel sheath plus screw volume | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/aperfix-ii-tibial-sheath-and-screw-system.html), [official datasheet](https://www.zimmerbiomet.com/content/dam/zb-corporate/en/products/specialties/sports-medicine/aperfix-ii-tibial-sheath-and-screw-system/1486.1-US-en%20AperFix%20II%20Tibial%20System%20Datasheet-DIGITAL.pdf) |
| AFX / AperFix femoral system | PCL materials document 9×24 and 10×24 mm AM variants and 9×29, 10×29, and 11×29 mm standard variants; regional verification required | Expanding femoral in-tunnel fixation and required tunnel volume | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/aperfix-femoral-system.html), [PCL technique](https://www.zimmerbiomet.com/content/dam/zb-corporate/en/education-resources/surgical-techniques/specialties/sports-medicine/aperfix-ii-tibial-sheath-and-screw-system/1476.1-GLBL-en%20AperFix%20PCL%20SurgTech-DIGITAL1.pdf) |
| ComposiTCP interference screws | Current technique/tray uses a 1.1 mm wire and tap/driver groupings 7–8 and 9–11 mm; full implant-size matrix still requires current regional data | Screw/thread envelope and tunnel occupancy | [Official page](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine/compositcp-interference-screw.html) |
| JuggerKnot / SureLock all-suture anchors | Current all-suture anchor families; exact knee indication and drill geometry are SKU/IFU fields | Small anchor pilot and deployed anchor volume for onlay repairs when locally indicated | [Current portfolio](https://www.zimmerbiomet.com/en/products-and-solutions/specialties/sports-medicine.html) |

Do not list Cayenne as a separate current manufacturer for AperFix; current Zimmer Biomet pages establish the present portfolio owner.

## 8. DePuy Synthes / Mitek

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| TWISTR Retrograde Reamer | Correct product spelling is TWISTR; adjustable 6–12 mm including half sizes; outside-in deployable blade | Pilot tract plus adjustable retro socket for ACL/PCL | [Official page](https://www.jnjmedtech.com/en-US/product/twistr-retrograde-reamer-and-cruciate-system), [official sell sheet](https://www.jnjmedtech.com/system/files/pdf/963475974%20-%20DPS%20Sport%20Twistr%20Cruciate%20System%20Sell%20Sheet%20rv1%20%281%29_0.pdf) |
| Cruciate+ Instruments | Point-to-point/capture ACL tibial and ACL/PCL femoral aimers; 4.8 mm reamer bullet; 2.4 mm insert; outside-in suture-passing pin | Guide pose and compatible pin/bullet chain | [Official page](https://www.jnjmedtech.com/en-US/product/twistr-retrograde-reamer-and-cruciate-system) |
| RIGIDLOOP Adjustable / fixed / BTB systems | Adjustable, fixed, and BTB cortical fixation product families | Cortical passing channel, plate/button/flip envelope, graft depth | [Adjustable](https://www.jnjmedtech.com/en-US/product/rigidloop-adjustable-cortical-fixation-system), [BTB](https://www.jnjmedtech.com/en-US/product/rigidloop-btb-adjustable-cortical-system), [fixed](https://www.jnjmedtech.com/en-US/product/rigidloop-cortical-fixation-system) |
| INTRAFIX ADVANCE | Tibial sheath-and-screw fastener | In-tunnel sheath/screw volume and required full tunnel | [Official page](https://www.jnjmedtech.com/en-US/product/intrafix-advance-tibial-fastener-system) |
| MILAGRO ADVANCE | Interference screw; current page links knee and MCL resources | Screw/thread envelope and tunnel occupancy | [Official page](https://www.jnjmedtech.com/en-US/product/milagro-advance-interference-screw) |

Treat “TWISTER” in occasional page/video copy as a probable spelling error, not a second catalog product. Do not seed an unsourced “SpeedRoot” system. TRUESPAN is a meniscal repair device, not a verified root-drilling platform.

## 9. CONMED

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| Infinity Retro-Reamers | Fixed-size outside-in retro family; current manufacturer materials list 6–10 mm in 0.5 mm steps plus 11 and 12 mm; verify exact SKU series by region | Pilot/shaft plus fixed blind socket and blade-actuation envelope | [Official page](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/infinity-retro-reamers) |
| Infinity Modular Guide System | ACL/PCL femoral footprint arms; ACL/PCL tibial guides; 2.4 mm and 3.5 mm all-inside sleeve pathways; current anteromedial guides in 7/8 and 9/10 mm footprints | Guide arm, sleeve, footprint indicator, back-wall offset, and channel trajectory | [Official page](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/infinity-guides) |
| Infinity Spade Tip Guide Pin / Tunnel Dilator | 3.5 mm spade tip tapering to 2.4 mm shaft; separate 3.5 mm button-channel dilator | Stepped cortical channel or button channel | [Knee accessories](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/conmed-knee-accessories) |
| Constant Diameter Reamers | Fully fluted straight rigid reamer family; exact available diameters are SKU data | Full tunnel/straight socket | [Official page](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/constant-diameter-and-sentinel-reamers) |
| Sentinel / GraftMax Flex Sentinel | Single-flute reamer with 270-degree smooth surface; flexible variant works with curved guide | Protected medial-portal flexible/rigid access; model flute orientation and condyle-clearance envelope | [Official page](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/constant-diameter-and-sentinel-reamers) |
| Badger reamer | Acorn/front-cutting head with smooth shaft intended to protect the PCL in a transtibial approach | Headed rigid reamer plus smooth-shaft access envelope | [Official page](https://www.conmed.com/en/products/surgical-and-medical-instruments/orthopedic-knee-instruments/constant-diameter-and-sentinel-reamers) |
| Infinity femoral adjustable button | Adjustable, reversible femoral cortical device | Cortical plate, channel, loop/graft depth | [Official page](https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/infinity-femoral-adjustable-loop-button) |
| Infinity tibial button / adjustable free loop | 14 and 17 mm button options | Tibial cortical plate/centering bulb and channel | [Official page](https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/infinity-tibial-button-and-loop) |
| GraftMax adjustable / XO fixed loop | Adjustable and fixed-loop cortical fixation | Button, loop, channel, and flip envelope | [GraftMax](https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/graftmax-button-adjustable-cortical-fixation-device), [XO](https://www.conmed.com/en/products/implants-and-suture-anchors/suspensory-fixation/xo-button-cortical-fixation-device) |
| GENESYS Matryx | Interference screw family | Screw/thread envelope | [Official page](https://www.conmed.com/en/products/implants-and-suture-anchors/interference-screws/genesys-matryx-interference-screw) |
| Y-Knot PRO Flex all-suture anchor | Flexible anchor-delivery system documented for meniscus-root and other soft-tissue fixation contexts; exact pilot geometry remains SKU/IFU data | Curved access envelope, short anchor pilot, deployed anchor | [Official page](https://www.conmed.com/en/products/implants-and-suture-anchors/knot-tying-suture-anchors/y-knot-flex-all-suture-anchor) |

Use CONMED as the current manufacturer name. Store Linvatec as a legacy alias. The current guide page itself describes Bullseye as legacy; ExoShape availability was not verified on a current standalone page.

## 10. Medacta SportsMed

| System/device | Exact selectable facts for the seed catalog | Geometry and use represented | Source |
|---|---|---|---|
| M-ARS ACL system | Three overlapping 2.4 mm K-wire holes; 4.5 mm overdrilling; small/medium/large femoral and tibial dilators; femoral dilator creates a flat/chamfered rectangular tunnel; tibial holes and dilator create a C-shaped/ribbon tunnel; 35- and 50-degree femoral aimers | Noncircular overlapping-hole-plus-dilator CSG, including cross-section orientation and ribbon graft twist | [Official page](https://www.medacta.com/EN/m-ars-acl-set), [technique](https://media.medacta.com/media/99-101-12us-rev04.pdf) |
| Mecta ACL SB | AM or transtibial configurations; tibial aimer 45–70 degrees; current instrumentation lists circular reaming across 4.5–12 mm in 0.5 mm steps and oval dilators 6–12 mm in 0.5 mm steps, subject to selected tray and regional catalog | Single-bundle circular or oval tunnel with exact selected guide/reamer/dilator chain | [Official page](https://www.medacta.com/EN/mecta-acl-sb), [instrument catalog](https://aws-media.medacta.com/media/9999smk12inst-rev00.pdf) |
| Mecta PCL | Single-bundle transtibial PCL set with PCL aimer/protective instrumentation in current catalog | PCL tibial/femoral tunnel plus posterior safety/access envelope | [Official page](https://www.medacta.com/EN/mecta-pcl?lang=EN), [instrument catalog](https://aws-media.medacta.com/media/9999smk12inst-rev00.pdf) |
| Medacta reamer trays | Cannulated tibial reamers 6–12 mm whole sizes; acorn and low-profile families documented in current instrumentation catalog | Rigid full-tunnel/headed/low-profile recipes | [Instrument catalog](https://aws-media.medacta.com/media/9999smk12inst-rev00.pdf) |
| FairFix / MBlock / MectaLoop | Adjustable and fixed-loop cortical fixation families; exact button and channel dimensions are product/SKU fields | Cortical button/channel geometry | [FairFix](https://www.medacta.com/EN/fairfix-global), [MBlock](https://www.medacta.com/EN/mblock-global), [MectaLoop](https://www.medacta.com/EN/mectaloop) |
| MectaScrew / PEEK-CF / titanium screws | Interference-screw families | Screw/thread envelope | [MectaScrew](https://www.medacta.com/handler/content/3579/EN), [other screws](https://www.medacta.com/handler/content/3583/EN) |
| Draw Tight / peripheral-ligament anchors | Current peripheral knee ligament portfolio | Anchor pilot/deployed anchor for repair or onlay constructs | [Official page](https://www.medacta.com/EN/peripheral-ligament) |

Parcus was divested by Anika and acquired by Medacta in 2025. Do not offer “Anika/Parcus” as a current manufacturer. Former Parcus ACL Set, GFS/GFS II, and reamer SKUs stay `legacy_or_transition_unclear` until Medacta or the institution confirms their present status.

## 11. Additional regional/OEM catalog candidates

These are useful for an extensible app but should not ship as globally verified defaults without regional product review:

| Manufacturer/system | Publicly documented items | Seed status | Official source |
|---|---|---|---|
| BioTek Ortho | FLOWERTIP headed/cannulated femoral reamers 6–12 mm; FLEXI cannulated reamers; CANNUDRILL tibial reamers; AI all-inside reamers; ONLOC guides; passing pins; dilators; posts/staples/buttons/screws | `region_ifu_check_required` | [Manufacturer product page](https://biotekortho.com/biotek-products/flowertip-cannulated-femoral-reamers/), [manufacturer ACL/PCL page](https://biotekortho.com/) |
| STAR SportsMed | ACL/PCL all-inside set with retrograde reamers, guide handle, sleeves, and reducers | `region_ifu_check_required` | [Manufacturer page](https://www.star-sportsmed.com/product/acl-pcl-all-inside-instruments-set) |
| GPC Medical | ACL/PCL instrument set including reamers, transportal aimer, plugs, screwdriver, and graft-sizing instruments | `region_ifu_check_required` | [Manufacturer page](https://www.gpcmedical.com/1030/GOS1441/acl-pcl-reconstruction-instrument-set.html) |

No current Enovis/DJO ACL/PCL tunnel-drilling platform was verified on the official current site. The Eclipse tenodesis implant is current but is not presented as a cruciate reaming platform. Anika's current site likewise does not establish a current cruciate-tunnel platform after the Parcus divestiture.

## 12. Generic/institution-defined entries that must always be available

The exact instrument may be reusable, hospital-owned, locally manufactured, or absent from a public web catalog. Provide editable parametric entries for:

- straight cannulated drill/reamer;
- headed/acorn reamer;
- low-profile/two-flute reamer;
- flexible reamer and curved guide;
- adjustable and fixed retrograde reamer;
- coring trephine;
- sequential dilators/compactors;
- cortical drill/button channel;
- Beath/eyelet/spade-tip pin;
- drill guide with arbitrary angle, offset, sleeve, and side;
- two-hole/three-hole overlap plus custom dilator;
- oval, rectangular, C-shaped, slot, and arbitrary polygonal tunnel;
- anchor drill/punch/tap;
- interference screw, sheath-and-screw, cortical button/plate, post/washer, and staple;
- burr, rasp, saw, osteotome, and trough template;
- “no tunnel/onlay” with optional anchor/staple/screw pilots.

Institution-defined records must support a local name, manufacturer, catalog number, photo/document attachments, measured dimensions, verification owner, verification date, and retired date. User-entered values must be visually distinguishable from manufacturer-sourced values.

---

# Part III — Technique model for the application

## 13. Technique presets

Technique names are presets, not ground truth. A preset instantiates editable channel objects; the channel objects and chosen devices are authoritative. Never lock a user into the eponym's assumed diameters, points, or fixation.

Required preset families:

| Structure | Presets to support |
|---|---|
| ACL | Single-bundle transtibial; independent anteromedial portal; outside-in; flexible reaming; all-inside bilateral sockets; full-tunnel soft tissue; BTB; double-bundle; ribbon/noncircular; repair/onlay when applicable |
| PCL | Single-bundle transtibial; single-bundle all-inside; double-bundle; outside-in; flexible/rigid femoral; tibial inlay/trough; repair/avulsion pilot channels |
| FCL/PLC | Anatomic two-graft/LaPrade-style; Arciero-style; Larson/modified Larson; isolated FCL; popliteus/popliteofibular variants; repair/onlay; custom |
| MCL/POL/PMC | Anatomic sMCL with POL/PMC; isolated sMCL; modified Lind-type; single- or double-bundle; repair/internal-brace/onlay; custom |
| ALL | Independent femoral/tibial sockets; shared femoral socket when intended; double-strand/transosseous; anchor/onlay; custom |
| LET | Modified Lemaire with interference screw; anchor/onlay; staple; transosseous; no-large-tunnel; custom |
| Meniscal roots | Medial/lateral; single transtibial tunnel; double transtibial tunnels; retro socket; direct anchor; shared or intentionally coalesced channel; custom |
| Other | Revision tunnel avoidance, staged bone grafting, physeal-sparing, tibial-spine/PCL avulsion, and institution-defined constructs |

The UI must present a technique citation/provenance field and clearly label all anatomical points and numeric defaults as editable planning assumptions.

## 14. High-value conflict pairs

The collision dashboard should explicitly group, but never limit analysis to:

- ACL femoral tunnel versus FCL, popliteus, ALL, or LET femoral tunnel/hardware;
- PCL femoral tunnels versus sMCL/POL/PMC femoral tunnel/hardware;
- ACL or PCL tibial tunnel versus medial or lateral meniscal-root tunnels;
- PLC tibial tunnel versus cruciate tibial tunnels;
- paired PLC femoral tunnels versus each other and versus ACL;
- fibular tunnel versus fibular cortex, proximal tibiofibular joint, and any additional fibular pilot;
- posterior PCL pin/reamer overshoot versus user-segmented posterior danger structures;
- all tunnels versus previous hardware, prior tunnels, osteotomy plates/screws, physis, cortex, and articular surface.

Danger-zone analysis must be conditional. If the neurovascular structure, physis, previous hardware, or other risk anatomy is not segmented or registered, display “not evaluated,” never a reassuring green state.

---

# Part IV — Copy/paste Codex prompt

Copy everything inside the following block into Codex from the root of the Multilig Planner repository. Keep this specification file in the repository if possible so Codex can use the detailed catalog above as source data.

```text
You are implementing Multilig Planner, a clinician-directed 3D planning application for multiligament knee surgery. Work in the existing repository and complete a production-quality vertical slice. Do not replace working architecture merely to match a preferred stack.

CONTEXT
- Multilig Planner should reuse the existing MAT Planner Viewer v2 implementation and interaction language wherever it exists: coordinate system, segmentation-to-mesh pipeline, camera, clipping, opacity, selection, controls, rendering conventions, and visual style.
- The application has one main planning workspace. Do not create multiple top-level planning tabs. Use buttons, drawers, dialogs, accordions, and panels within that single workspace.
- The clinician must select the exact technique and exact instrument chain planned for each channel. Never silently choose a manufacturer, device, size, guide, pin, reamer, or fixation implant.
- This is a planning and visualization tool, not autonomous navigation or a source of operative recommendations. Every device/technique value remains clinician-verifiable and editable.

START WITH REPOSITORY DISCOVERY
1. Inspect the repository, package manifests, tests, routes, state management, Viewer v2, segmentation import, mesh coordinate conventions, persistence, and export code.
2. Search for MAT Planner, Viewer v2, existing tunnel/axis primitives, clipping/cross-section code, and any device catalog. Reuse them through a narrow adapter; do not fork or rewrite the viewer without necessity.
3. Read repository instructions and run the existing tests/build before changing code.
4. Write a brief implementation plan tied to actual files, then implement it. Ask only if a truly blocking product decision cannot be inferred from the repository or this prompt.

CORE USER WORKFLOW
1. Create/open a de-identified case and import the existing MRI/DICOM-derived bone segmentations or meshes.
2. Confirm laterality, coordinate frame, femur/tibia/fibula identities, and mesh quality.
3. Select one or more structures/procedures: ACL, PCL, FCL/PLC, MCL/POL/PMC, ALL, LET, medial/lateral meniscal root, or custom.
4. Choose a technique preset. The preset instantiates explicit, editable channel objects; the eponym is metadata, not the geometry source of truth.
5. For every channel select: manufacturer -> product family -> exact product/model/SKU -> guide and side -> guide sleeve/bullet -> pin -> cutter/reamer/dilator -> exact diameter/profile -> depth or full-tunnel mode -> graft -> fixation device and size.
6. Allow Generic Parametric and Institution Defined alternatives at every level. Never force a branded product.
7. Auto-generate the initial 3D tunnel/socket/pilot/trough and instrument access envelope, then allow direct manipulation of apertures, centerline, vector, depth, cross-section orientation, diameter/profile, and cortical channel.
8. Place and inspect all virtual guide pins before reaming. Let the user choose a drilling sequence and animate/scrub through pin placement, reaming, graft passage volume, and fixation placement.
9. Show tunnel/hardware conflicts, edge-to-edge clearance, cortical bridge, cortex/articular breakout, previous tunnel/hardware intersections, and conditional danger-zone analysis.
10. Compare named plan variants side by side or by ghost overlay, then export a de-identified plan summary, plan JSON, and available mesh formats.

ONE-WORKSPACE UI
- Preserve the Viewer v2 center canvas.
- Use a left workflow panel with collapsible sections: Case & Imaging; Procedures; Technique; Instruments; Graft & Fixation; Tunnel Geometry; Sequence.
- Use a right inspection panel for the selected channel/device and a Collision & Safety dashboard.
- Use a compact bottom channel table/timeline when useful. Do not create top-level tabs.
- Provide global visibility buttons for bone, native anatomy/landmarks, tunnels, pins, access envelopes, grafts, hardware, previous tunnels/hardware, and safety anatomy.
- Each channel row must show structure/bundle, bone, technique, selected cutter and size, depth/length, fixation, status, and worst clearance.
- Provide search and filters for manufacturer, procedure, device class, status, region, and local availability.
- Compatibility rules may filter or warn, but any automatic choice must remain uncommitted until the user explicitly selects it.
- If a previous selection becomes incompatible, keep it visible, mark the conflict, and ask the user to resolve it. Do not silently substitute.

DEVICE CATALOG
Implement a versioned, data-driven catalog, not vendor-specific UI branches. Seed the manufacturer-documented families from `Multilig_Planner_Device_Catalog_and_Codex_Prompt.md`, including at minimum:
- Arthrex: FlipCutter III; RetroConstruction; rigid full-thickness, headed, low-profile, flexible and coring reamers; dilators; ACL/PCL ToolBoxes; collateral guides; meniscal-root transtibial and SutureLoc alternatives; TightRope/TightRope SB; FastThread/GraftBolt/SwiveLock/FiberTak geometry.
- Smith+Nephew: ACUFEX TRUNAV and PINPOINT; extra-articular guide placeholder requiring local component data; Meniscal Root Repair System; ULTRABUTTON/ENDOBUTTON/XTENDOBUTTON; BIOSURE; Q-FIX.
- Stryker: VersiTomic flexible and RR with procedure-specific guide arms; VersiTomic ISI; Conquest/SLOT generic tray records; ProCinch/G-Lok/Biosteon; Omega/root fixation geometry.
- Zimmer Biomet: SwitchCut; Precision Flexible; Precision ACL modular trays; Anatomy Specific Guide placeholder; ToggleLoc/AFX/AperFix II/ComposiTCP; all-suture anchor placeholders.
- DePuy Synthes/Mitek: TWISTR (correct spelling) and Cruciate+; RIGIDLOOP; INTRAFIX ADVANCE; MILAGRO ADVANCE.
- CONMED: Infinity retro reamers/guides/pins/dilator; Constant Diameter, Sentinel/GraftMax Flex and Badger reamers; Infinity/GraftMax/XO buttons; GENESYS; Y-Knot PRO Flex.
- Medacta: M-ARS rectangular/C-shaped overlapping-hole-plus-dilator workflow; Mecta ACL SB; Mecta PCL; current reamer trays; FairFix/MBlock/MectaLoop/MectaScrew/peripheral-anchor geometry.
- Generic Parametric, Institution Defined, and legacy/transition aliases.

Catalog source rules:
- Store source URL/document identifier, source title, manufacturer, checked date, market/region, status, revision, and reviewer.
- `manufacturer_documented` means only that an official current page was found; it must not render as “available,” “approved,” or “recommended.”
- Exact dimensions must be nullable. Never invent a dimension. If geometry-critical data are missing, require the user or institutional administrator to enter and verify them before collision analysis is considered complete.
- Support local overrides as new versioned records; never overwrite the manufacturer-source record.
- Keep historical catalog versions so old plans remain reproducible.
- Separate products, variants/SKUs, instruments, compatibility edges, geometry recipes, and sources.
- Never assume cross-manufacturer compatibility or product equivalence.
- Correct historical aliases: TWISTR is canonical; Linvatec is an alias of current CONMED records where appropriate; Anika/Parcus is not a current manufacturer grouping after the 2025 transfer to Medacta; Cayenne is not a separate current owner for AperFix.

MINIMUM DATA MODEL
Adapt names to the repository but preserve these concepts:

CatalogSource {
  id, url, title, manufacturer, documentNumber?, revision?, publishedAt?,
  checkedAt, region, status, reviewer?, notes?
}

CatalogProduct {
  id, manufacturerId, family, productName, canonicalName, aliases[],
  category, procedures[], status, regions[], sourceIds[],
  variants[], compatibleGuideIds[], compatibleInstrumentIds[],
  geometryRecipeId?, warnings[], institutionOverrideOf?
}

CatalogVariant {
  id, sku?, displayName, laterality?, diameterMm?, lengthMm?,
  pilotDiameterMm?, cutterDiameterMm?, sizeRange?, increments?,
  socketDepthRangeMm?, crossSection?, material?, reusable?, sterile?,
  dimensionsVerified, sourceIds[]
}

GeometryRecipe {
  id,
  type: fullCylinder | blindSocketWithPilot | steppedButtonTunnel |
        flexibleAccessStraightTunnel | dilatedProfile | coringAnnulus |
        anchorPilot | interferenceImplant | corticalPlate | postWasher |
        staple | customTrough | customPolygon | noLargeTunnel,
  parameters,
  boneRemovalParts[], accessEnvelopeParts[], retainedImplantParts[]
}

CompatibilityEdge {
  fromId, toId,
  relation: compatible | requires | excludes | unverified,
  conditions?, sourceIds[], region?, status
}

TechniquePreset {
  id, name, aliases[], structures[], citations[], assumptions[],
  channelTemplates[], defaultSequence[], editable: true
}

ChannelPlan {
  id, caseId, variantId, procedure, structure, bundle, bone, side,
  techniquePresetId?, sourceChannelTemplateId?,
  apertureA, apertureB?, targetPoint?, centerline, guidePinVector,
  accessPortalOrIncision?, cuttingDirection, reamingMode,
  crossSection, diameterMm?, dimensions2D?, twistDeg?, taper?,
  fullLengthMm?, socketDepthMm?, corticalChannelDiameterMm?,
  corticalBridgeMm?, apertureChamfer?,
  guideId?, guideVariantId?, sleeveId?, pinId?, cutterId?, cutterVariantId?,
  dilatorSequenceIds[], graft, fixationIds[],
  boneRemovalVolumeRef, accessEnvelopeRef, retainedHardwareVolumeRefs[],
  plannedVsActual, provenance, verificationState, notes
}

CollisionResult {
  id, planVariantId, objectAId, objectBId, class,
  intersects, minimumClearanceMm, closestPoints,
  overlapVolumeMm3?, corticalBridgeMm?, severity,
  evaluationState: evaluated | missingAnatomy | missingDimensions | stale,
  thresholdSource: user | institution | informational,
  message, acknowledgedBy?, acknowledgedAt?
}

PlanVariant {
  id, caseId, name, channels[], sequence[], catalogSnapshotId,
  coordinateFrame, createdAt, updatedAt, parentVariantId?
}

TUNNEL GEOMETRY ENGINE
- Preserve original bone meshes. Render planning volumes as nondestructive overlays; generate boolean-cut previews on demand.
- Intersect the proposed centerline/ray with the appropriate bone mesh using the repository's best acceleration structure (for example BVH). Derive cortical entry/exit and intraosseous length from the mesh rather than a bounding box.
- Generate separate meshes for bone removal, guide pin, reamer head/access sweep, graft, and retained hardware.
- Support full tunnels, blind sockets, stepped button tunnels, tapered/stepped tunnels, paired tunnels, shared/Y channels, transosseous root channels, anchor pilots, coring annuli, noncircular cross-sections, troughs, aperture chamfers, and explicit no-large-tunnel constructs.
- Retrograde recipe = pilot/shaft tract + cutter deployment volume + larger socket pulled in the selected direction + preserved cortical bridge. Never model it as only a large cylinder through the cortex.
- Flexible recipe = final intraosseous tunnel/socket plus the curved guide/shaft access envelope. Do not bend the final bone tunnel merely because the shaft is flexible unless the actual recipe specifies a curved intraosseous cut.
- M-ARS recipe = union of the documented overlapping pilot/reamed holes followed by the selected small/medium/large dilator profile, preserving cross-section orientation and different femoral/tibial shapes.
- Coring recipe = annular kerf plus core state and any required distal predrill.
- Hardware recipes must include the entire physical envelope when dimensions are known, not just a point marker.
- Missing dimensions must produce a conspicuous “geometry incomplete” state and exclude that object from false precision.

DIRECT MANIPULATION AND MEASUREMENTS
- Provide 3D handles for each aperture, axis rotation, depth, diameter/profile, and cross-section orientation.
- Snap only when the user enables snapping. Support named landmarks, native footprint surfaces, and user-defined targets.
- Show total osseous length, socket depth, cortical bridge, closest cortex/articular surface, aperture-to-aperture distance, tunnel-to-tunnel edge clearance, hardware clearance, and pin exit/overshoot.
- Provide synchronized orthogonal/oblique cross-sections through the selected channel and an en-face aperture view.
- Make planned vs actual geometry a first-class state for later registration/import, but do not imply intraoperative navigation.

COLLISION AND SAFETY ENGINE
- Compute volume-volume intersection and minimum surface-to-surface distance for every relevant pair. Centerline distance is insufficient.
- Include tunnel/socket bodies, pilot tracts, cortical channels, guide pins/overshoot, cutter deployment, access envelopes, grafts when relevant, and retained hardware.
- Analyze cortex and articular breakout, posterior-wall/back-wall compromise, cortical bridge thickness, paired-tunnel coalescence, and hardware/tunnel overlap.
- Explicitly group ACL-versus-lateral-femoral, PCL-versus-medial-femoral, cruciate-versus-root, and PLC-tibial-versus-cruciate conflicts while still running the full pairwise/spatial-index analysis.
- Accept segmented/registered neurovascular structures, physis, prior tunnels, prior hardware, and osteotomy hardware as optional risk objects.
- If a risk structure is absent, return `missingAnatomy`; never show “safe.”
- Thresholds are informational and configurable by the clinician/institution. Do not hard-code a universal surgical recommendation.
- Results become stale when geometry, device dimensions, bone registration, or catalog version changes; recompute deterministically.
- Let the user acknowledge a warning without deleting or suppressing its underlying result.

TECHNIQUE PRESETS
Implement editable presets for ACL, PCL, FCL/PLC, MCL/POL/PMC, ALL, LET, and medial/lateral roots, including the preset families listed in the specification file. Presets should instantiate channel templates and a possible sequence, but must not assert that an eponym has one universally correct tunnel point or dimension. Store citations and assumptions. The user can add, delete, duplicate, share, merge, or intentionally coalesce channels.

SEQUENCING
- Show all virtual pins before any reaming step.
- Support user-defined order for pinning, reaming, graft passage, and fixation.
- At each step show which volumes already exist and which future paths they threaten.
- Detect when a later pin/reamer/hardware path intersects an earlier tunnel or implant.
- Allow comparison of sequences without changing the geometric plan.

PERSISTENCE, PRIVACY, AND EXPORT
- Persist a versioned plan JSON with coordinate frame, source mesh hashes, catalog snapshot, all channel/device choices, dimensions, warnings, acknowledgements, and provenance.
- Use de-identified identifiers. Preserve the repository's existing local/privacy architecture; do not add telemetry or external upload of imaging/PHI.
- Support existing mesh exports where available (for example STL/OBJ/glTF), plus a de-identified plan JSON and human-readable report. Clearly label outputs “planning only—not for autonomous navigation.”
- Exports must state which safety objects were absent and which device dimensions were user-entered or unverified.

TESTS
Add unit, integration, and end-to-end coverage appropriate to the existing stack:
1. Catalog schema validation, version migration, aliases, source/status rendering, local overrides, and compatibility filtering.
2. Full cylinder, blind socket with pilot, stepped tunnel, flexible-access envelope, coring annulus, noncircular dilated profile, anchor pilot, and trough geometry.
3. Mesh entry/exit and osseous-length calculations on deterministic synthetic femur/tibia/fibula fixtures.
4. Edge-to-edge tunnel clearance and overlap volume, including pilot tracts and retained hardware.
5. Retro reamer regression: changing socket depth must not enlarge the retained cortical pilot channel.
6. M-ARS regression: cross-section and orientation survive serialization and differ from a circular tunnel of equal area.
7. Missing danger-zone anatomy returns `missingAnatomy`, never safe/pass.
8. Technique preset instantiation and user override without silent device substitution.
9. Plan variant clone/compare and lossless JSON round trip.
10. One-workspace UI flow selecting an exact manufacturer/product/SKU/size for each channel.
11. Regression fixtures for ACL+PLC lateral femoral conflict, PCL double-bundle+MCL/POL conflict, cruciate+root tibial conflict, and fibular tunnel cortical breakout.
12. Viewer v2 visual/interaction regression tests where the repository supports them.

ACCEPTANCE CRITERIA
- A user can create a combined ACL/PCL/PLC/root case in one workspace and choose a different exact device chain for every channel.
- Selecting a technique creates editable channel objects; changing technique or instrument does not erase user work without confirmation.
- Branded and generic/custom instruments use the same geometry engine.
- Retrograde, flexible, rigid, dilated noncircular, anchor-pilot, full-tunnel, trough, and no-large-tunnel constructs are visually and computationally distinct.
- Collision values are computed from swept/solid volumes and report edge-to-edge clearance.
- Every displayed manufacturer fact has provenance and status; missing values remain missing.
- Region/IFU verification is visible at selection and export.
- The app never states that a plan is safe, approved, or recommended.
- Existing Viewer v2 controls and application tests remain functional.
- New code passes formatting, type-checking, tests, and production build.

DELIVERY
Implement the vertical slice, seed the catalog as versioned data, add tests and concise developer documentation, run all relevant checks, and report:
- architecture and files changed;
- tests/build commands and results;
- any missing manufacturer dimensions represented as incomplete rather than guessed;
- any follow-up work required for clinical validation, local tray verification, performance, or regulatory review.
```

---

# Part V — Suggested implementation details

## 15. Recommended service boundaries

Keep the viewer reusable by placing clinical planning logic behind narrow services:

- `ViewerAdapter`: mesh display, picking, clipping, camera, overlays, transform/coordinate conversion.
- `CatalogRepository`: versioned sources, products, variants, local overrides, aliases, and compatibility edges.
- `TechniquePresetRegistry`: preset-to-channel instantiation and provenance.
- `ChannelGeometryEngine`: parametric geometry recipes and mesh intersections.
- `CollisionEngine`: spatial index, clearances, overlap, cortical bridge, and stale-result tracking.
- `SequenceSimulator`: ordered pin/reamer/hardware states.
- `PlanStore`: plan variants, catalog snapshots, undo/redo, and serialization.
- `ReportExporter`: de-identified JSON/report/mesh outputs and verification disclosures.

## 16. Important product-design rules

1. Selection is per channel. A case can mix manufacturers or device classes.
2. “Compatible” and “commonly paired” are different relations and require provenance.
3. Do not auto-change diameter when a graft size changes; offer a suggested unresolved update.
4. Do not delete a conflicting channel. Explain the conflict and let the clinician revise the plan.
5. Preserve source dimensions and institution overrides as separate immutable versions.
6. Display unverified dimensions with a distinct visual treatment and exclude them from definitive numeric clearances.
7. Support a local tray template so an institution can restrict the picker to instruments actually stocked.
8. Let users duplicate a plan before accepting a technique or device change.
9. Record laterality and side-specific guide selection explicitly.
10. Store the difference between the axis of the final tunnel and the path required to introduce the guide/reamer.
11. Use millimeters internally and serialize units explicitly.
12. Preserve the imaging coordinate frame and all transforms in every export.

## 17. Clinical and software validation boundary

The product can verify geometry calculations, catalog provenance, reproducibility, and UI behavior. It cannot, through software tests alone, validate anatomical landmark definitions, procedural suitability, device indications, neurovascular safety, or clinical outcome. Those require formal domain review, current labeling review, representative imaging and cadaver/sawbones validation, human-factors testing, and the applicable quality/regulatory process.
