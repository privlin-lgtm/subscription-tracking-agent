"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DISPLAY_CURRENCY_OPTIONS } from "@/shared/display-currencies";

export function DisplayCurrencyForm({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // A config default outside the standard list still has to show as the selected value.
  const options = (DISPLAY_CURRENCY_OPTIONS as readonly string[]).includes(current)
    ? DISPLAY_CURRENCY_OPTIONS
    : [current, ...DISPLAY_CURRENCY_OPTIONS];

  async function save() {
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayCurrency: value }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!response.ok) {
      setMessage({ ok: false, text: payload.error ?? "Could not save display currency" });
      return;
    }
    setMessage({ ok: true, text: "Saved." });
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-sm" htmlFor="display-currency">
        Show combined totals in
      </label>
      <select
        className="rounded-lg border px-3 py-2 text-sm"
        disabled={pending}
        id="display-currency"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <button
        className="rounded-lg bg-accent-500 px-3 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending || value === current}
        onClick={save}
        type="button"
      >
        Save
      </button>
      {message ? (
        <span className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`}>{message.text}</span>
      ) : null}
    </div>
  );
}
