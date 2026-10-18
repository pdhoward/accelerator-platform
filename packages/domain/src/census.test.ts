import { describe, expect, it } from "vitest";

import { census, isCensusSource, readCensus } from "./census";

const files = [
  {
    path: "app/page.tsx",
    text: `import { Card } from "./card";
// function Ignored() {} in a comment doesn't count
export default function Home() {
  const label = "function NotReal() {}";
  if (items.length && ready) return <Card />;
  return null;
}
const Banner = ({ title }: { title: string }) => <h1>{title}</h1>;
`,
  },
  {
    path: "lib/rules.ts",
    text: `export function price(q: number) {
  if (q > 10) return 9;
  for (const x of xs) { if (x ?? 0) continue; }
  switch (q) { case 1: return 1; case 2: return 2; }
  return q || 1;
}
export const round = (v: number): number => Math.round(v);
const helper = async (a, b) => a;
`,
  },
  { path: "app/api/quote/route.ts", text: `export async function POST(req: Request) {\n  return Response.json({});\n}\n` },
  { path: "lib/rules.test.ts", text: `import { price } from "./rules";\nit("prices", () => { if (x) expect(price(1)).toBe(1); });\n` },
  { path: "node_modules/react/index.js", text: "function huge() {}" },
  { path: ".next/server/page.js", text: "function built() {}" },
  { path: "types/global.d.ts", text: "declare function g(): void;" },
  { path: "README.md", text: "# Read me" },
];

describe("isCensusSource", () => {
  it("counts tracked source, never dependencies, build output, declarations or docs", () => {
    expect(isCensusSource("app/page.tsx")).toBe(true);
    expect(isCensusSource("lib\\rules.ts")).toBe(true);
    expect(isCensusSource("node_modules/react/index.js")).toBe(false);
    expect(isCensusSource(".next/server/page.js")).toBe(false);
    expect(isCensusSource("types/global.d.ts")).toBe(false);
    expect(isCensusSource("public/vendor.min.js")).toBe(false);
    expect(isCensusSource("README.md")).toBe(false);
  });
});

describe("census", () => {
  const c = census(files);
  it("counts files, lines, routes and test files", () => {
    expect(c.files).toBe(4);
    expect(c.routes).toBe(2); // app/page.tsx and app/api/quote/route.ts
    expect(c.tests).toBe(1);
    expect(c.lines).toBe(8 + 8 + 3 + 2);
  });
  it("counts named functions and components outside tests, ignoring comments and strings", () => {
    // Home, Banner (arrow), price, round, helper, POST
    expect(c.functions).toBe(6);
    // Home and Banner in the .tsx file
    expect(c.components).toBe(2);
  });
  it("ranks files by branch points", () => {
    // if, for, if, ??, case, case, ||
    expect(c.hotspots[0]).toEqual({ path: "lib/rules.ts", branches: 7, lines: 8 });
    expect(c.hotspots.map((h) => h.path)).toEqual(["lib/rules.ts", "app/page.tsx"]);
  });
  it("is empty, not invented, for a repository with no source", () => {
    expect(census([{ path: "README.md", text: "hi" }])).toEqual({ files: 0, lines: 0, functions: 0, components: 0, routes: 0, tests: 0, hotspots: [] });
  });
});

describe("readCensus", () => {
  it("reads a recorded census back and rejects anything malformed", () => {
    const c = census(files);
    expect(readCensus(JSON.parse(JSON.stringify(c)))).toEqual(c);
    expect(readCensus({ files: 3 })).toBeNull();
    expect(readCensus({ ...c, lines: "many" })).toBeNull();
  });
});
