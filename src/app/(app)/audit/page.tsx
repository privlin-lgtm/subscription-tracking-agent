import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const items = await app.subscriptionService.listAudit(session.user.id, 100);

  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">User and system actions for this account, newest first.</p>
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr className="border-t align-top" key={item.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  {item.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                </td>
                <td className="px-4 py-3">{item.actor}</td>
                <td className="px-4 py-3 font-medium">{item.action}</td>
                <td className="px-4 py-3 text-slate-600">
                  <pre className="whitespace-pre-wrap font-sans">{JSON.stringify(item.details)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No audit entries yet.</p> : null}
      </div>
    </main>
  );
}
