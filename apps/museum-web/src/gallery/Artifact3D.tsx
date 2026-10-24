import React from "react";
import "@google/model-viewer";

interface Artifact3DProps {
  src: string;
  poster: string | null;
  alt: string;
  orbit: string;
  onRendered?: () => void;
  onDegraded?: () => void;
}

export function Artifact3D({ src, poster, alt, orbit, onRendered, onDegraded }: Artifact3DProps) {
  const viewer = React.useRef<HTMLElement>(null);
  const fallbackReported = React.useRef(false);
  const callbacks = React.useRef({ onRendered, onDegraded });
  callbacks.current = { onRendered, onDegraded };
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [posterLoaded, setPosterLoaded] = React.useState(false);

  React.useEffect(() => {
    fallbackReported.current = false;
    setLoaded(false);
    setFailed(false);
    setPosterLoaded(false);
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
      requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        const onscreen = bounds.width > 0 && bounds.height > 0 &&
          bounds.right > 0 && bounds.bottom > 0 &&
          bounds.left < window.innerWidth && bounds.top < window.innerHeight &&
          getComputedStyle(element).visibility !== "hidden";
        if (element.isConnected && onscreen) callbacks.current.onRendered?.();
      });
    };
    const onError = () => { setLoaded(false); setFailed(true); };
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    return () => {
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
    };
  }, [src]);

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
