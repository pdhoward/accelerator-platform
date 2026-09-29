import { siteAccess } from "@/lib/access";
import { serverApi } from "@/lib/api";
import { SkillToggle } from "@/components/skill-toggle";
import { ToastButton } from "@/components/ui-provider";
import { button, Card, CardBody, CardHead, Chip, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Skills" };

export default async function SkillsPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  const [skills, { can }] = await Promise.all([(await serverApi()).skills.list(site), siteAccess(site)]);
  const ours = skills.filter((s) => s.source === "strategic-machines");
  const custom = skills.filter((s) => s.source === "custom");

  const Grid = ({ list }: { list: typeof skills }) => (
    <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[13.5px] font-semibold">{s.name}</h3>
              <span className="font-mono text-[11px] text-mist">v{s.version}</span>
            </div>
            <SkillToggle siteId={site} skillId={s.id} name={s.name} enabled={s.enabled} disabled={!can("skills.manage")} />
          </div>
          <p className="text-[12.5px] leading-snug text-fog">{s.description}</p>
          <div className="mt-auto flex flex-wrap gap-1.5">
            <Chip className="capitalize">{s.category}</Chip>
            {s.usedBy.map((u) => <Chip key={u} tone="violet">{u}</Chip>)}
          </div>
        </div>
      ))}
    </CardBody>
  );

  return (
    <>
      <PageHeader title="Skills" sub="What the agents know how to do. Ours come preconfigured for engineering and design management of a site.">
        <ToastButton className={button("gold")} message="New skill: describe it in plain words (e.g. 'our brand voice for villa descriptions'); the engine drafts the instructions for you to approve.">
          Add a skill
        </ToastButton>
      </PageHeader>
      <Page>
        <Card>
          <CardHead title="The Strategic Machines library" hint={`${ours.length} skills, versioned and maintained by us`} />
          <Grid list={ours} />
        </Card>
        <Card>
          <CardHead title="This site's own skills" hint="Written with you; they capture how your business works" />
          <Grid list={custom} />
        </Card>
      </Page>
    </>
  );
}
