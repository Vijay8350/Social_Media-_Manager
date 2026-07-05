# Meta App Review — submission checklist

The app runs in **development mode** today: only the app owner and added
testers/roles can connect and post. To let the public connect their Instagram
accounts, submit for App Review and request Advanced Access to the permissions.

## Permissions to request (Advanced Access)
- `instagram_basic`
- `instagram_content_publish`
- `pages_show_list`
- `pages_read_engagement`
- `business_management`
- `instagram_manage_insights` (for analytics, if used)

> While in dev mode these work for app roles (admin/developer/tester) with
> Standard Access — no review needed to test with your own accounts.

## Prerequisites
- [ ] **Business verification** completed (Meta Business Manager).
- [ ] **Privacy Policy URL:** https://social.apanjob.com/privacy
- [ ] **Terms of Service URL:** https://social.apanjob.com/terms
- [ ] **Data Deletion** — instructions https://social.apanjob.com/data-deletion
      and/or callback https://social.apanjob.com/api/data-deletion
- [ ] **Valid OAuth Redirect URI:** https://social.apanjob.com/api/instagram/callback
- [ ] **App Domains:** apanjob.com
- [ ] App icon, category, and contact email (derik6013@gmail.com) set.

## Per-permission submission
For each requested permission provide:
- [ ] A clear description of how the app uses it.
- [ ] **Screencast** showing the full flow: Facebook Login → grant permissions →
      connect an IG Business account → generate → publish a post → view insights.
- [ ] Step-by-step reviewer instructions + a test account (or role) to reproduce.

## Notes
- Instagram accounts must be **Business or Creator** and linked to a Facebook Page.
- Publishing uses the official **Instagram Graph API — Content Publishing** only
  (create media container → publish). No browser automation / private APIs.
- Rate limit respected: ≤25 published posts / account / 24h with backoff.
- The codebase is **not gated** on review — dev-mode + tester accounts work now.
