import Link from "next/link";
import { Mic } from "lucide-react";
import type { ConsultationStage } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Consultations" };

const PIPELINE: { stage: ConsultationStage; label: string }[] = [
  { stage: "transcript", label: "Conversation" },
  { stage: "requirements", label: "Requirements" },
  { stage: "approved", label: "Owner approves" },
  { stage: "design", label: "Design doc" },
  { stage: "building", label: "Build + test" },
  { stage: "live", label: "Preview → live" },
];

export default async function ConsultPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const consultations = await serverApi().consultations(site);

  return (
    <>
      <PageHeader title="Consultations" sub="Talk it through. The consulting agent turns the conversation into requirements, a design, and a change.">
        <ToastButton
          className={button("gold")}
          message="Voice consultation: a live, spoken session with the consulting agent (realtime voice). It asks questions, and the transcript becomes requirements you confirm."
        >
          <Mic className="size-4" /> Start a voice consultation
        </ToastButton>
      </PageHeader>
      <Page>
        {consultations.map((c) => {
          const at = PIPELINE.findIndex((p) => p.stage === c.stage);
          return (
            <Card key={c.id}>
              <CardHead title={c.title} hint={`${c.date} · ${c.mode} · ${c.participants.join(", ")}`} />
              <CardBody className="flex flex-col gap-5">
                <ol className="grid grid-cols-3 gap-1.5 md:grid-cols-6" aria-label="Progress">
                  {PIPELINE.map((p, i) => (
                    <li
                      key={p.stage}
                      className={cx(
                        "rounded-lg border px-2.5 py-2 text-center text-[11.5px]",
                        i < at && "border-good/40 bg-good/10 text-good",
                        i === at && "border-gold/55 bg-gold/10 text-gold-2",
                        i > at && "border-line text-mist",
                      )}
                    >
                      {p.label}
                    </li>
                  ))}
                </ol>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Eyebrow>From the conversation</Eyebrow>
                    {c.transcriptExcerpt.map((t, i) => (
                      <p key={i} className="text-[13px]">
                        <span className="text-mist">{t.speaker}:</span> {t.text}
                      </p>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Eyebrow>Requirements</Eyebrow>
                    {c.requirements.map((r) => (
                      <div key={r.id} className="flex items-start gap-2 text-[13px]">
                        <span className={r.confirmed ? "text-good" : "text-warn"}>{r.confirmed ? "✓" : "?"}</span>
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Eyebrow>Open questions</Eyebrow>
                    {c.openQuestions.length === 0 ? (
                      <Chip tone="good" className="self-start">All resolved</Chip>
                    ) : (
                      c.openQuestions.map((q) => (
                        <div key={q.q} className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-[13px]">
                          {q.q}
                        </div>
                      ))
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.stage === "requirements" && (
                        <ToastButton className={button("gold", "text-xs")} message="Requirements approved. The engine drafts the design doc next and brings back any open questions.">
                          Approve requirements
                        </ToastButton>
                      )}
                      {c.designDoc && (
                        <Link href={`/s/${site}/library?doc=${c.designDoc}`} className={button("plain", "text-xs")}>
                          Open the document
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </Page>
    </>
  );
}
