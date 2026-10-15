/** The existing Strategic Machines mark, served locally without an image-host dependency. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size mark; no optimizer config needed
    <img
      src="/brand/strategic-machines.png"
      width={size}
      height={size}
      alt=""
      className="shrink-0 rounded-lg"
    />
  );
}
