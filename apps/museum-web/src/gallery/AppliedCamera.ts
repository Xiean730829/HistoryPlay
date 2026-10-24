export interface ActualOrbit { theta: number; phi: number; radius: number }

/** Keeps the loaded model's distance scale and rejects an old interpolating camera. */
export class AppliedCamera {
  private unitRadius: number | null = null;

  matches(target: string, actual: ActualOrbit): boolean {
    const parts = /^(-?[\d.]+)deg ([\d.]+)deg ([\d.]+)%$/.exec(target);
    if (!parts || ![actual.theta, actual.phi, actual.radius].every(Number.isFinite)
      || actual.radius <= 0) return false;
    const [, yaw, polar, percent] = parts.map(Number);
    const radians = Math.PI / 180;
    const delta = Math.atan2(Math.sin(actual.theta - yaw * radians), Math.cos(actual.theta - yaw * radians));
    if (Math.abs(delta) > 0.01 || Math.abs(actual.phi - polar * radians) > 0.01 || percent <= 0) return false;
    this.unitRadius ??= actual.radius / percent;
    const expected = this.unitRadius * percent;
    return Math.abs(actual.radius - expected) <= Math.max(0.001, expected * 0.015);
  }
}
