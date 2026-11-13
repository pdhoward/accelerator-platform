import Link from "next/link";

import { Card, CardBody } from "./ui";

/** Shown on the Cradle's screens (Policy, Graph) when the site is on the Modernize path (B31). */
export function ModernizeNotice({ siteId, screen }: { siteId: string; screen: string }) {
  return (
    <Card>
      <CardBody className="space-y-2 pt-5 text-[13.5px] text-fog">
        <p>
          This site is on the <span className="font-semibold text-ink">Modernize</span> path: the crew upgrades its code and builds features as Work items, and the
          code stays the app. {screen} belongs to the <span className="font-semibold text-ink">Transform</span> path, where the crew reads the code into a policy book
          you rule on.
        </p>
        <p>
          To move to Transform, change the path in{" "}
          <Link href={`/s/${siteId}/setup`} className="text-gold-2 underline-offset-2 hover:underline">
            Setup
          </Link>
          . The site keeps its Work history.
        </p>
      </CardBody>
    </Card>
  );
}
