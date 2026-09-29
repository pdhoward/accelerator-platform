import { Table, td, tr } from "@/components/admin";
import { Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess, titleCase } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { day } from "@/lib/format";

export const metadata = { title: "Team" };

const ROLE_NOTE = {
  owner: "Everything, including the team",
  admin: "Accounts, revenue, suspend, audit",
  staff: "Read-only view of accounts",
} as const;

export default async function TeamPage() {
  await platformAccess("team.manage");
  const staff = await (await serverApi()).admin.team();

  return (
    <>
      <PageHeader title="Team" sub="Strategic Machines staff with access to Platform Admin." />
      <Page>
        <Card>
          <CardHead title="Platform staff" hint="Owners come from PLATFORM_ADMIN_EMAILS; others are added in the database for now" />
          <CardBody>
            <Table head={["Email", "Role", "Can", "Added"]} min={560}>
              {staff.map((s) => (
                <tr key={s.userId} className={tr}>
                  <td className={td}>{s.email}</td>
                  <td className={td}>{titleCase(s.role)}</td>
                  <td className={`${td} text-fog`}>{ROLE_NOTE[s.role]}</td>
                  <td className={`${td} text-mist`}>{day(s.addedAt)}</td>
                </tr>
              ))}
            </Table>
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
