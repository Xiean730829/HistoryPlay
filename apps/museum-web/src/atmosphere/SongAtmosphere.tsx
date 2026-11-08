import React from "react";
import "./song-atmosphere.css";

type CueKind = "water" | "mist" | "smoke" | "lamp" | "dust";
type Cue = { kind: CueKind; x: number; y: number; w?: number; h?: number };
const water = (x: number, y: number, w = 20, h = 9): Cue => ({ kind: "water", x, y, w, h });
const mist = (x: number, y: number, w = 24, h = 6): Cue => ({ kind: "mist", x, y, w, h });
const smoke = (x: number, y: number): Cue => ({ kind: "smoke", x, y });
const lamp = (x: number, y: number): Cue => ({ kind: "lamp", x, y });
const dust = (x: number, y: number, w = 18, h = 28): Cue => ({ kind: "dust", x, y, w, h });

// Coordinates are percentages of the specific original illustration. A new image
// with the same asset ID must be visually reviewed before reusing its cues.
const STORIES: Record<string, Cue[]> = {
  "autumn-river-village.01": [water(30, 62, 30, 15)],
  "autumn-river-village.02": [water(25, 76, 22, 10)],
  "autumn-river-village.03": [water(30, 62, 32, 15)],
  "boat-haulers.01": [water(67, 74, 24, 12)],
  "boat-haulers.02": [water(76, 72, 22, 12)],
  "boat-haulers.03": [water(68, 64, 25, 10)],
  "bowl-mold.03": [lamp(57, 49)],
  "bronze-censer.01": [smoke(50, 43)],
  "bronze-censer.03": [smoke(51, 43)],
  "chongning-coin.01": [dust(75, 27, 15, 30)],
  "chongning-coin.03": [dust(77, 28, 15, 27)],
  "ding-vase.01": [dust(13, 32, 15, 28)],
  "dragon-boat-figurine.02": [water(22, 63, 25, 9)],
  "fan-kuan-landscape.01": [water(76, 76, 20, 9)],
  "fan-kuan-landscape.02": [mist(23, 65, 20, 7)],
  "fan-kuan-landscape.03": [mist(76, 66, 18, 6)],
  "guan-vase.01": [dust(13, 29, 12, 25)],
  "house-model.01": [dust(16, 27, 12, 24)],
  "house-model.02": [dust(14, 27, 12, 24)],
  "jian-tea-bowl.01": [lamp(90, 34)],
  "jian-tea-bowl.02": [lamp(88, 42)],
  "longquan-vase.01": [dust(14, 25, 14, 26)],
  "mi-fu-scroll.01": [water(35, 76, 28, 12)],
  "mi-fu-scroll.03": [water(27, 45, 20, 8)],
  "qingbai-ewer.01": [lamp(88, 37)],
  "qingbai-ewer.02": [lamp(88, 57)],
  "qingbai-ewer.03": [lamp(5, 27)],
  "shui-diao-ge-tou.01": [water(31, 65, 21, 14)],
  "shui-diao-ge-tou.02": [mist(30, 68, 25, 7)],
  "shui-diao-ge-tou.03": [water(67, 65, 20, 12)],
  "yong-yu-le.01": [water(68, 63, 22, 10)],
  "yong-yu-le.02": [water(43, 58, 26, 10)],
  "yong-yu-le.03": [water(74, 63, 24, 11)],
  // The following cues were placed against the user-approved 0.1.3 images.
  "qingming-riverside.01": [mist(66, 42, 25, 6)],
  "qingming-riverside.02": [water(64, 72, 23, 8)],
  "jiaozi.01": [dust(71, 30, 16, 28)],
  "jiaozi.02": [dust(81, 33, 12, 24)],
  "dongjing-menghua.01": [water(24, 52, 19, 8)],
  "dongjing-menghua.02": [lamp(87, 36), lamp(17, 57)],
  "thousand-li-rivers-mountains.01": [mist(48, 59, 27, 6)],
  "thousand-li-rivers-mountains.02": [water(55, 75, 24, 9)],
  "fan-kuan-travelers.01": [mist(49, 60, 27, 7)],
  "fan-kuan-travelers.03": [mist(78, 73, 20, 7)],
  "listening-qin.01": [mist(55, 41, 20, 5)],
  "hanshi-scroll.01": [lamp(42, 63)],
  "hanshi-scroll.03": [mist(46, 43, 18, 6)],
  "zuiweng-pavilion.01": [mist(75, 38, 19, 6)],
  "zuiweng-pavilion.02": [mist(45, 48, 22, 6)],
  "later-red-cliff.01": [water(72, 65, 18, 12)],
  "later-red-cliff.02": [mist(23, 70, 20, 7)],
  "later-red-cliff.03": [water(73, 71, 18, 13)],
  "summer-quatrain.01": [water(33, 47, 21, 7)],
  "summer-quatrain.03": [water(70, 62, 18, 9)],
  "shier.01": [lamp(63, 59)],
  "shier.02": [mist(69, 45, 24, 5)],
  "passing-lingding.01": [water(35, 65, 26, 11)],
  "passing-lingding.02": [water(50, 70, 35, 14)],
  "movable-type.01": [dust(16, 30, 16, 24)],
  "movable-type.03": [dust(83, 27, 14, 22)],
  "ru-celadon-dish.01": [dust(12, 27, 13, 22)],
  "ru-celadon-dish.03": [lamp(28, 40)],
  "water-astronomical-clock.02": [water(50, 88, 18, 5)],
  "water-astronomical-clock.03": [lamp(62, 52)],
  "jingkang-change.02": [water(25, 56, 18, 7)],
  "jingkang-change.03": [water(54, 67, 25, 10)],
  "yancheng-battle.01": [water(65, 65, 22, 8)],
  "yancheng-battle.03": [water(75, 66, 18, 9)],
  "yashan-battle.01": [water(55, 69, 22, 9)],
  "yashan-battle.02": [water(53, 67, 23, 10)],
  "yashan-battle.03": [water(74, 61, 19, 8)],
};

const SCROLLS: Record<string, Cue[]> = {
  life: [water(58, 78, 15, 8), water(80, 60, 13, 7)],
  landscape: [mist(26, 56, 20, 8), mist(62, 36, 25, 5)],
  poetry: [water(24, 53, 14, 10), lamp(2, 54)],
  craft: [water(73, 68, 12, 7)],
  city: [water(63, 68, 18, 9)],
  gathering: [smoke(7.5, 55), water(55, 75, 15, 8)],
  "bianjing-lanterns": [water(25, 70, 18, 9), lamp(67, 58)],
  "mountains-into-painting": [mist(54, 43, 21, 6), water(11, 76, 15, 8)],
  "literati-travel": [water(79, 63, 16, 8), lamp(12, 52)],
  "poetic-rivers": [mist(44, 72, 22, 6), water(14, 50, 15, 7)],
  "investigation-making": [lamp(53, 47), smoke(46, 42)],
  "turning-rivers": [water(78, 69, 17, 8), mist(53, 44, 18, 5)],
};

// The six 0.1.4 panoramas have new framing; keep older-session cues intact.
const WIDE_SCROLLS: Record<string, Cue[]> = {
  "bianjing-lanterns": [water(36, 68, 16, 10), lamp(62, 62)],
  "mountains-into-painting": [mist(55, 47, 19, 6), water(25, 80, 17, 8)],
  "literati-travel": [water(78, 65, 16, 8), lamp(7, 56)],
  "poetic-rivers": [mist(46, 73, 17, 6), water(29, 59, 16, 8)],
  "investigation-making": [lamp(48, 59), smoke(46, 53)],
  "turning-rivers": [water(76, 67, 18, 8), mist(55, 39, 18, 5)],
};

export function storyAtmosphere(pack: string, node: string, asset: string): Cue[] {
  if (pack !== "cn.song.core") return [];
  const match = /^cn\.song\.node\.([a-z-]+)\.(0[1-3])$/.exec(node);
  if (!match || asset !== `cn.song.asset.${match[1]}.story-${match[2]}`) return [];
  return STORIES[`${match[1]}.${match[2]}`] ?? [];
}

export function scrollAtmosphere(pack: string, scrollId?: string, assetId?: string, version?: string): Cue[] {
  if (pack !== "cn.song.core") return [];
  const match = /^cn\.song\.scroll\.([a-z-]+)$/.exec(scrollId ?? "");
  if (!match || assetId !== `cn.song.asset.scroll.${match[1]}`) return [];
  return (version === "0.1.4" ? WIDE_SCROLLS[match[1]] : undefined) ?? SCROLLS[match[1]] ?? [];
}

/** A single, lightweight non-interactive layer. Coordinates follow the source image. */
export function SongAtmosphere({ cues, scroll = false }: { cues: Cue[]; scroll?: boolean }) {
  const gradient = React.useId();
  if (!cues.length) return null;
  return <svg className="song-atmosphere" viewBox="0 0 1500 1000"
    preserveAspectRatio={scroll ? "none" : "xMidYMid meet"} aria-hidden="true" focusable="false">
    <defs><radialGradient id={gradient}>
      <stop offset="0" stopColor="#fff3cf" stopOpacity=".65" />
      <stop offset=".5" stopColor="#eadfca" stopOpacity=".30" />
      <stop offset="1" stopColor="#e8e5da" stopOpacity="0" />
    </radialGradient></defs>
    {cues.map((cue, i) => <g key={i} transform={`translate(${cue.x * 15} ${cue.y * 10})`}>
      {cue.kind === "water" && Array.from({ length: 14 }, (_, n) => {
        const x = ((n * 43) % 100 - 50) * (cue.w ?? 20) * .15;
        const y = ((n * 61) % 100 - 50) * (cue.h ?? 9) * .1;
        return <path key={n} className="song-atmosphere-water" d={`M ${x} ${y} h ${12 + n % 4 * 9}`}
          style={{ "--cue-delay": `${-n * .47}s`, "--cue-duration": `${3 + n % 4}s` } as React.CSSProperties} />;
      })}
      {cue.kind === "mist" && <ellipse className="song-atmosphere-mist" rx={(cue.w ?? 24) * 7.5} ry={(cue.h ?? 6) * 5} fill={`url(#${gradient})`} />}
      {cue.kind === "lamp" && <ellipse className="song-atmosphere-lamp" rx="55" ry="65" fill={`url(#${gradient})`} />}
      {cue.kind === "smoke" && Array.from({ length: 8 }, (_, n) => <ellipse key={n} className="song-atmosphere-smoke"
        rx={13 + n % 3 * 3} ry="10" fill={`url(#${gradient})`}
        style={{ "--cue-delay": `${-n * .95}s`, "--cue-duration": `${7 + n % 3}s` } as React.CSSProperties} />)}
      {cue.kind === "dust" && Array.from({ length: 14 }, (_, n) => <circle key={n} className="song-atmosphere-dust"
        cx={((n * 47) % 100 - 50) * (cue.w ?? 18) * .15} cy={((n * 71) % 100 - 50) * (cue.h ?? 28) * .1}
        r={2 + n % 3} fill={`url(#${gradient})`} style={{ "--cue-delay": `${-n * .7}s` } as React.CSSProperties} />)}
    </g>)}
  </svg>;
}
