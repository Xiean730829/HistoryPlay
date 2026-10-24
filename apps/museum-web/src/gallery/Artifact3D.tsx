import React from "react";
import "@google/model-viewer";

interface Artifact3DProps {
  src: string;
  poster: string | null;
  alt: string;
  orbit: string;
}

export function Artifact3D({ src, poster, alt, orbit }: Artifact3DProps) {
  const viewer = React.useRef<HTMLElement>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useLayoutEffect(() => {
    const element = viewer.current;
    if (!element) return;
    const onLoad = () => { setLoaded(true); setFailed(false); };
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
      {poster && (!loaded || failed) && <img alt="" className="artifact-3d-poster" src={poster} />}
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
