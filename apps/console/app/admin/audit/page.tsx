import { AuditTable } from "@/components/admin";
import { Card, CardBody, Page, PageHeader } from "@/components/ui";
import { platformAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await platformAccess("audit.view");
  const entries = await (await serverApi()).admin.audit();

  return (
    <>
      <PageHeader title="Audit log" sub="Every admin action: who, what, when. Append-only." />
      <Page>
        <Card>
          <CardBody>
            <AuditTable entries={entries} />
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
