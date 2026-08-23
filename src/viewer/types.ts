export type ViewerLayer =
  | "bones"
  | "landmarks"
  | "mri"
  | "boneRemoval"
  | "pins"
  | "access"
  | "deployment"
  | "grafts"
  | "hardware"
  | "previous"
  | "safety"
  | "measurements"
  | "ghost";

/**
 * Optional presentation treatment understood by the narrow MAT Viewer v2
 * adapter. `standard` preserves the established Viewer material conventions;
 * `biologic_graft` uses a non-metallic, translucent tissue-like finish.
 */
export type ViewerMeshMaterialStyle = "standard" | "biologic_graft";

export interface ViewerMeshPayload {
  id: string;
  name: string;
  vertices: number[][];
  faces: number[][];
  color: string;
  opacity: number;
  layer: ViewerLayer;
  channelId?: string;
  analysisCategory?: string;
  materialStyle?: ViewerMeshMaterialStyle;
  /**
   * Optional patient-RAS polylines rendered just above a biologic graft mesh.
   * They are presentation-only longitudinal fascicle cues and are never used
   * for collision, measurement, or clinical analysis.
   */
  fiberPaths?: [number, number, number][][];
  /** Optional anatomy identity used by Viewer-only surface constraints and styling. */
  anatomyBone?: "femur" | "tibia" | "fibula" | "patella" | "custom";
}

export interface ViewerLinePayload {
  id: string;
  points: number[][];
  color: string;
  opacity?: number;
  layer: ViewerLayer;
  channelId?: string;
}

export type HandleKind = "aperture" | "endpoint" | "diameter" | "orientation";

export type ViewerHandleSemanticRole =
  | "entry"
  | "start"
  | "trajectory"
  | "dimension"
  | "orientation";

export interface ViewerSurfaceConstraint {
  /** Exact ViewerMeshPayload IDs that are eligible for drag raycasts. */
  meshIds: string[];
  /** Patient-space rule applied after the pointer identifies a target X/Y. */
  mode?: "nearest_surface" | "tibial_superior_envelope";
}

export interface ViewerHandlePayload {
  id: string;
  channelId: string;
  kind: HandleKind;
  position: [number, number, number];
  color: string;
  label: string;
  /** Presentation-only meaning. Callback `kind` remains unchanged. */
  semanticRole?: ViewerHandleSemanticRole;
  /**
   * Persisted patient-RAS surface normal at this handle's attachment. The
   * Viewer uses this only to orient surface-tangent presentation geometry;
   * it never derives or changes the clinical attachment.
   */
  surfaceNormalPatientRas?: [number, number, number];
  /**
   * Optional fixed patient-space pivot for a thick trajectory rod ending at
   * this handle. Presentation only: the analytic channel remains authoritative.
   */
  trajectoryPivotPatientRas?: [number, number, number];
  /** World-space display radius for the optional trajectory rod. */
  trajectoryRadiusMm?: number;
  /** When supplied, dragging snaps only to ray hits on these scene meshes. */
  surfaceConstraint?: ViewerSurfaceConstraint;
}

export interface ViewerLabelPayload {
  id: string;
  text: string;
  /** Anchor in the canonical patient-RAS millimetre frame. */
  position: [number, number, number];
  color?: string;
  opacity?: number;
  /** World-space label height in millimetres. */
  sizeMm?: number;
  layer?: ViewerLayer;
  channelId?: string;
}

export interface ViewerPlanningScene {
  type: "multilig_planning_scene";
  revision: number;
  /**
   * Iframe-transport hint set only by MatViewerV2Adapter. When true, `meshes`
   * contains dynamic planning meshes only and Viewer v2 must retain the bone
   * meshes from the preceding full scene. Clinical scene builders should leave
   * this unset.
   */
  preserveAnatomy?: boolean;
  /**
   * Deterministic fingerprint paired with `preserveAnatomy`. Viewer v2 rejects
   * a partial update if this does not match its currently loaded anatomy and
   * asks the host for a full refresh.
   */
  anatomySignature?: string;
  meshes: ViewerMeshPayload[];
  lines: ViewerLinePayload[];
  handles: ViewerHandlePayload[];
  labels?: ViewerLabelPayload[];
  layerVisibility: Record<ViewerLayer, boolean>;
  globalOpacity: number;
  clipping: { enabled: boolean; axis: "x" | "y" | "z"; offsetMm: number; invert: boolean };
  crossSection: { enabled: boolean; axis: "x" | "y" | "z"; offsetMm: number };
  /** Camera-coupled medial/lateral badges; laterality remains visibly unverified when applicable. */
  orientationMarkers?: {
    laterality: "left" | "right" | "unverified";
    verified: boolean;
  };
  selectedChannelId: string | null;
}

export interface ViewerHandleChange {
  channelId: string;
  kind: HandleKind;
  position: [number, number, number];
  phase: "preview" | "commit";
}

export interface ViewerScreenshotRequest {
  channelId: string;
  nonce: number;
}

export interface ViewerScreenshotResult {
  channelId: string;
  dataUrl: string | null;
  error: string | null;
}

export type StandardView = "+x" | "-x" | "+y" | "-y" | "+z" | "-z" | "focus";
