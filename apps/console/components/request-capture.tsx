"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { browserApi } from "@/lib/browser-api";
import { button, Card, CardBody, Eyebrow } from "./ui";
import { useUi } from "./ui-provider";

export function RequestCapture({ siteId }: { siteId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast } = useUi();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) {
      toast("Describe the request first. A sentence is enough.");
      return;
    }
    setBusy(true);
    try {
      const req = await browserApi().requests.create(siteId, { text });
      setText("");
      toast(`Request #${req.number} created as ${req.type}. The engine will restate it and ask at most 3 questions.`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-2">
            <label htmlFor="request-text">
              <Eyebrow>Tell the engine what&apos;s wrong or what you want</Eyebrow>
            </label>
            <textarea
              id="request-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="e.g. The photo on the Villas page looks blurry on my phone, and the Laurel's price shows $0 on the booking page."
              className="w-full resize-y rounded-xl border border-line-2 bg-panel-2 px-3.5 py-3 leading-relaxed text-ink placeholder:text-mist focus:border-violet focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button("plain", "text-xs")} onClick={() => toast("Drop or paste a screenshot here in the full product.")}>
                Attach screenshot
              </button>
              <button type="button" className={button("plain", "text-xs")} onClick={() => toast("Point-and-complain opens your live site with a pointer: click the thing that's wrong and describe it.")}>
                Point at the live site
              </button>
              <button type="button" className={button("plain", "text-xs")} onClick={() => toast("Voice capture: describe it out loud and the consulting agent turns it into a request.")}>
                Say it
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 md:w-44">
            <button type="submit" className={button("gold")} disabled={busy}>
              {busy ? "Sending…" : "Send to engine"}
            </button>
            <span className="text-xs text-mist">It restates the request and asks at most 3 questions.</span>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
