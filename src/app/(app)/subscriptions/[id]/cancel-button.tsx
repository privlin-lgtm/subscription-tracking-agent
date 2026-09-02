"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onCancel() {
    setPending(true);
    await fetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    setPending(false);
    router.refresh();
  }

  return (
    <button
      className="mt-4 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
      disabled={pending}
      onClick={onCancel}
      type="button"
    >
      {pending ? "Canceling..." : "Mark canceled"}
    </button>
  );
}
