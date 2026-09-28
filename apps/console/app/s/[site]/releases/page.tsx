import { serverApi } from "@/lib/api";
import { ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Releases" };

export default async function ReleasesPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const releases = await serverApi().releases(site);

  return (
    <>
      <PageHeader title="Releases" sub="Everything that went live, in plain language, with one-click undo." />
      <Page>
        <Card>
          <CardBody className="flex flex-col">
            {releases.map((r, i) => (
              <div key={r.id} className={`grid items-start gap-3 py-3.5 sm:grid-cols-[120px_14px_1fr_auto] ${i > 0 ? "border-t border-line" : ""}`}>
                <span className="font-mono text-xs text-mist sm:text-right">{r.at}</span>
                <span className="mt-1 hidden size-3 rounded-full border-2 border-good sm:block" />
                <div>
                  <h3 className="text-[13.5px] font-semibold">
                    {r.title} {r.requestNumber && <span className="font-normal text-mist">· #{r.requestNumber}</span>}
                  </h3>
                  <p className="text-[12.5px] text-fog">{r.detail}</p>
                </div>
                <ToastButton className={button("ghost", "text-xs")} message="Undo restores the previous release in about 30 seconds, then re-runs the checks.">
                  Undo
                </ToastButton>
              </div>
            ))}
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
