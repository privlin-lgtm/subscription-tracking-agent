import { notFound, redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";
import { CancelButton } from "./cancel-button";

export const dynamic = "force-dynamic";

export default async function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const { id } = await params;
  const item = await app.subscriptionService.get(session.user.id, id).catch(() => null);
  if (!item) {
    notFound();
  }

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
    </main>
  );
}
