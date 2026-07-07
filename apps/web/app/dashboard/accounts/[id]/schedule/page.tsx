import { createClient } from "@/lib/supabase/server";
import type { AccountDna } from "@insta/shared";
import { saveSchedule } from "./actions";
import { ScheduleForm } from "./ScheduleForm";

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_dna")
    .select("posting_slots, autonomous, timezone")
    .eq("account_id", id)
    .maybeSingle();

  const dna = data as Pick<AccountDna, "posting_slots" | "autonomous" | "timezone"> | null;

  return (
    <ScheduleForm
      action={saveSchedule.bind(null, id)}
      initialSlots={dna?.posting_slots ?? []}
      initialAutonomous={dna?.autonomous ?? true}
      initialTimezone={dna?.timezone ?? "UTC"}
    />
  );
}
