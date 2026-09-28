"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Change } from "@accelerator/domain";

import { browserApi } from "@/lib/api";
import { button, Card, CardBody, CardHead } from "./ui";
import { useUi } from "./ui-provider";

/**
 * The human's "Try" step: a checklist written in the domain's language.
 * Approve unlocks only when every step is ticked; the API then applies the
 * gate policy and reports anything still blocking.
 */
export function TryPanel({ siteId, change }: { siteId: string; change: Change }) {
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const router = useRouter();
  const done = checked.length === change.checklist.length;
  const approved = change.stage === "ship";

  async function approve() {
    setBusy(true);
    try {
      const { blockers } = await browserApi().changes.approve(siteId, change.id, { checked });
      toast(blockers.length ? `Approved, but still blocked: ${blockers[0]}` : `Approved. #${change.requestNumber} moves to Ship. Go live is a separate step, with undo.`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't approve. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHead title="Try it" hint={approved ? "Approved" : "About 3 minutes"} />
        <CardBody className="flex flex-col gap-2">
          {change.checklist.map((step) => (
            <label key={step.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-[13px]">
              <input
                type="checkbox"
                id={`check-${step.id}`}
                className="mt-0.5 accent-violet"
                disabled={approved}
                checked={approved || checked.includes(step.id)}
                onChange={(e) => setChecked((c) => (e.target.checked ? [...c, step.id] : c.filter((x) => x !== step.id)))}
              />
              {step.text}
            </label>
          ))}
        </CardBody>
      </Card>
      <div className="flex flex-col gap-2">
        <button type="button" className={button("plain")} onClick={() => toast(`The preview opens in a new tab: ${change.engineer.preview}`)}>
          Open preview
        </button>
        <div className="flex gap-2">
          <button type="button" className={button("plain", "flex-1")} onClick={() => toast("Sent back. Add a note or screenshot so the engine knows what to fix.")}>
            Send back
          </button>
          <button type="button" className={button("gold", "flex-1")} disabled={!done || busy || approved} onClick={approve}>
            {approved ? "Approved" : busy ? "Approving…" : "Approve"}
          </button>
        </div>
        <span className="text-xs text-mist">
          {approved
            ? "Waiting for Go live on the Bridge."
            : done
              ? "All checked. Approving moves it to Ship; going live still has undo."
              : `Tick the checklist to approve (${checked.length} of ${change.checklist.length}).`}
        </span>
      </div>
    </>
  );
}
