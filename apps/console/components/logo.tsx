/**
 * The Strategic Machines mark (same Cloudinary master as the marketing site),
 * resized by URL at 3x the rendered size.
 */
const MASTER = "https://res.cloudinary.com/stratmachine/image/upload/w_{s},h_{s},c_fit,f_auto,q_auto/v1592332363/machine/icon-512x512_zaffp5.png";

export function Logo({ size = 28 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size mark; no optimizer config needed
    <img src={MASTER.replaceAll("{s}", String(size * 3))} width={size} height={size} alt="" className="shrink-0 rounded-lg" />
  );
}
