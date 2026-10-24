/** Shared art direction for the Tang palace-inspired gallery, not a historical reconstruction. */
export const galleryVisualTheme = {
  renderer: {
    toneMappingExposure: 0.92,
    pixelRatioLimit: 1.5,
    fogColor: "#a99b83",
    fogDensity: 0.007,
  },
  colors: {
    lacquer: "#593932",
    timber: "#3e3127",
    plaster: "#c9bda6",
    stone: "#968d7c",
    bronze: "#88714b",
    celadon: "#40534b",
    caseGlass: "#d5e1df",
  },
  lighting: {
    ambientSky: "#d9e0df",
    ambientGround: "#66513b",
    ambientIntensity: 1.25,
    daylight: "#ffe0b0",
    daylightIntensity: 2.2,
    exhibit: "#ffdda0",
    exhibitIntensity: 13,
  },
} as const;
