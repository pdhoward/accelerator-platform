"use client";

import { useState } from "react";

import { browserApi } from "@/lib/api";
import { cx } from "./ui";
import { useUi } from "./ui-provider";

export function SkillToggle({ siteId, skillId, name, enabled }: { siteId: string; skillId: string; name: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const { toast } = useUi();

  async function flip() {
    const next = !on;
    setOn(next);
    try {
      await browserApi().skills.toggle(siteId, skillId, next);
      toast(`${name} ${next ? "enabled" : "disabled"} for this site.`);
    } catch (err) {
      setOn(!next);
      toast(err instanceof Error ? err.message : "Couldn't change the skill.");
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${name} ${on ? "enabled" : "disabled"}`}
      onClick={flip}
      className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-violet" : "bg-line-2")}
    >
      <span className={cx("absolute left-0 top-[3px] size-3.5 rounded-full bg-white transition-transform", on ? "translate-x-[18px]" : "translate-x-[3px]")} />
    </button>
  );
}
