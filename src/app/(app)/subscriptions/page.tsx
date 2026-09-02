import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const items = await app.subscriptionService.list(session.user.id);

  return (
    <main>
      <h1 className="text-2xl font-semibold">Subscriptions</h1>
      <div className="mt-4 overflow-hidden rounded-xl border bg-white">
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
        {items.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No subscriptions yet. Connect Gmail in Settings.</p> : null}
      </div>
    </main>
  );
}
