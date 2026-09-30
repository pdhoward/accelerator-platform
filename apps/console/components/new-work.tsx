"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";

import { browserApi } from "@/lib/browser-api";

import { inputClass } from "./action-form";
import { button, Card, CardBody, CardHead } from "./ui";
import { useUi } from "./ui-provider";

/** Start a Work item the way every good session starts: say what you've noticed. */
export function NewWork({ siteId }: { siteId: string }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useUi();

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { number } = await browserApi().work.create(siteId, { title, message });
      router.push(`/s/${siteId}/work/${number}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't start it.");
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead title="Start a conversation" hint="An observation, a complaint, an idea. The engine replies, and you shape it together." />
      <CardBody>
        <form onSubmit={start} className="flex flex-col gap-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={120} placeholder="A short title, e.g. “Assistant should remember my budget”" className={inputClass} />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={3}
            rows={4}
            placeholder="What have you noticed, or what do you want? Say it the way you'd tell a colleague."
            className={`${inputClass} resize-y`}
          />
          <button type="submit" className={button("gold", "self-start")} disabled={busy || title.trim().length < 3 || message.trim().length < 3}>
            <MessageSquarePlus className="size-4" /> {busy ? "Starting…" : "Start"}
          </button>
        </form>
      </CardBody>
    </Card>
  );
}
