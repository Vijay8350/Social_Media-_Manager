import { createClient } from "@/lib/supabase/server";
import type { Post, PromptLibraryItem } from "@insta/shared";
import { generateNow, generatePostImage } from "./actions";
import { GenerateForm } from "./GenerateForm";

const STATUS_STYLE: Record<string, string> = {
  queued: "bg-blue-50 text-blue-700",
  generating: "bg-amber-50 text-amber-700",
  qa_failed: "bg-red-50 text-red-700",
  published: "bg-green-50 text-green-700",
  skipped: "bg-neutral-100 text-neutral-500",
};

export default async function ContentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: promptRows }, { data: postRows }] = await Promise.all([
    supabase
      .from("prompt_library")
      .select("id, label, type, active")
      .eq("account_id", id)
      .eq("type", "quote_idea")
      .eq("active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("posts")
      .select("*")
      .eq("account_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const prompts = ((promptRows as PromptLibraryItem[] | null) ?? []).map((p) => ({
    id: p.id,
    label: p.label,
  }));
  const posts = (postRows as Post[] | null) ?? [];
  const boundGenerate = generateNow.bind(null, id);

  // Signed URLs for previewing images from the private bucket (owner-readable via RLS).
  const signedUrls = new Map<string, string>();
  await Promise.all(
    posts
      .filter((p) => p.image_url)
      .map(async (p) => {
        const { data } = await supabase.storage
          .from("post-images")
          .createSignedUrl(p.image_url as string, 3600);
        if (data?.signedUrl) signedUrls.set(p.id, data.signedUrl);
      }),
  );

  return (
    <div className="flex flex-col gap-8">
      <GenerateForm action={boundGenerate} prompts={prompts} />

      <section>
        <h2 className="text-sm font-semibold text-neutral-900">
          Content queue <span className="text-neutral-400">({posts.length})</span>
        </h2>
        {posts.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            Nothing generated yet. Use “Generate now” above.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {posts.map((post) => (
              <li
                key={post.id}
                className="rounded-lg border border-neutral-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{post.headline}</p>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[post.status] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {post.status}
                  </span>
                </div>
                {post.lines?.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                    {post.lines.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
                {post.caption && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-600">
                    {post.caption}
                  </p>
                )}
                {post.hashtags?.length > 0 && (
                  <p className="mt-2 text-xs text-neutral-500">
                    {post.hashtags.join(" ")}
                  </p>
                )}

                {/* Image preview / generate */}
                {signedUrls.has(post.id) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={signedUrls.get(post.id)}
                    alt={post.headline ?? "post image"}
                    className="mt-3 w-48 rounded-md border border-neutral-200"
                  />
                ) : (
                  <form
                    action={generatePostImage.bind(null, id, post.id)}
                    className="mt-3"
                  >
                    <button className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100">
                      Generate image
                    </button>
                  </form>
                )}

                {post.qa_score != null && (
                  <p
                    className={`mt-2 text-xs ${
                      post.status === "qa_failed" ? "text-red-600" : "text-neutral-500"
                    }`}
                  >
                    QA score {post.qa_score}
                    {post.qa_reasons?.length
                      ? ` — ${post.qa_reasons.join("; ")}`
                      : ""}
                    {post.regen_attempts
                      ? ` (after ${post.regen_attempts} attempt${
                          post.regen_attempts > 1 ? "s" : ""
                        })`
                      : ""}
                  </p>
                )}

                <p className="mt-2 text-xs text-neutral-400">
                  {post.origin} · {new Date(post.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
