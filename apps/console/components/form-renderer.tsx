"use client";

import { useState } from "react";
import { formErrors, readForm, type FormField, type FormSpec, type FormValues } from "@accelerator/domain";

import { inputClass } from "./action-form";
import { button, cx } from "./ui";

/**
 * One renderer for every FormSpec (gen2-crew.md §9.5): the platform or an
 * agent fills a spec; it never writes UI code. The same spec validates here
 * and again in the API.
 */
export function FormRenderer({
  spec,
  initial,
  onSubmit,
  onCancel,
  disabled,
  submitLabel,
}: {
  spec: FormSpec;
  initial?: FormValues | null;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
  submitLabel?: string;
}) {
  const [raw, setRaw] = useState<Record<string, string>>(() => toRaw(spec, initial ?? {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = readForm(spec, raw);
    const found = formErrors(spec, values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSubmit(values);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-form={spec.id} noValidate>
      {spec.intro && <p className="text-[13px] leading-relaxed text-fog">{spec.intro}</p>}
      {spec.fields.map((f) => (
        <FieldControl key={f.name} field={f} value={raw[f.name] ?? ""} error={errors[f.name]} disabled={disabled || busy} onChange={(v) => setRaw((r) => ({ ...r, [f.name]: v }))} />
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={button("gold")} disabled={disabled || busy}>
          {busy ? "Saving…" : (submitLabel ?? spec.submit)}
        </button>
        {onCancel && (
          <button type="button" className={button("ghost")} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function toRaw(spec: FormSpec, v: FormValues): Record<string, string> {
  return Object.fromEntries(spec.fields.map((f) => {
    const x = v[f.name];
    return [f.name, Array.isArray(x) ? x.join("\n") : x == null ? "" : String(x)];
  }));
}

function FieldControl({ field: f, value, error, disabled, onChange }: { field: FormField; value: string; error?: string; disabled: boolean; onChange: (v: string) => void }) {
  const id = `f-${f.name}`;
  const described = error ? `${id}-error` : f.hint ? `${id}-hint` : undefined;
  const common = { id, name: f.name, disabled, "aria-invalid": !!error, "aria-describedby": described, className: cx(inputClass, error && "border-bad") };
  let control: React.ReactNode;
  switch (f.kind) {
    case "textarea":
      control = <textarea {...common} rows={f.rows ?? 3} value={value} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} className={cx(common.className, "resize-y")} />;
      break;
    case "list":
      control = <textarea {...common} rows={Math.max(2, Math.min(8, value.split("\n").length + 1))} value={value} placeholder={f.placeholder ?? "One per line"} onChange={(e) => onChange(e.target.value)} className={cx(common.className, "resize-y")} />;
      break;
    case "number":
      control = (
        <div className="flex items-center gap-2">
          {f.prefix && <span className="text-[13px] text-mist">{f.prefix}</span>}
          <input {...common} type="number" inputMode="decimal" min={f.min} max={f.maxValue} step={f.step} value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case "date":
      control = <input {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
      break;
    default:
      control = <input {...common} type="text" value={value} placeholder={f.placeholder} maxLength={f.max} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-fog">
        {f.label}
        {f.required && <span className="text-mist"> (needed)</span>}
      </label>
      {control}
      {error ? (
        <span id={`${id}-error`} className="text-[11.5px] text-bad">{error}</span>
      ) : (
        f.hint && <span id={`${id}-hint`} className="text-[11.5px] text-mist">{f.hint}</span>
      )}
    </div>
  );
}
