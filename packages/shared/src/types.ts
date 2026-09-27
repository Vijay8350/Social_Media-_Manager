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
  posting_slots: string[]; // ["08:00","20:30"]
  autonomous: boolean;
  updated_at: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "done";

export interface Campaign {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  topic: string | null;
  goal: string | null;
  tone: string | null;
  per_day: number;
  days: number;
  prompt: string | null;
  reference_images: string[];
  status: CampaignStatus;
  posts_target: number;
  posts_done: number;
  created_at: string;
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

/** What a Business DNA was built from (shown in the UI; no raw content stored). */
export interface BusinessDnaSources {
  instagram?: {
    username: string | null;
    posts_analyzed: number;
    followers: number | null;
    error?: string;
  };
  website?: { url: string; pages: string[]; error?: string };
}

/**
 * Business DNA — a per-account business profile auto-built (DeepSeek) from the
 * account's Instagram profile + captions and its website. Editable; when
 * `use_in_generation` is on it conditions text generation alongside Account DNA.
 */
export interface BusinessDna {
  id: string;
  account_id: string;
  user_id: string;
  business_name: string | null;
  website_url: string | null;
  summary: string | null;
  industry: string | null;
  offerings: string[];
  usps: string[];
  target_customers: string | null;
  brand_voice: string | null;
  tone: string | null;
  brand_values: string[];
  key_messages: string[];
  content_themes: string[];
  ctas: string[];
  keywords: string[];
  visual_cues: string | null;
  language: string | null;
  dos: string[];
  donts: string[];
  use_in_generation: boolean;
  sources: BusinessDnaSources;
  generated_at: string | null;
  updated_at: string;
}

/** Comments: how replies are sent for an account. */
export type CommentReplyMode = "off" | "review" | "auto";
export type CommentVerdict = "positive" | "question" | "neutral" | "bad";
export type CommentStatus =
  | "new"
  | "draft"
  | "replying"
  | "replied"
  | "done"
  | "flagged"
  | "approved"
  | "reviewed"
  | "deleted"
  | "error";

/** Per-account comment automation settings (no row = not monitored). */
export interface CommentSettings {
  account_id: string;
  user_id: string;
  reply_mode: CommentReplyMode;
  auto_hide: boolean;
  daily_reply_limit: number;
  last_checked_at: string | null;
  last_error: string | null;
  updated_at: string;
}

/** A top-level comment on one of the account's posts, with its AI review. */
export interface IgComment {
  id: string;
  account_id: string;
  user_id: string;
  ig_comment_id: string;
  ig_media_id: string;
  media_permalink: string | null;
  media_caption: string | null;
  author: string | null;
  text: string;
  commented_at: string | null;
  verdict: CommentVerdict | null;
  category: string | null;
  reason: string | null;
  confidence: number | null;
  status: CommentStatus;
  hidden: boolean;
  reply_text: string | null;
  reply_ig_id: string | null;
  replied_at: string | null;
  reviewed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
