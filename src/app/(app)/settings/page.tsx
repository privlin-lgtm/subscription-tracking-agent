import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { GmailActions } from "./gmail-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const user = await app.users.findById(session.user.id);
  const params = await searchParams;

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Gmail</h2>
        <p className="mt-1 text-sm text-slate-600">
          Access is read-only (`gmail.readonly`). Refresh tokens are encrypted at rest and never returned by the API.
        </p>
        <p className="mt-2 text-sm">
          Status:{" "}
          <span className="font-medium">{user?.gmailConnected ? "Connected" : "Not connected"}</span>
        </p>
        {params.gmail === "connected" ? <p className="mt-2 text-sm text-green-700">Gmail connected.</p> : null}
        {params.gmail === "denied" ? <p className="mt-2 text-sm text-red-700">Gmail authorization was denied.</p> : null}
        <GmailActions connected={Boolean(user?.gmailConnected)} />
      </section>
    </main>
  );
}
