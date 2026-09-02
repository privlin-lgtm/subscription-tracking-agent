"use client";

import { useState } from "react";

export function DangerZone({ deleteAccountAction }: { deleteAccountAction: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  if (!confirming) {
    return (
      <button
        className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
        onClick={() => setConfirming(true)}
        type="button"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4">
      <p className="text-sm text-red-800">
        This permanently deletes your account and every subscription, history, notification, and audit record
        tied to it. This cannot be undone.
      </p>
      <form action={deleteAccountAction} className="mt-3 flex gap-2" onSubmit={() => setPending(true)}>
        <button
          className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? "Deleting..." : "Yes, permanently delete my account"}
        </button>
        <button
          className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
          disabled={pending}
          onClick={() => setConfirming(false)}
          type="button"
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
