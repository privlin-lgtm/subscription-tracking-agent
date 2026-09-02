import { notFound, redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";
import { CancelButton } from "./cancel-button";
import { billingCycleToForm, EditSubscriptionForm } from "./edit-subscription-form";

export const dynamic = "force-dynamic";

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { id } = await params;
  const detail = await app.subscriptionService.getDetail(session.user.id, id).catch(() => null);
  if (!detail) {
    notFound();
  }
  const { item, events, priceChanges } = detail;

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">{item.vendorNormalized}</h1>
      <section className="rounded-xl border bg-white p-4 text-sm">
        <dl className="grid gap-3 md:grid-cols-2">
          <div>
            <dt className="text-slate-500">Raw vendor</dt>
            <dd>{item.vendorRaw}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd>{item.status}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Price</dt>
            <dd>
              {minorToMajorUnits(item.priceAmountCents, item.priceCurrency).toFixed(2)} {item.priceCurrency}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Billing cycle</dt>
            <dd>{item.billingCycle}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Next renewal</dt>
            <dd>{item.nextRenewalDate?.toISOString().slice(0, 10) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Confidence</dt>
            <dd>{item.confidenceScore.toFixed(2)}</dd>
          </div>
        </dl>
        {item.status === "ACTIVE" ? <CancelButton id={item.id} /> : null}
      </section>

      {item.status !== "CANCELED" && item.status !== "DISMISSED" ? (
        <EditSubscriptionForm
          billingCycle={billingCycleToForm(item.billingCycle)}
          currency={item.priceCurrency}
          id={item.id}
          nextRenewalDate={item.nextRenewalDate?.toISOString().slice(0, 10) ?? ""}
          priceAmount={minorToMajorUnits(item.priceAmountCents, item.priceCurrency)}
          vendor={item.vendorRaw}
        />
      ) : null}

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Price changes</h2>
        {priceChanges.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No price changes recorded.</p>
        ) : (
          <ul className="mt-3 divide-y text-sm">
            {priceChanges.map((change) => (
              <li className="flex items-center justify-between py-2" key={change.id}>
                <span>
                  {minorToMajorUnits(change.oldAmountCents, change.currency).toFixed(2)} →{" "}
                  {minorToMajorUnits(change.newAmountCents, change.currency).toFixed(2)} {change.currency}
                </span>
                <span className="text-slate-500">{change.detectedAt.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">History</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No events yet.</p>
        ) : (
          <ol className="mt-3 space-y-2 text-sm">
            {events.map((event) => (
              <li className="flex items-center justify-between border-b py-2 last:border-0" key={event.id}>
                <span className="font-medium">{event.eventType}</span>
                <span className="text-slate-500">{event.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
