"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AddSubscriptionForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(null);
    const response = await fetch("/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: String(data.get("vendor") ?? ""),
        priceAmount: Number(data.get("priceAmount")),
        currency: String(data.get("currency") ?? "USD"),
        billingCycle: String(data.get("billingCycle") ?? "monthly"),
        nextRenewalDate: String(data.get("nextRenewalDate") || "") || null,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setError(payload.error ?? "Could not add subscription");
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form className="rounded-xl border bg-white p-4" onSubmit={onSubmit}>
      <h2 className="font-medium">Add subscription</h2>
      <p className="mt-1 text-sm text-slate-500">Manual entries are stored with full history and audit log.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <label className="text-sm">
          Vendor
          <input className="mt-1 w-full rounded-lg border px-3 py-2" name="vendor" required />
        </label>
        <label className="text-sm">
          Price
          <input className="mt-1 w-full rounded-lg border px-3 py-2" min="0.01" name="priceAmount" required step="0.01" type="number" />
        </label>
        <label className="text-sm">
          Currency
          <input className="mt-1 w-full rounded-lg border px-3 py-2 uppercase" defaultValue="USD" maxLength={3} name="currency" required />
        </label>
        <label className="text-sm">
          Cycle
          <select className="mt-1 w-full rounded-lg border px-3 py-2" defaultValue="monthly" name="billingCycle">
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="text-sm">
          Next renewal
          <input className="mt-1 w-full rounded-lg border px-3 py-2" name="nextRenewalDate" type="date" />
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <button
        className="mt-4 rounded-lg bg-accent-500 px-3 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Saving..." : "Add subscription"}
      </button>
    </form>
  );
}
