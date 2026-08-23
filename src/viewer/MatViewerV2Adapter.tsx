import { useEffect, useMemo, useRef, useState } from "react";
import type {
  StandardView,
  ViewerHandleChange,
  ViewerPlanningScene,
  ViewerScreenshotRequest,
  ViewerScreenshotResult,
} from "./types";
import { parseViewerHandleChange } from "./protocol";
import { publicAssetPath } from "../publicAssetPath";

interface Props {
  scene: ViewerPlanningScene;
  standardView?: { view: StandardView; nonce: number };
  screenshotRequest?: ViewerScreenshotRequest | null;
  onHandleChange: (change: ViewerHandleChange) => void;
  onReady?: () => void;
  onSelectChannel?: (channelId: string) => void;
  onScreenshot?: (result: ViewerScreenshotResult) => void;
}

interface ViewerMessage {
  type?: string;
  channelId?: string;
  kind?: ViewerHandleChange["kind"];
  position?: number[];
  phase?: ViewerHandleChange["phase"];
  dataUrl?: string;
  error?: string;
}

/**
 * Narrow iframe boundary around the canonical MAT Viewer v2 client.
 * Clinical state and geometry generation remain outside the viewer.
 */
export function MatViewerV2Adapter({
  scene,
  standardView,
  screenshotRequest,
  onHandleChange,
  onReady,
  onSelectChannel,
  onScreenshot,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const title = useMemo(
    () => `MAT Viewer v2 · scene revision ${scene.revision}`,
    [scene.revision],
  );

  useEffect(() => {
    const receive = (event: MessageEvent<ViewerMessage>) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== window.location.origin ||
        !event.data
      ) return;
      if (event.data.type === "multilig_viewer_ready") {
        setReady(true);
        onReady?.();
        return;
      }
      const handleChange = parseViewerHandleChange(event.data);
      if (handleChange) onHandleChange(handleChange);
      if (event.data.type === "multilig_channel_selected" && event.data.channelId) {
        onSelectChannel?.(event.data.channelId);
      }
      if (event.data.type === "multilig_png_ready" && event.data.channelId) {
        onScreenshot?.({
          channelId: event.data.channelId,
          dataUrl: event.data.dataUrl ?? null,
          error: event.data.error ?? null,
        });
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onHandleChange, onReady, onScreenshot, onSelectChannel]);

  useEffect(() => {
    if (!ready) return;
    frameRef.current?.contentWindow?.postMessage(scene, window.location.origin);
  }, [ready, scene]);

  useEffect(() => {
    if (!ready || !standardView) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: "multilig_standard_view", view: standardView.view },
      window.location.origin,
    );
  }, [ready, standardView]);

  useEffect(() => {
    if (!ready || !screenshotRequest) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "multilig_capture_png",
        channelId: screenshotRequest.channelId,
        nonce: screenshotRequest.nonce,
      },
      window.location.origin,
    );
  }, [ready, screenshotRequest]);

  const handleLoad = () => {
    setReady(true);
    frameRef.current?.contentWindow?.postMessage(scene, window.location.origin);
    onReady?.();
  };

  const clearViewerHover = () => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "multilig_clear_hover" },
      window.location.origin,
    );
  };

  return (
    <iframe
      ref={frameRef}
      className="mat-viewer-frame"
      src={`${publicAssetPath("mat-viewer-v2.html")}?embedded=1&auto=0&mode=multilig`}
      title={title}
      onLoad={handleLoad}
      onPointerLeave={clearViewerHover}
      onBlur={clearViewerHover}
      allow="fullscreen"
    />
  );
}
