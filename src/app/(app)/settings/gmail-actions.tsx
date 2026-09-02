"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function GmailActions({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function disconnect() {
    setPending(true);
    await fetch("/api/gmail/disconnect", { method: "POST" });
    setPending(false);
    router.refresh();
  }

  async function syncNow() {
    setPending(true);
    await fetch("/api/gmail/sync", { method: "POST" });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="mt-4 flex gap-2">
      {connected ? (
        <>
          <button
            className="rounded-lg bg-accent-500 px-3 py-2 text-sm text-white disabled:opacity-60"
            disabled={pending}
            onClick={syncNow}
            type="button"
          >
            Sync now
          </button>
          <button
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
            disabled={pending}
            onClick={disconnect}
            type="button"
          >
            Disconnect
          </button>
        </>
      ) : (
        <a className="rounded-lg bg-accent-500 px-3 py-2 text-sm text-white" href="/api/gmail/connect">
          Connect Gmail
        </a>
      )}
    </div>
  );
}
