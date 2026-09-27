import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { AccountDna } from "@insta/shared";
import { saveDna } from "./actions";
import { DnaForm } from "./DnaForm";

export default async function DnaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_dna")
    .select("*")
    .eq("account_id", id)
    .maybeSingle();

  const dna = (data as AccountDna | null) ?? null;
  const boundSave = saveDna.bind(null, id);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`/dashboard/accounts/${id}/business-dna`}
        className="card flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/60"
      >
        <span>
          <span className="font-semibold">Rather not fill this in by hand?</span>{" "}
          <span className="text-muted-foreground">
            Build a Business DNA from your Instagram and website, then apply it here.
          </span>
        </span>
        <span className="text-accent">→</span>
      </Link>
      <DnaForm key={dna?.updated_at ?? "new"} action={boundSave} dna={dna} />
    </div>
  );
}
