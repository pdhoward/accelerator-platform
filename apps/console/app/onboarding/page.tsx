import { Card, CardBody, Chip, Eyebrow, Page, PageHeader } from "@/components/ui";

export const metadata = { title: "Onboarding" };

const STEPS = [
  { n: 1, title: "Connect the repository", body: "Sign in with GitHub and pick the repo (public or private). The engine gets read access first; write access only to its own branches." },
  { n: 2, title: "Scan the site", body: "Fit Scan and Lighthouse on the live site, plus a repository scan: stack, structure, tests, hotspots. You get the Health page on day one." },
  { n: 3, title: "Record the configuration", body: "The engine reads .env.example and the code to list every key the site needs. You (or your developer) paste values into the vault per environment; each is tested." },
  { n: 4, title: "A 15-minute interview", body: "A voice or chat consultation about how your business works. It becomes the site's rulebook, in plain words, for you to approve." },
  { n: 5, title: "Install the guardrails", body: "Branch protection, a staging branch, preview deployments, the test layers and synthetic data. After this, nothing reaches customers unchecked." },
  { n: 6, title: "First requests", body: "The first ten requests are seeded from the scan. Your first change can be live the same week." },
];

export default function OnboardingPage() {
  return (
    <>
      <PageHeader title="Bring a site aboard" sub="About a week for most sites. Critically ill sites get a stabilization plan first." />
      <Page>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.n}>
              <CardBody className="flex flex-col gap-2 pt-5">
                <Eyebrow>Step {s.n}</Eyebrow>
                <h2 className="text-[15px] font-semibold">{s.title}</h2>
                <p className="text-[13px] leading-relaxed text-fog">{s.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
        <Chip tone="gold" className="self-start">Setup is covered by the one-time installation fee</Chip>
      </Page>
    </>
  );
}
