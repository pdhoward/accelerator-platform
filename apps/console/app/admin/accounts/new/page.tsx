import { ActionForm, Field, inputClass } from "@/components/action-form";
import { Card, CardBody, CardHead, Page, PageHeader } from "@/components/ui";
import { platformAccess } from "@/lib/access";

import { createAccount } from "../../actions";

export const metadata = { title: "New account" };

export default async function NewAccountPage() {
  await platformAccess("accounts.manage");

  return (
    <>
      <PageHeader title="New account" sub="Creates the account and its first site, and invites the owner. Nothing is billed until you say so." />
      <Page>
        <Card className="max-w-2xl">
          <CardHead title="Account" hint="Invite-only: the owner signs in with this email" />
          <CardBody>
            <ActionForm action={createAccount} submit="Create account and invite owner" pending="Creating…">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company">
                  <input name="name" required className={inputClass} placeholder="Cypress Resort" />
                </Field>
                <Field label="Owner email">
                  <input name="ownerEmail" type="email" required className={inputClass} placeholder="owner@company.com" />
                </Field>
                <Field label="Site name">
                  <input name="siteName" required className={inputClass} placeholder="cypressresort.com" />
                </Field>
                <Field label="Site URL">
                  <input name="siteUrl" type="url" required className={inputClass} placeholder="https://cypressresort.com" />
                </Field>
                <Field label="Plan">
                  <select name="plan" defaultValue="operate" className={inputClass}>
                    <option value="commission">Commission</option>
                    <option value="operate">Operate</option>
                    <option value="managed">Managed</option>
                  </select>
                </Field>
                <Field label="Billing">
                  <select name="billingMode" defaultValue="invoiced" className={inputClass}>
                    <option value="invoiced">Invoiced</option>
                    <option value="stripe">Stripe (card)</option>
                    <option value="comped">Comped</option>
                  </select>
                </Field>
                <Field label="Installation quote (USD)" hint="Custom by complexity, $5,000–$20,000. Leave blank if not quoted yet.">
                  <input name="installFeeQuoteUsd" type="number" min={0} step={500} className={inputClass} placeholder="12000" />
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </Page>
    </>
  );
}
