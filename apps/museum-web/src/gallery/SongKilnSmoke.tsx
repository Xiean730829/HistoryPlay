import React from "react";
import "./song-kiln-smoke.css";

// The coordinates match the current craft-scroll illustration's 2066 × 761 pixels.
// If the picture is replaced these three origins must be reviewed against it.
export function kilnSmokeForScroll(packId: string, scrollId: string | undefined, assetId: string | undefined) {
  return packId === "cn.song.core" && scrollId === "cn.song.scroll.craft" && assetId === "cn.song.asset.scroll.craft";
}

export function SongKilnSmoke() {
  const gradient = React.useId();
  const sources = [{ x: 151, y: 204 }, { x: 380, y: 255 }, { x: 602, y: 273 }];
  return <svg className="song-kiln-smoke" viewBox="0 0 2066 761" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><radialGradient id={gradient}>
      <stop offset="0" stopColor="#f0ede1" stopOpacity=".62" />
      <stop offset=".5" stopColor="#e4e1d6" stopOpacity=".38" />
      <stop offset="1" stopColor="#d7d8d0" stopOpacity="0" />
    </radialGradient></defs>
    {sources.map((source, sourceIndex) => <g key={sourceIndex} transform={`translate(${source.x} ${source.y})`}>
      {Array.from({ length: 12 }, (_, index) => <ellipse key={index} className="song-kiln-smoke-puff"
        cx="0" cy="0" rx={19 + (index % 3) * 4} ry={13 + (index % 2) * 4} fill={`url(#${gradient})`}
        style={{ "--smoke-duration": `${7 + (index % 3)}s`, "--smoke-delay": `${-(index * .76 + sourceIndex * .8)}s`,
          "--smoke-drift": `${-15 + (index % 4) * 10}px` } as React.CSSProperties} />)}
    </g>)}
  </svg>;
}
