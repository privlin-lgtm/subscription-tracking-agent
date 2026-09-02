import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";
import { AddSubscriptionForm } from "./add-subscription-form";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const [items, renewals] = await Promise.all([
    app.subscriptionService.list(session.user.id),
    app.subscriptionService.listUpcomingRenewals(session.user.id, 30),
  ]);

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Subscriptions</h1>
        <p className="mt-1 text-sm text-slate-600">Discovered from Gmail or added manually. Price and renewal changes are kept in history.</p>
      </div>
      <AddSubscriptionForm />
      {renewals.length > 0 ? (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-medium">Renewing in the next 30 days</h2>
          <ul className="mt-3 divide-y text-sm">
            {renewals.map((item) => (
              <li className="flex items-center justify-between py-2" key={item.id}>
                <Link className="font-medium text-accent-600" href={`/subscriptions/${item.id}`}>
                  {item.vendorNormalized}
                </Link>
                <span className="text-slate-500">{item.nextRenewalDate?.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3">Vendor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Cycle</th>
              <th className="px-4 py-3">Next renewal</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-t" key={item.id}>
                <td className="px-4 py-3">
                  <Link className="font-medium text-accent-600" href={`/subscriptions/${item.id}`}>
                    {item.vendorNormalized}
                  </Link>
                </td>
                <td className="px-4 py-3">{item.status}</td>
                <td className="px-4 py-3">
                  {minorToMajorUnits(item.priceAmountCents, item.priceCurrency).toFixed(2)} {item.priceCurrency}
                </td>
                <td className="px-4 py-3">{item.billingCycle}</td>
                <td className="px-4 py-3">{item.nextRenewalDate?.toISOString().slice(0, 10) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No subscriptions yet. Add one above or connect Gmail in Settings.</p> : null}
      </div>
    </main>
  );
}
