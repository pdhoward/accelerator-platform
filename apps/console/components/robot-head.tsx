import type { ReactNode } from "react";

/** The robot's sensor array, drawn inside the visor: how it looks tells you what the robot does. */
export type Sensor = "bar" | "lens" | "eyes" | "split" | "dots" | "slit";

const SENSORS: Record<Sensor, ReactNode> = {
  bar: <rect x="16" y="21" width="16" height="4" rx="1" />,
  lens: <circle cx="24" cy="23" r="3" />,
  eyes: (
    <>
      <rect x="16.5" y="21" width="5" height="4" rx="0.8" />
      <rect x="26.5" y="21" width="5" height="4" rx="0.8" />
    </>
  ),
  split: (
    <>
      <rect x="16" y="21" width="7" height="4" rx="0.8" />
      <rect x="25" y="21" width="7" height="4" rx="0.8" />
    </>
  ),
  dots: (
    <>
      <circle cx="18.5" cy="23" r="1.5" />
      <circle cx="24" cy="23" r="1.5" />
      <circle cx="29.5" cy="23" r="1.5" />
    </>
  ),
  slit: <rect x="16" y="22.2" width="16" height="1.6" rx="0.8" />,
};

/**
 * A sober robot head for the crew: the same chassis for every member, a
 * different sensor for each role. The frame and sensor light up in the
 * member's colour while it works; the antenna blinks.
 */
export function RobotHead({ sensor, color, busy, size = 36 }: { sensor: Sensor; color: string; busy: boolean; size?: number }) {
  const frame = busy ? color : "#6b6b78";
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden fill="none" strokeWidth={1.6} strokeLinecap="round">
      <style>{`.rh-blink { animation: rh-blink 1.2s steps(2) infinite } @keyframes rh-blink { 50% { opacity: .25 } }`}</style>
      <line x1="24" y1="6.5" x2="24" y2="11" stroke={frame} />
      <circle cx="24" cy="4.5" r="1.8" fill={busy ? color : "none"} stroke={frame} className={busy ? "rh-blink" : undefined} />
      <rect x="7" y="20" width="3" height="8" rx="1" stroke={frame} />
      <rect x="38" y="20" width="3" height="8" rx="1" stroke={frame} />
      <rect x="10" y="11" width="28" height="27" rx="5" stroke={frame} fill="#15151a" />
      <rect x="14" y="18" width="20" height="10" rx="2.5" fill="#0a0a0c" stroke={frame} strokeWidth={1} />
      <g fill={color} opacity={busy ? 1 : 0.45}>{SENSORS[sensor]}</g>
      <g stroke={frame} strokeWidth={1.2}>
        <line x1="19" y1="33" x2="19" y2="34.5" />
        <line x1="22.3" y1="33" x2="22.3" y2="34.5" />
        <line x1="25.7" y1="33" x2="25.7" y2="34.5" />
        <line x1="29" y1="33" x2="29" y2="34.5" />
      </g>
      <line x1="18" y1="38" x2="18" y2="42" stroke={frame} />
      <line x1="30" y1="38" x2="30" y2="42" stroke={frame} />
      <line x1="14" y1="43" x2="34" y2="43" stroke={frame} />
    </svg>
  );
}
