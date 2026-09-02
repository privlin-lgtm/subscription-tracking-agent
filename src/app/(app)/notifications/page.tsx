import { redirect } from "next/navigation";
import { auth } from "@/infrastructure/auth/auth";
import { app } from "@/infrastructure/composition";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const items = await app.notifications.listByUser(session.user.id);

  return (
    <main>
      <h1 className="text-2xl font-semibold">Notifications</h1>
      <ul className="mt-4 space-y-3">
        {items.length === 0 ? (
          <li className="rounded-xl border bg-white p-6 text-sm text-slate-500">No notifications yet.</li>
        ) : (
          items.map((item) => (
            <li className="rounded-xl border bg-white p-4" key={item.id}>
              <p className="text-xs uppercase tracking-wide text-slate-400">{item.type}</p>
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-slate-600">{item.body}</p>
            </li>
          ))
        )}
      </ul>
    </main>
  );
}
