/**
 * The Cockpit Dial's geometry: angles in degrees, 0 at twelve o'clock,
 * increasing clockwise. Pure functions, shared by the dial and its tests.
 */

export type Point = { x: number; y: number };

/** Rounded to 1/100 so server and browser render identical SVG (no hydration drift from Math.sin). */
const r2 = (v: number) => Math.round(v * 100) / 100;

export const polar = (c: number, r: number, deg: number): Point => {
  const rad = (deg * Math.PI) / 180;
  return { x: r2(c + r * Math.sin(rad)), y: r2(c - r * Math.cos(rad)) };
};

/** An SVG arc path from `a0` to `a1` (clockwise) on a circle of radius r around (c, c). */
export function arcPath(c: number, r: number, a0: number, a1: number): string {
  const p0 = polar(c, r, a0);
  const p1 = polar(c, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** The angle of a pointer around the centre of an element, 0 at the top, clockwise. */
export function pointerAngle(e: { clientX: number; clientY: number }, rect: DOMRect): number {
  const x = e.clientX - (rect.left + rect.width / 2);
  const y = e.clientY - (rect.top + rect.height / 2);
  return (Math.atan2(x, -y) * 180) / Math.PI;
}

/** The shortest signed difference b − a, in (−180, 180]. */
export const angleDelta = (a: number, b: number) => {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

export const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Where a turned dial settles: the segment nearest the top after the ring's
 * rotation (the selected segment sits at the top when rotation = −index·step).
 */
export const settle = (rotation: number, n: number) => wrap(Math.round(-rotation / (360 / n)), n);

/** The segment under a pointer at `angle`, given the ring's current rotation. */
export const segmentAt = (angle: number, rotation: number, n: number) => wrap(Math.round((angle - rotation) / (360 / n)), n);
