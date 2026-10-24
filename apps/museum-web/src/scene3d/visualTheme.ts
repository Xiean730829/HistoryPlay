/** Shared art direction for the Tang palace-inspired gallery, not a historical reconstruction. */
export const galleryVisualTheme = {
  renderer: {
    toneMappingExposure: 0.86,
    pixelRatioLimit: 1.5,
    backgroundColor: "#786c5b",
    fogColor: "#746754",
    fogDensity: 0.009,
  },
  colors: {
    lacquer: "#44372e",
    timber: "#342b23",
    plaster: "#81786b",
    stone: "#756d61",
    bronze: "#806747",
    celadon: "#55483a",
    caseGlass: "#d2ddda",
  },
  lighting: {
    ambientSky: "#b7a88d",
    ambientGround: "#393026",
    ambientIntensity: 0.78,
    daylight: "#f5c37e",
    daylightIntensity: 3.1,
    exhibit: "#ffd08b",
    exhibitIntensity: 16,
    backlight: "#e6a655",
  },
} as const;
