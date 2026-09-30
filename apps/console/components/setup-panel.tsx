"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleDashed, Clock, Loader2, MessagesSquare, OctagonAlert, Play, Wifi, WifiOff } from "lucide-react";
import { SETUP_OWNER_LABEL, type Job, type JobEvent, type SetupItem, type SetupStatus, type SiteSetup } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { Field, inputClass } from "./action-form";
import { Markdown } from "./flywheel";
import { button, Card, CardBody, CardHead, Chip, cx } from "./ui";
import { useUi } from "./ui-provider";

type Setup = SiteSetup & { checkout: { job: Job; events: JobEvent[] } | null };

const STATUS: Record<SetupStatus, { icon: typeof CircleCheck; cls: string; label: string }> = {
  todo: { icon: CircleDashed, cls: "text-mist", label: "To do" },
  waiting: { icon: Clock, cls: "text-warn", label: "Waiting" },
  done: { icon: CircleCheck, cls: "text-good", label: "Done" },
  failed: { icon: OctagonAlert, cls: "text-bad", label: "Failed" },
  not_needed: { icon: CircleCheck, cls: "text-mist", label: "Not needed" },
};

const OWNER_TONE = { strategic_machines: "violet", engine: "gold", client: "cyan" } as const;

/** Install (people) · Checkout (the engine proves it) · Agreement (the Navigator signs). */
export function SetupPanel({ siteId, initial, canManage }: { siteId: string; initial: Setup; canManage: boolean }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const router = useRouter();
  const api = browserApi();
  const checking = !!s.checkout && (s.checkout.job.status === "queued" || s.checkout.job.status === "running");

  const refresh = useCallback(async () => {
    try {
      setS(await browserApi().setup.get(siteId));
    } catch {}
  }, [siteId]);
  useEffect(() => {
    const t = setInterval(refresh, checking ? 2500 : 15000);
    return () => clearInterval(t);
  }, [refresh, checking]);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const install = s.items.filter((i) => i.phase === "install");
  const checkout = s.items.filter((i) => i.phase === "checkout");
  const count = (list: SetupItem[]) => `${list.filter((i) => i.status === "done" || i.status === "not_needed").length}/${list.length}`;

  return (
    <>
      <div className={cx("flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3", s.ready ? "border-good/35 bg-good/[0.07]" : "border-gold/35 bg-gold/[0.07]")}>
        <p className="flex-1 text-[13.5px]">
          {s.ready ? (
            <span className="font-semibold text-good">Ready: the flywheel can turn.</span>
          ) : (
            <>
              <span className="font-semibold text-gold-2">Setting up · </span>Install {count(install)} · Checkout {count(checkout)} · Agreement {s.agreement?.signedAt ? "signed" : "not signed"}
            </>
          )}
        </p>
        {canManage && (
          <button
            type="button"
            className={button("plain", "text-xs")}
            disabled={busy}
            onClick={() =>
              act(async () => {
                const { number } = await api.setup.conversation(siteId);
                router.push(`/s/${siteId}/work/${number}`);
              })
            }
          >
            <MessagesSquare className="size-3.5" /> Talk to the engine about this installation
          </button>
        )}
        {s.runnerOnline ? (
          <Chip tone="good">
            <Wifi className="size-3" /> Engine online
          </Chip>
        ) : (
          <Chip tone="warn">
            <WifiOff className="size-3" /> Engine offline
          </Chip>
        )}
      </div>

      <Card>
        <CardHead title="Where the engine works" hint="Strategic Machines sets these at installation" />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act(
                () => api.setup.settings(siteId, { repo: String(f.get("repo") ?? ""), repoPath: String(f.get("repoPath") ?? ""), baseBranch: String(f.get("baseBranch") ?? "stage"), stageUrl: String(f.get("stageUrl") ?? "") }),
                "Saved.",
              );
            }}
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1.6fr_0.7fr_1.4fr_auto] xl:items-end"
          >
            <Field label="GitHub repository (owner/name)">
              <input name="repo" defaultValue={s.settings.repo ?? ""} disabled={!canManage} placeholder="pdhoward/machineshop" className={inputClass} />
            </Field>
            <Field label="Local working copy (for the runner)">
              <input name="repoPath" defaultValue={s.settings.repoPath ?? ""} disabled={!canManage} placeholder="C:\Users\you\Desktop\machine\machineshop" className={inputClass} />
            </Field>
            <Field label="Base branch">
              <input name="baseBranch" defaultValue={s.settings.baseBranch} disabled={!canManage} className={inputClass} />
            </Field>
            <Field label="Staging URL">
              <input name="stageUrl" type="url" defaultValue={s.settings.stageUrl ?? ""} disabled={!canManage} placeholder="https://stage.example.com" className={inputClass} />
            </Field>
            {canManage && (
              <button type="submit" className={button("plain")} disabled={busy}>
                Save
              </button>
            )}
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHead title={`1 · Install (${count(install)})`} hint="People do these; mark each when it's true" />
        <CardBody className="flex flex-col divide-y divide-line">
          {install.map((i) => (
            <ItemRow key={i.code} item={i}>
              {canManage && (
                <select
                  aria-label={`Status of ${i.code}`}
                  value={i.status}
                  disabled={busy}
                  onChange={(e) => act(() => api.setup.item(siteId, i.code, e.target.value as SetupStatus))}
                  className="rounded-lg border border-line-2 bg-panel px-2 py-1 text-[12.5px]"
                >
                  {(Object.keys(STATUS) as SetupStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {STATUS[st].label}
                    </option>
                  ))}
                </select>
              )}
            </ItemRow>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHead title={`2 · Checkout (${count(checkout)})`} hint="The engine proves each item, with evidence">
          {canManage && (
            <button type="button" className={button("gold", "text-xs")} disabled={busy || checking || !s.runnerOnline} onClick={() => act(() => api.setup.checkout(siteId), "Checkout started.")}>
              {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} {checking ? "Checking…" : "Run checkout"}
            </button>
          )}
        </CardHead>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-col divide-y divide-line">
            {checkout.map((i) => (
              <ItemRow key={i.code} item={i} />
            ))}
          </div>
          {s.checkout && s.checkout.events.length > 0 && (
            <details open={checking} className="rounded-xl border border-line bg-bg/60 p-3">
              <summary className="cursor-pointer text-[12.5px] text-fog">Checkout log ({s.checkout.job.status})</summary>
              <div className="mt-2 max-h-80 overflow-y-auto font-mono text-[12px] leading-relaxed">
                {s.checkout.events.map((e) => (
                  <p key={e.id} className={cx("whitespace-pre-wrap", e.kind === "check" ? "text-gold-2" : e.kind === "tool" ? "text-cyan" : e.kind === "status" ? "text-mist" : "text-ink")}>
                    {e.text}
                  </p>
                ))}
              </div>
            </details>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="3 · Working agreement" hint={s.agreement?.signedAt ? `Signed ${new Date(s.agreement.signedAt).toLocaleDateString()}` : "The Navigator signs it once; a new version any time"} />
        <CardBody className="flex flex-col gap-3">
          <article className="rounded-xl border border-line bg-panel-2/40 p-4">
            <Markdown>{s.agreement?.body ?? ""}</Markdown>
          </article>
          {canManage && s.agreement && (
            <button type="button" className={button(s.agreement.signedAt ? "plain" : "gold", "self-start")} disabled={busy} onClick={() => act(() => api.setup.sign(siteId, s.agreement!.body), "Agreement signed.")}>
              <CircleCheck className="size-4" /> {s.agreement.signedAt ? "Sign again (new version)" : "I agree: sign as Navigator"}
            </button>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function ItemRow({ item, children }: { item: SetupItem; children?: React.ReactNode }) {
  const st = STATUS[item.status];
  const Icon = st.icon;
  return (
    <div className="flex flex-wrap items-start gap-3 py-2.5">
      <Icon className={cx("mt-0.5 size-4 shrink-0", st.cls)} aria-label={st.label} />
      <span className="w-7 font-mono text-[12px] text-mist">{item.code}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px]">{item.title}</p>
        {item.note && <p className="text-[12.5px] text-fog">{item.note}</p>}
      </div>
      <Chip tone={OWNER_TONE[item.owner]}>{SETUP_OWNER_LABEL[item.owner]}</Chip>
      {children}
    </div>
  );
}
