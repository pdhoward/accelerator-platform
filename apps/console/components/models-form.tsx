"use client";

import { useState } from "react";
import { canBuildWith, MODEL_CATALOG, MODEL_ROLES, PROVIDER_LABEL, ROLE_LABEL, validateModels, type ModelRole, type Provider, type SiteModel } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { inputClass } from "./action-form";
import { button, Card, CardBody, CardHead } from "./ui";
import { useUi } from "./ui-provider";

/** The model for each job (flywheel.md F15). The customer may have a contract with one provider. */
export function ModelsForm({ siteId, initial, canManage }: { siteId: string; initial: Record<ModelRole, SiteModel>; canManage: boolean }) {
  const [models, setModels] = useState(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const problems = validateModels(Object.values(models));

  const set = (role: ModelRole, patch: Partial<SiteModel>) =>
    setModels((m) => {
      const next = { ...m[role], ...patch };
      // Switching provider picks that provider's first suggested model.
      if (patch.provider && patch.provider !== m[role].provider) next.model = MODEL_CATALOG.find((c) => c.provider === patch.provider)?.model ?? "";
      return { ...m, [role]: next };
    });

  async function save() {
    setBusy(true);
    try {
      setModels(await browserApi().models.save(siteId, Object.values(models)));
      toast("Models saved. New jobs use them.");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title="Models" hint="Pick the model for each job. Claude at launch for building; any provider for thinking." />
      <CardBody className="flex flex-col gap-3">
        {MODEL_ROLES.map((role) => {
          const m = models[role];
          const suggestions = MODEL_CATALOG.filter((c) => c.provider === m.provider);
          return (
            <div key={role} className="grid items-center gap-2 md:grid-cols-[1.4fr_1fr_1.6fr_1fr]">
              <span className="text-[13.5px]">{ROLE_LABEL[role]}</span>
              <select
                aria-label={`${ROLE_LABEL[role]} provider`}
                value={m.provider}
                disabled={!canManage}
                onChange={(e) => set(role, { provider: e.target.value as Provider })}
                className={inputClass}
              >
                {(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => (
                  <option key={p} value={p} disabled={role === "build" && !canBuildWith(p)}>
                    {PROVIDER_LABEL[p]}
                    {role === "build" && !canBuildWith(p) ? " (builder coming)" : ""}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${ROLE_LABEL[role]} model`}
                list={`models-${role}`}
                value={m.model}
                disabled={!canManage}
                onChange={(e) => set(role, { model: e.target.value })}
                className={inputClass}
              />
              <datalist id={`models-${role}`}>
                {suggestions.map((c) => (
                  <option key={c.model} value={c.model}>
                    {c.label}
                  </option>
                ))}
              </datalist>
              <select aria-label={`${ROLE_LABEL[role]} key`} value={m.keySource} disabled={!canManage} onChange={(e) => set(role, { keySource: e.target.value as SiteModel["keySource"] })} className={inputClass}>
                <option value="ours">Our key (metered)</option>
                <option value="customer">Customer&apos;s contract</option>
              </select>
            </div>
          );
        })}
        {problems.length > 0 && <p className="text-[12.5px] text-bad">{problems.join(" ")}</p>}
        {canManage && (
          <button type="button" className={button("gold", "self-start")} disabled={busy || problems.length > 0} onClick={save}>
            {busy ? "Saving…" : "Save models"}
          </button>
        )}
      </CardBody>
    </Card>
  );
}
