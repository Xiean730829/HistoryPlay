/** Shared art direction for the Tang palace-inspired gallery, not a historical reconstruction. */
export const galleryVisualTheme = {
  renderer: {
    toneMappingExposure: 0.78,
    pixelRatioLimit: 1.5,
    backgroundColor: "#786c5b",
    fogColor: "#746754",
    fogDensity: 0.009,
  },
  colors: {
    lacquer: "#35281e",
    timber: "#29221b",
    plaster: "#554c41",
    stone: "#5a5145",
    bronze: "#6b4e2d",
    celadon: "#4b4033",
    caseGlass: "#bec8c4",
  },
  lighting: {
    ambientSky: "#887458",
    ambientGround: "#211a14",
    ambientIntensity: 0.5,
    daylight: "#e6a95a",
    daylightIntensity: 1.8,
    exhibit: "#ffd08b",
    exhibitIntensity: 9,
    backlight: "#e6a655",
  },
} as const;
