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

  return <DnaForm action={boundSave} dna={dna} />;
}
