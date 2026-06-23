import { z } from "zod";

/**
 * Server-side environment schema. Validated lazily so importing this module in a
 * context that only needs a subset of vars (e.g. the web app vs the worker)
 * doesn't throw until the values are actually read.
 *
 * NEXT_PUBLIC_* vars are read directly in client components by Next.js (inlined
 * at build time); they are included here only for server-side reads.
 */
const serverEnvSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

  // DeepSeek (text)
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  // Gemini (image + vision)
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_IMAGE_MODEL: z.string().default("gemini-2.5-flash-image"),
  GEMINI_VISION_MODEL: z.string().default("gemini-2.5-flash"),

  // Meta / Instagram
  FACEBOOK_APP_ID: z.string().min(1).optional(),
  FACEBOOK_APP_SECRET: z.string().min(1).optional(),
  FACEBOOK_OAUTH_REDIRECT_URI: z.string().url().optional(),
  FACEBOOK_GRAPH_VERSION: z.string().default("v21.0"),

  // Redis
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  // Stripe (M9)
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  // Security / pipeline
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  MAX_REGEN_ATTEMPTS: z.coerce.number().int().positive().default(3),

  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Parse and cache server env. Throws a readable error if required vars are missing. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
