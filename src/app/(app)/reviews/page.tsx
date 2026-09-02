import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { minorToMajorUnits } from "@/domain/value-objects/money";
import { ReviewActions } from "./review-actions";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const items = await app.reviewService.listPending(session.user.id);
  const withSnapshots = await Promise.all(
    items.map(async (item) => ({
      ...item,
      snapshot: item.lastSeenEmailId ? await app.snapshots.get(session.user.id, item.lastSeenEmailId) : null,
    })),
  );

  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-slate-600">
          Low-confidence extractions stay here until you confirm or dismiss them. Nothing is auto-applied.
        </p>
      </div>
      {withSnapshots.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">No items waiting for review.</p>
      ) : (
        <ul className="space-y-4">
          {withSnapshots.map((item) => (
            <li className="rounded-xl border bg-white p-4" key={item.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-medium">{item.vendorNormalized}</h2>
                  <p className="text-sm text-slate-500">
                    {minorToMajorUnits(item.priceAmountCents, item.priceCurrency).toFixed(2)} {item.priceCurrency} ·{" "}
                    {item.billingCycle} · confidence {item.confidenceScore.toFixed(2)}
                  </p>
                  {item.reviewReason ? <p className="mt-1 text-sm text-amber-700">Reason: {item.reviewReason}</p> : null}
                </div>
                <ReviewActions id={item.id} />
              </div>
              {item.snapshot ? (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-slate-600">Source email</summary>
                  <p className="mt-2 font-medium">{item.snapshot.subject}</p>
                  <p className="text-slate-500">{item.snapshot.sender}</p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{item.snapshot.bodyText.slice(0, 1200)}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
