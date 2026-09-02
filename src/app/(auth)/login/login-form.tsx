"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GoogleSignInButton } from "../google-sign-in-button";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirect: false,
    });
    setPending(false);
    if (result?.error) {
      setError("Invalid email or password");
      return;
    }
    router.push(params.get("callbackUrl") || "/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-600">
          Use Google to sign in with a passkey, PIN, or any other method on your Google account.
        </p>
        <div className="mt-6">
          <GoogleSignInButton callbackUrl={params.get("callbackUrl") || "/dashboard"} />
        </div>
        <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or email
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-medium">
            Email
            <input className="mt-1 w-full rounded-lg border px-3 py-2" name="email" type="email" required />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input className="mt-1 w-full rounded-lg border px-3 py-2" name="password" type="password" required />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            className="w-full rounded-lg bg-accent-500 px-4 py-2 font-medium text-white hover:bg-accent-600 disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          No account?{" "}
          <Link className="text-accent-600" href="/register">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
