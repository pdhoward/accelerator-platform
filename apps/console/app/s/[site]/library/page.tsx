import Link from "next/link";
import type { DocKind } from "@accelerator/domain";

import { serverApi } from "@/lib/api";
import { EngineerOnly, ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, cx, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Library" };

const KIND_LABEL: Record<DocKind, string> = {
  rulebook: "Rulebook",
  requirements: "Requirements",
  design: "Design",
  decision: "Decision",
  runbook: "Runbook",
  "release-notes": "Release notes",
};

export default async function LibraryPage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { site } = await params;
  const { doc: docId } = await searchParams;
  const { docs, facts, drift } = await (await serverApi()).library.list(site);
  const doc = docs.find((d) => d.id === docId) ?? docs[0];

  return (
    <>
      <PageHeader title="Library" sub="The site's knowledge: rules, requirements, designs, decisions and runbooks. Stored as Markdown in the repository.">
        <ToastButton className={button("plain")} message="New document: pick a type and the engine drafts it from the site's context for you to edit.">
          New document
        </ToastButton>
      </PageHeader>
      <Page>
        <div className="grid items-start gap-4 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_300px]">
          <Card className="p-2">
            <nav className="flex flex-col gap-0.5" aria-label="Documents">
              {docs.map((d) => (
                <Link
                  key={d.id}
                  href={`?doc=${d.id}`}
                  aria-current={d.id === doc?.id ? "page" : undefined}
                  className={cx("flex flex-col rounded-lg px-3 py-2 text-[13px]", d.id === doc?.id ? "bg-panel-2 text-ink" : "text-fog hover:bg-panel-2")}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-mist">{KIND_LABEL[d.kind]}</span>
                  {d.title}
                </Link>
              ))}
            </nav>
          </Card>

          {doc && (
            <Card className="px-7 py-6">
              <article className="max-w-[72ch]">
                <div className="flex flex-wrap items-center gap-2">
                  <Eyebrow>{KIND_LABEL[doc.kind]}</Eyebrow>
                  <Chip tone={doc.status === "approved" ? "good" : doc.status === "draft" ? "warn" : "cyan"} className="capitalize">{doc.status}</Chip>
                  <span className="text-xs text-mist">Updated {doc.updatedAt}</span>
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">{doc.title}</h2>
                <p className="text-xs text-mist">Source: {doc.source}</p>
                {doc.sections.map((s) => (
                  <section key={s.heading} className="mt-5">
                    <h3 className="text-[15px] font-semibold">{s.heading}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-fog">{s.body}</p>
                  </section>
                ))}
                <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                  <ToastButton className={button("plain", "text-xs")} message="Editing opens in place. Saving commits the Markdown to the repository as a small change.">Edit</ToastButton>
                  {doc.status === "draft" && (
                    <ToastButton className={button("gold", "text-xs")} message="Approved. The document is marked approved and linked to its requests.">Approve</ToastButton>
                  )}
                  <ToastButton className={button("ghost", "text-xs")} message="Archived, not deleted: history is kept in the repository.">Archive</ToastButton>
                </div>
                <EngineerOnly>
                  <div className="mt-4 rounded-xl border border-dashed border-line-2 bg-panel-2 px-3 py-2 font-mono text-xs text-fog">git: {doc.source}</div>
                </EngineerOnly>
              </article>
            </Card>
          )}

          <div className="flex flex-col gap-4 lg:col-span-2 xl:col-span-1">
            <Card>
              <CardHead title="Drift">
                <Chip tone="warn">{drift.length}</Chip>
              </CardHead>
              <CardBody className="flex flex-col gap-3">
                {drift.map((d) => (
                  <div key={d.id} className="flex flex-col gap-2 text-[13px]">
                    <p><b>The docs say:</b> {d.docSays}</p>
                    <p><b>The site does:</b> {d.siteDoes}</p>
                    <ToastButton className={button("plain", "self-start text-xs")} message="A request was drafted: decide which is right, then the engine fixes the doc or the site.">Resolve</ToastButton>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHead title="Facts" hint="Checked across every page" />
              <CardBody>
                <table className="w-full text-[13px]">
                  <tbody>
                    {facts.map((f) => (
                      <tr key={f.name} className="border-b border-line last:border-0">
                        <td className="py-2 pr-3 font-medium">{f.name}</td>
                        <td className="py-2">{f.conflict ? <Chip tone="warn" className="whitespace-normal">{f.value} · {f.conflict}</Chip> : f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>
        </div>
      </Page>
    </>
  );
}
