import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Insta Post Generator
        </h1>
        <p className="mt-2 text-neutral-600">
          Autonomous AI quote content, generated and posted to Instagram on a
          daily schedule — guarded by an AI quality gate.
        </p>
      </div>
      <div className="flex gap-3">
        {user ? (
          <Link
            href="/dashboard"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
