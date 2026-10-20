"use client";

import { useState } from "react";
import { MANDATE_FORM, type FormValues, type MandateBody, type WorkDetail } from "@accelerator/domain";
import { FileSignature } from "lucide-react";

import { browserApi } from "@/lib/browser-api";
import { FormRenderer } from "../form-renderer";
import { button, Chip, cx } from "../ui";
import { useUi } from "../ui-provider";
import { DocDrawer } from "./work-sidebar";

/**
 * The Work item's mandate in the side bar (gen2-crew.md §10.1): what the crew
 * is authorized to do, its budget and the capabilities the work touched.
 * Setting or revising it is the account's own decision; a material revision
 * voids the approvals made on the old terms, and the card says so.
 */
export function MandateCard({ siteId, d, canEdit, onSaved }: { siteId: string; d: WorkDetail; canEdit: boolean; onSaved: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MandateBody | null>(null);
  const { toast } = useUi();
  const m = d.mandate ?? null;
  const b = d.budget ?? null;

  async function start() {
    setOpen(true);
    if (!m) {
      try {
        setDraft((await browserApi().work.mandate.get(siteId, d.work.number)).draft);
      } catch {
        setDraft(null);
      }
    }
  }

  async function save(values: FormValues) {
    try {
      const saved = await browserApi().work.mandate.save(siteId, d.work.number, values);
      toast(m ? `Mandate v${saved.version} saved. Approvals made on the old terms were voided where they had to be.` : "Mandate v1 saved. Every run reads it from now on.");
      setOpen(false);
      await onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the mandate.");
    }
  }

  const pct = b?.limit ? Math.min(100, Math.round((b.spent / b.limit) * 100)) : null;
  return (
    <section aria-label="Mandate" data-mandate className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <FileSignature className="size-4 text-violet" aria-hidden />
        <h2 className="text-[13px] font-semibold">Mandate</h2>
        {m ? <Chip tone="violet">v{m.version}</Chip> : <Chip>not set</Chip>}
        {canEdit && (
          <button type="button" className={button("ghost", "ml-auto px-2 py-1 text-[12px]")} onClick={start}>
            {m ? "Revise" : "Set it"}
          </button>
        )}
      </div>
      {m ? (
        <div className="mt-2.5 flex flex-col gap-2 text-[12.5px] leading-snug text-fog">
          <p className="text-ink">{m.outcome}</p>
          {m.acceptance.length > 0 && (
            <ul className="list-disc pl-4">
              {m.acceptance.slice(0, 3).map((a) => <li key={a}>{a}</li>)}
              {m.acceptance.length > 3 && <li className="list-none text-mist">+{m.acceptance.length - 3} more</li>}
            </ul>
          )}
          {m.protected.length > 0 && <p className="text-mist">Protected: {m.protected.join("; ")}</p>}
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-mist">
          {canEdit ? "Set the outcome, the acceptance criteria and a budget. Every run reads it." : "The account's people set the mandate."}
        </p>
      )}
      {b && (b.limit != null || b.spent > 0) && (
        <div className="mt-3" data-budget>
          <div className="flex justify-between text-[11.5px] text-mist">
            <span>Model spend</span>
            <span className={cx(b.over ? "text-bad" : b.near ? "text-warn" : undefined)}>
              ${b.spent.toFixed(2)}{b.limit != null ? ` of $${b.limit.toFixed(2)}` : ""}
            </span>
          </div>
          {pct != null && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" role="img" aria-label={`${pct}% of the budget used`}>
              <div className={cx("h-full rounded-full", b.over ? "bg-bad" : b.near ? "bg-warn" : "bg-violet")} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {!!d.capabilities?.length && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Capabilities this work touches">
          {d.capabilities.map((c) => <Chip key={c.id} tone="cyan">{c.name}</Chip>)}
        </div>
      )}
      {open && (
        <DocDrawer title={m ? `Revise the mandate (now v${m.version})` : "Set the mandate"} onClose={() => setOpen(false)}>
          <FormRenderer spec={MANDATE_FORM} initial={(m ?? draft) as FormValues | null} onSubmit={save} onCancel={() => setOpen(false)} submitLabel={m ? `Save as v${m.version + 1}` : undefined} />
        </DocDrawer>
      )}
    </section>
  );
}
