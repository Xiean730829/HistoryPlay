import React from "react";
import "./story-weather.css";

type Weather = "snow" | "rain";

// These masks are authored for the corresponding scene image, not for a
// whole story. Recheck the illustration if an asset is ever replaced.
export function storyWeather(packId: string, nodeId: string, assetId: string): Weather | null {
  if (packId !== "cn.song.core") return null;
  if (nodeId === "cn.song.node.snowy-riverbank.02" && assetId === "cn.song.asset.snowy-riverbank.story-02") return "snow";
  if (nodeId === "cn.song.node.snowy-riverbank.03" && assetId === "cn.song.asset.snowy-riverbank.story-03") return "snow";
  if (nodeId === "cn.song.node.sheng-sheng-man.02" && assetId === "cn.song.asset.sheng-sheng-man.story-02") return "rain";
  return null;
}

/** Decorative only. SVG coordinates follow the displayed illustration's 3:2 frame. */
export function StoryWeather({ weather }: { weather: Weather }) {
  const clipId = React.useId();
  const snowGradient = React.useId();
  const rainGradient = React.useId();
  const blurId = React.useId();
  const count = weather === "snow" ? 94 : 132;
  return (
    <svg className={`story-weather story-weather--${weather}`} viewBox="0 0 1500 1000"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" data-weather={weather}>
      <defs>
        <radialGradient id={snowGradient}>
          <stop offset="0" stopColor="#fffef6" stopOpacity=".95" />
          <stop offset=".43" stopColor="#f2f2eb" stopOpacity=".66" />
          <stop offset="1" stopColor="#e3e8e7" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={rainGradient} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#dce7e8" stopOpacity="0" />
          <stop offset=".7" stopColor="#e2ebea" stopOpacity=".48" />
          <stop offset="1" stopColor="#f0f3ed" stopOpacity=".75" />
        </linearGradient>
        <filter id={blurId} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="2" /></filter>
        <clipPath id={clipId}>
          {weather === "rain" ? <rect x="475" y="125" width="950" height="570" /> : <rect width="1500" height="1000" />}
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {Array.from({ length: count }, (_, index) => {
          const x = (index * 379 + 53) % 1600;
          const depth = index % 4;
          const duration = weather === "snow" ? 10 + depth * 2 + (index % 3) : 1.6 + depth * 0.4;
          const delay = -(index * 2.71 % duration);
          const style = { "--weather-duration": `${duration}s`, "--weather-delay": `${delay}s`,
            "--weather-opacity": weather === "snow" ? 0.38 + depth * 0.13 : 0.3 + depth * 0.11,
            "--weather-drift": `${-38 - (index % 6) * 20}px` } as React.CSSProperties;
          return weather === "snow"
            ? <circle key={index} className="story-weather-particle story-weather-snow" cx={x} cy="-35"
              r={4 + depth * 2.1} fill={`url(#${snowGradient})`} filter={depth === 3 ? `url(#${blurId})` : undefined} style={style} />
            : <line key={index} className="story-weather-particle story-weather-rain" x1={x} x2={x - 8 - depth * 3}
              y1="-55" y2={-19 + depth * 6} stroke={`url(#${rainGradient})`} strokeWidth={1.3 + depth * 0.45} style={style} />;
        })}
      </g>
    </svg>
  );
}
