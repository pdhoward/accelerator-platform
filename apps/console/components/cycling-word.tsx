"use client";

import { useEffect, useState } from "react";

/**
 * "You [manage] your website." The verb cycles through `words`. The slot is
 * as wide as the longest word, so the line never reflows. Screen readers and
 * reduced-motion visitors get the first word only.
 */
export function CyclingWord({ words, interval = 2000, wordClassName }: { words: readonly string[]; interval?: number; wordClassName?: string }) {
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setAt((n) => (n + 1) % words.length), interval);
    return () => clearInterval(t);
  }, [words.length, interval]);

  return (
    <span className="inline-grid align-bottom">
      <span className="sr-only">{words[0]}</span>
      {words.map((w, n) => {
        const prev = (at - 1 + words.length) % words.length;
        return (
          <span
            key={w}
            aria-hidden
            className={`[grid-area:1/1] text-center transition-[opacity,transform] duration-500 ease-out ${wordClassName ?? ""}`}
            style={{
              opacity: n === at ? 1 : 0,
              transform: n === at ? "translateY(0)" : n === prev ? "translateY(-0.3em)" : "translateY(0.3em)",
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
}
