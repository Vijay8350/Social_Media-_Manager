"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { AuthState } from "@/app/login/actions";

type Action = (prev: AuthState, formData: FormData) => Promise<AuthState>;

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: Action;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined,
  );

  const isLogin = mode === "login";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Social Media Manager
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          {isLogin ? "Welcome back" : "Create your account"}
        </h1>
      </div>

      <form action={formAction} className="card flex flex-col gap-4 p-6">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="rounded-md border border-border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete={isLogin ? "current-password" : "new-password"}
            className="rounded-md border border-border px-3 py-2"
          />
        </label>

        {state?.error && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
        {state?.notice && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            {state.notice}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Please wait…" : isLogin ? "Log in" : "Sign up"}
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        {isLogin ? (
          <>
            No account?{" "}
            <Link href="/signup" className="underline">
              Sign up
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Log in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}
