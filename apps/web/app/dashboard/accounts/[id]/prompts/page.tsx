import { createClient } from "@/lib/supabase/server";
import type { PromptLibraryItem } from "@insta/shared";
import { addPrompt, togglePrompt, deletePrompt } from "./actions";

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("prompt_library")
    .select("*")
    .eq("account_id", id)
    .order("created_at", { ascending: true });

  const prompts = (data as PromptLibraryItem[] | null) ?? [];
  const quote = prompts.filter((p) => p.type === "quote_idea");
  const image = prompts.filter((p) => p.type === "image_idea");

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-neutral-600">
        Your reusable prompts. The autopilot rotates through the{" "}
        <strong>active</strong> ones (blended with the account DNA), avoiding
        recent repeats. Quote-idea prompts steer the text; image-idea prompts
        steer the artwork.
      </p>

      <PromptGroup title="Quote-idea prompts" items={quote} accountId={id} />
      <PromptGroup title="Image-idea prompts" items={image} accountId={id} />

      {/* Add form */}
      <form
        action={addPrompt.bind(null, id)}
        className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4"
      >
        <h3 className="text-sm font-semibold">Add a prompt</h3>
        <div className="grid grid-cols-[160px_1fr] gap-3">
          <select
            name="type"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            defaultValue="quote_idea"
          >
            <option value="quote_idea">Quote idea</option>
            <option value="image_idea">Image idea</option>
          </select>
          <input
            name="label"
            required
            placeholder="Short label (e.g. savage zodiac)"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <textarea
          name="prompt_text"
          required
          rows={3}
          placeholder="The prompt text / angle…"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          Add prompt
        </button>
      </form>
    </div>
  );
}

function PromptGroup({
  title,
  items,
  accountId,
}: {
  title: string;
  items: PromptLibraryItem[];
  accountId: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-neutral-900">
        {title} <span className="text-neutral-400">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">None yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
          {items.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {p.label}
                  {!p.active && (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                      disabled
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-neutral-600">{p.prompt_text}</p>
                <p className="mt-1 text-xs text-neutral-400">
                  used {p.use_count}×
                  {p.last_used_at
                    ? ` · last ${new Date(p.last_used_at).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <form action={togglePrompt.bind(null, accountId, p.id, !p.active)}>
                  <button className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100">
                    {p.active ? "Disable" : "Enable"}
                  </button>
                </form>
                <form action={deletePrompt.bind(null, accountId, p.id)}>
                  <button className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
