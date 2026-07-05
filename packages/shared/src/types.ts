/**
 * Domain types mirroring the Postgres schema (supabase/migrations).
 * Hand-maintained for now; can be replaced by generated Supabase types later.
 */

export type PromptType = "quote_idea" | "image_idea";

export type PostStatus =
  | "queued"
  | "generating"
  | "qa_failed"
  | "published"
  | "skipped";

export type PostOrigin = "auto" | "manual";

export type InstagramAccountStatus =
  | "connected"
  | "disconnected"
  | "needs_reauth"
  | "ineligible";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface Profile {
  id: string; // = auth.users.id
  email: string | null;
  plan: string;
  created_at: string;
}

export interface InstagramAccount {
  id: string;
  user_id: string;
  ig_user_id: string | null;
  ig_username: string | null;
  page_id: string | null;
  encrypted_token: string | null;
  token_expiry: string | null;
  status: InstagramAccountStatus;
  created_at: string;
}

export interface VisualIdentity {
  palette?: string[];
  mood?: string;
  style?: string;
  font?: string;
  layout?: string;
}

export interface AccountDna {
  id: string;
  account_id: string;
  user_id: string;
  persona: string | null;
  tone: string | null;
  audience: string | null;
  niche: string | null;
  content_pillars: string[];
  visual_identity: VisualIdentity;
  language: string | null;
  dos: string[];
  donts: string[];
  examples: string[];
  default_post_time: string | null; // "HH:mm"
  timezone: string | null;
  hashtag_strategy: string | null;
  updated_at: string;
}

export interface PromptLibraryItem {
  id: string;
  account_id: string;
  user_id: string;
  type: PromptType;
  label: string;
  prompt_text: string;
  active: boolean;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}

export interface ContentIdea {
  id: string;
  account_id: string;
  user_id: string;
  idea: Record<string, unknown>;
  source_prompt_id: string | null;
  normalized_hash: string;
  status: string;
  created_at: string;
}

export interface Post {
  id: string;
  account_id: string;
  user_id: string;
  idea_id: string | null;
  headline: string | null;
  lines: string[];
  caption: string | null;
  hashtags: string[];
  image_url: string | null;
  status: PostStatus;
  qa_score: number | null;
  qa_reasons: string[];
  ig_media_id: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  regen_attempts: number;
  origin: PostOrigin;
  created_at: string;
}

export interface PostMetric {
  id: string;
  post_id: string;
  user_id: string;
  likes: number | null;
  reach: number | null;
  saves: number | null;
  comments: number | null;
  fetched_at: string;
}

/** Strict shape returned by the content-generation stage (DeepSeek). */
export interface GeneratedContent {
  headline: string;
  lines: string[];
  caption: string;
  hashtags: string[];
}

/** Verdict returned by the quality gate (Stage 4). */
export interface QualityVerdict {
  pass: boolean;
  reasons: string[];
  score: number;
}
