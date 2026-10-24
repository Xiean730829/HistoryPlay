export interface CameraPose {
  yaw: number;
  pitch: number;
  zoom: number;
}

const PRESET_YAW: Record<string, number> = {
  "front-upright": 0,
  "inscription-face": 0,
  "three-quarter": 35,
};

export function cameraOrbit(pose?: CameraPose, preset?: string): string {
  const baseYaw = PRESET_YAW[preset ?? ""] ?? 0;
  const yaw = normalizeDegrees(baseYaw + finiteOr(pose?.yaw, 0));
  const pitch = clamp(finiteOr(pose?.pitch, 0), -80, 80);
  const zoom = clamp(finiteOr(pose?.zoom, 1), 0.25, 8);
  const polar = clamp(90 - pitch, 10, 170);
  return `${yaw}deg ${polar}deg ${100 / zoom}%`;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDegrees(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}
