"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"confirm" | "dismiss" | null>(null);

  async function confirm() {
    setPending("confirm");
    await fetch(`/api/reviews/${id}/confirm`, { method: "POST", body: JSON.stringify({}) });
    setPending(null);
    router.refresh();
  }

  async function dismiss() {
    setPending("dismiss");
    await fetch(`/api/reviews/${id}/dismiss`, { method: "POST", body: JSON.stringify({}) });
    setPending(null);
    router.refresh();
  }

  return (
    <div className="flex gap-2">
      <button
        className="rounded-lg bg-accent-500 px-3 py-2 text-sm text-white disabled:opacity-60"
        disabled={pending !== null}
        onClick={confirm}
        type="button"
      >
        {pending === "confirm" ? "Saving..." : "Confirm"}
      </button>
      <button
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
        disabled={pending !== null}
        onClick={dismiss}
        type="button"
      >
        {pending === "dismiss" ? "Saving..." : "Dismiss"}
      </button>
    </div>
  );
}
