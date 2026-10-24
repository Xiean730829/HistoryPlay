import React from "react";
import "@google/model-viewer";
import { AppliedCamera } from "./AppliedCamera";

interface Artifact3DProps {
  src: string;
  poster: string | null;
  alt: string;
  orbit: string;
  renderKey?: number;
  onRendered?: () => void;
  onDegraded?: () => void;
}

export function Artifact3D({ src, poster, alt, orbit, renderKey, onRendered, onDegraded }: Artifact3DProps) {
  const viewer = React.useRef<HTMLElement>(null);
  const fallbackReported = React.useRef(false);
  const callbacks = React.useRef({ onRendered, onDegraded });
  callbacks.current = { onRendered, onDegraded };
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [posterLoaded, setPosterLoaded] = React.useState(false);
  const evidence = React.useRef(new AppliedCamera());

  React.useEffect(() => {
    fallbackReported.current = false;
    setLoaded(false);
    setFailed(false);
    setPosterLoaded(false);
    evidence.current = new AppliedCamera();
  }, [src]);

  React.useEffect(() => {
    if (!failed || !posterLoaded || fallbackReported.current) return;
    fallbackReported.current = true;
    callbacks.current.onDegraded?.();
  }, [failed, posterLoaded]);

  React.useLayoutEffect(() => {
    const element = viewer.current;
    if (!element) return;
    const onLoad = () => {
      setLoaded(true);
      setFailed(false);
    };
    const onError = () => { setLoaded(false); setFailed(true); };
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
    };
  }, [src]);

  React.useEffect(() => {
    if (!loaded || failed) return;
    const element = viewer.current as (HTMLElement & {
      updateComplete: Promise<boolean>;
      jumpCameraToGoal(): void;
      getCameraOrbit(): { theta: number; phi: number; radius: number };
    }) | null;
    if (!element) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const inspect = () => {
      if (cancelled) return;
      const bounds = element.getBoundingClientRect();
      const visible = element.isConnected && bounds.width > 0 && bounds.height > 0
        && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight
        && getComputedStyle(element).visibility !== "hidden";
      if (visible && evidence.current.matches(orbit, element.getCameraOrbit())) {
        callbacks.current.onRendered?.();
      } else if (++attempts < 60) frame = requestAnimationFrame(inspect);
    };
    void (async () => {
      await element.updateComplete;
      if (cancelled) return;
      element.jumpCameraToGoal();
      await element.updateComplete;
      if (!cancelled) frame = requestAnimationFrame(inspect);
    })();
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [loaded, failed, src, orbit, renderKey]);

  return (
    <div className="artifact-3d" data-testid="artifact-3d" data-model-state={loaded ? "ready" : failed ? "error" : "loading"}>
      {poster && (!loaded || failed) && <img
        alt=""
        className="artifact-3d-poster"
        onLoad={() => setPosterLoaded(true)}
        src={poster}
      />}
      <model-viewer
        alt={alt}
        camera-controls
        camera-orbit={orbit}
        className="artifact-3d-viewer"
        interaction-prompt="none"
        ref={viewer}
        shadow-intensity="0"
        src={src}
        touch-action="pan-y"
      />
      <span className="visually-hidden" role="status" aria-live="polite">
        {loaded ? `${alt}已载入` : failed ? `${alt}不可用，显示真实预览图` : `正在载入${alt}`}
      </span>
    </div>
  );
}
