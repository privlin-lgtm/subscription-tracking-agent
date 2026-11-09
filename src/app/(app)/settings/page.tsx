import { redirect } from "next/navigation";
import { auth, signOut } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";
import { GmailActions } from "./gmail-actions";
import { DangerZone } from "./danger-zone";
import { DisplayCurrencyForm } from "./display-currency-form";

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
  const [user, displayCurrency] = await Promise.all([
    app.users.findById(session.user.id),
    app.displayCurrency.get(session.user.id),
  ]);
  const params = await searchParams;
  const userId = session.user.id;

  async function deleteAccountAction() {
    "use server";
    await app.users.deleteAccount(userId);
    await signOut({ redirectTo: "/login" });
  }

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
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Display currency</h2>
        <p className="mt-1 text-sm text-slate-600">
          When your subscriptions use more than one currency, the dashboard adds an approximate combined total in
          this currency, using daily reference rates. Your subscriptions keep their original prices.
        </p>
        <DisplayCurrencyForm current={displayCurrency} />
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="font-medium">Account</h2>
        <p className="mt-1 text-sm text-slate-600">Permanently delete your account and all associated data.</p>
        <div className="mt-3">
          <DangerZone deleteAccountAction={deleteAccountAction} />
        </div>
      </section>
    </main>
  );
}
