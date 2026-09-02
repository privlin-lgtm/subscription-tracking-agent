import Link from "next/link";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [subscriptions, summary, pending, notifications] = await Promise.all([
    app.subscriptionService.list(session.user.id),
    app.subscriptionService.spendSummary(session.user.id),
    app.reviewService.listPending(session.user.id),
    app.notifications.listByUser(session.user.id),
  ]);

  const upcoming = subscriptions
    .filter((item) => item.status === "ACTIVE" && item.nextRenewalDate)
    .sort((a, b) => (a.nextRenewalDate?.getTime() ?? 0) - (b.nextRenewalDate?.getTime() ?? 0))
    .slice(0, 5);

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">Active subscriptions</p>
          <p className="mt-2 text-3xl font-semibold">
            {subscriptions.filter((item) => item.status === "ACTIVE").length}
          </p>
        </article>
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">Spend summary</p>
          {summary.mixed ? (
            <div className="mt-2 space-y-1">
              <p className="text-sm font-medium text-amber-700">Mixed currencies — totals are not combined.</p>
              {summary.byCurrency.map((row) => (
                <p key={row.currency} className="text-lg font-semibold">
                  {minorToMajorUnits(row.totalCents, row.currency).toFixed(2)} {row.currency}
                  <span className="ml-2 text-sm font-normal text-slate-500">({row.subscriptionCount})</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-3xl font-semibold">
              {minorToMajorUnits(summary.totalCents, summary.currency).toFixed(2)} {summary.currency}
            </p>
          )}
        </article>
        <article className="rounded-xl border bg-white p-4">
          <p className="text-sm text-slate-500">Needs review</p>
          <p className="mt-2 text-3xl font-semibold">{pending.length}</p>
          <Link className="mt-2 inline-block text-sm text-accent-600" href="/reviews">
            Open review queue
          </Link>
        </article>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Upcoming renewals</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No upcoming renewals yet.</p>
        ) : (
          <ul className="mt-3 divide-y">
            {upcoming.map((item) => (
              <li className="flex items-center justify-between py-2 text-sm" key={item.id}>
                <Link className="font-medium" href={`/subscriptions/${item.id}`}>
                  {item.vendorNormalized}
                </Link>
                <span className="text-slate-500">{item.nextRenewalDate?.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Recent notifications</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No notifications yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {notifications.slice(0, 5).map((item) => (
              <li key={item.id}>
                <p className="font-medium">{item.title}</p>
                <p className="text-slate-500">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
