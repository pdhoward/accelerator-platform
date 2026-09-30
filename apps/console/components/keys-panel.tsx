"use client";

import { useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { ENGINE_KEYS, type EnvVarSpec, type SecretStatus, type VaultEnv } from "@accelerator/domain";

import { browserApi } from "@/lib/browser-api";

import { inputClass } from "./action-form";
import { button, Card, CardBody, CardHead, Chip, cx } from "./ui";
import { useUi } from "./ui-provider";

type Row = { key: string; purpose: string; howToGet: string };

/**
 * The keys vault on screen. Values go in through a password field, are
 * encrypted by the API, and never come back: you see set/unset and ••••last4.
 * Production keys stay in Vercel.
 */
export function KeysPanel({ siteId, manifest, initial, canManage }: { siteId: string; manifest: EnvVarSpec[]; initial: SecretStatus[]; canManage: boolean }) {
  const [status, setStatus] = useState(initial);
  const [extra, setExtra] = useState<string[]>([]);
  const { toast } = useUi();

  const known = new Set(manifest.map((m) => m.key));
  const siteKeys: Row[] = [
    ...manifest.map((m) => ({ key: m.key, purpose: m.purpose, howToGet: m.howToGet })),
    // Keys set in the vault that .env.example doesn't list, plus ones added here.
    ...[...new Set([...status.filter((s) => s.environment !== "engine").map((s) => s.name), ...extra])]
      .filter((k) => !known.has(k))
      .map((k) => ({ key: k, purpose: "Added here (not in .env.example)", howToGet: "" })),
  ];

  async function save(environment: VaultEnv, name: string, value: string | null) {
    try {
      setStatus(await browserApi().vault.set(siteId, environment, name, value));
      toast(value === null ? `${name} removed from ${environment}.` : `${name} saved for ${environment}, encrypted.`);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save.");
      return false;
    }
  }

  const cell = (environment: VaultEnv, name: string) => status.find((s) => s.environment === environment && s.name === name);

  return (
    <>
      <Card>
        <CardHead title="Site keys" hint={manifest.length ? `${manifest.length} keys from the site's .env.example (read at checkout)` : "Run checkout on the Setup page to read the site's .env.example"} />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-mist">
                <th className="px-2.5 py-2.5 font-medium">Key</th>
                <th className="px-2.5 py-2.5 font-medium">Development</th>
                <th className="px-2.5 py-2.5 font-medium">Preview</th>
                <th className="px-2.5 py-2.5 font-medium">Production</th>
              </tr>
            </thead>
            <tbody>
              {siteKeys.map((r) => (
                <tr key={r.key} className="border-b border-line align-top last:border-0">
                  <td className="px-2.5 py-3">
                    <div className="font-mono text-[12.5px]">{r.key}</div>
                    {r.purpose && <div className="text-[12px] text-fog">{r.purpose}</div>}
                    {r.howToGet && <div className="text-[11.5px] text-mist">Where: {r.howToGet}</div>}
                  </td>
                  {(["development", "preview"] as const).map((env) => (
                    <td key={env} className="px-2.5 py-3">
                      <Slot state={cell(env, r.key)} canManage={canManage} onSave={(v) => save(env, r.key, v)} />
                    </td>
                  ))}
                  <td className="px-2.5 py-3 text-[12px] text-mist">In Vercel only</td>
                </tr>
              ))}
              {!siteKeys.length && (
                <tr>
                  <td colSpan={4} className="px-2.5 py-4 text-mist">
                    No keys listed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {canManage && <AddKey onAdd={(k) => setExtra((e) => [...e, k])} />}
        </CardBody>
      </Card>

      <Card>
        <CardHead title="Engine keys" hint="What the Accelerator itself needs to work on this site" />
        <CardBody className="flex flex-col divide-y divide-line">
          {ENGINE_KEYS.map((k) => (
            <div key={k.name} className="flex flex-wrap items-start gap-3 py-3">
              <KeyRound className="mt-0.5 size-4 text-gold-2" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px]">{k.name}</div>
                <div className="text-[12px] text-fog">{k.purpose}</div>
                <div className="text-[11.5px] text-mist">Where: {k.howToGet}</div>
              </div>
              <Slot state={cell("engine", k.name)} canManage={canManage} onSave={(v) => save("engine", k.name, v)} />
            </div>
          ))}
        </CardBody>
      </Card>
    </>
  );
}

/** One key in one environment: shows ••••last4 or "Not set"; edits through a password field. */
function Slot({ state, canManage, onSave }: { state?: SecretStatus; canManage: boolean; onSave: (value: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <form
        className="flex min-w-[220px] items-center gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          if (await onSave(value)) {
            setEditing(false);
            setValue("");
          }
          setBusy(false);
        }}
      >
        <input type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" placeholder="Paste the value" className={cx(inputClass, "py-1.5 text-[12.5px]")} />
        <button type="submit" className={button("gold", "text-xs")} disabled={busy || !value.trim()}>
          Save
        </button>
        <button type="button" className={button("ghost", "text-xs")} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state ? <Chip tone="good" className="font-mono">{state.last4}</Chip> : <Chip tone="warn">Not set</Chip>}
      {canManage && (
        <>
          <button type="button" className="text-[12px] text-cyan hover:underline" onClick={() => setEditing(true)}>
            {state ? "Change" : "Set"}
          </button>
          {state && (
            <button type="button" className="text-[12px] text-mist hover:text-bad" onClick={() => void onSave(null)}>
              Remove
            </button>
          )}
        </>
      )}
    </div>
  );
}

function AddKey({ onAdd }: { onAdd: (key: string) => void }) {
  const [name, setName] = useState("");
  const valid = /^[A-Z][A-Z0-9_]*$/.test(name);
  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name);
        setName("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="NEW_KEY_NAME" className={cx(inputClass, "max-w-xs font-mono text-[12.5px]")} aria-label="New key name" />
      <button type="submit" className={button("plain", "text-xs")} disabled={!valid}>
        <Plus className="size-3.5" /> Add a key
      </button>
      <span className="text-[12px] text-mist">Better: add it to the site&apos;s .env.example, so the engine knows about it too.</span>
    </form>
  );
}
