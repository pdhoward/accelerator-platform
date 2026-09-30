import { ApiError } from "@accelerator/api-client";

import { ModelsForm } from "@/components/models-form";
import { SetupPanel } from "@/components/setup-panel";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";

export const metadata = { title: "Setup" };

export default async function SetupPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const { can } = await siteAccess(site);
  const api = await serverApi();
  const [setup, models] = await Promise.all([api.setup.get(site), api.models.get(site)]).catch((err) => {
    if (err instanceof ApiError && err.status === 503) return [null, null] as const;
    throw err;
  });

  return (
    <>
      <PageHeader
        title="Setup"
        sub="Before the first Work item: we install, the engine proves it's ready, and you sign the working agreement. Every item has one owner."
      />
      <Page>
        {!setup || !models ? (
          <Card>
            <CardBody className="pt-5 text-[13.5px] text-fog">Setup needs the database. The local demo runs without one.</CardBody>
          </Card>
        ) : (
          <>
            <SetupPanel siteId={site} initial={setup} canManage={can("config.manage")} />
            <ModelsForm siteId={site} initial={models} canManage={can("config.manage")} />
          </>
        )}
      </Page>
    </>
  );
}
