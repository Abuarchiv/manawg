## Context

See `proposal.md` for motivation. Supabase is the account authority; `wg_members.auth_user_id` is the only membership binding. Google and email are enabled in production; phone, Apple, and Facebook are disabled. The public-entry worktree separately protects private WG HTML and makes the app browsable before an explicit create or join action.

## Goals / Non-Goals

**Goals:**

- Reuse the existing Supabase browser client and safe return-path handling for Google, email/password, and SMS OTP.
- Preserve a requested create or join action across authentication without automatically writing a WG or membership.
- Show honest confirmation, failure, and unavailable states without exposing whether an email address has an account.
- Keep passwords, OTPs, Supabase tokens, and local legacy recovery material out of URLs, drafts, and analytics.
- Provide password recovery through a safe, hosted-testable callback before broad password-only promotion.

**Non-Goals:**

- No new local identity, account matching by name/email, database migration, or provider dashboard mutation.
- No automatic legacy-member claiming. Recovery remains an explicit Supabase-authenticated action with the existing proof requirement.
- No automatic account linking or provider promotion; password reset is included here as a release-gated recovery path.

## Decisions

1. Use `signUp` and `signInWithPassword` for email, and `signInWithOtp` plus `verifyOtp` for phone. The existing browser client owns the resulting cookie session; no custom auth service or dependency is added.
2. Render Google as the single social choice. Apple and Facebook are not shown because their disabled provider settings make a visible option misleading. Phone remains a real flow with a clear unavailable error until Supabase configuration is complete.
3. Carry intent only as a validated relative `/neu` path using the existing safe-next primitive. After authentication the client reloads account membership state; it never calls create or join automatically.
4. Treat private WG layout membership checks and the service-worker public-document allowlist as prerequisites for this auth slice. Credential choice cannot be a security boundary on its own.
5. Request password recovery through Supabase with a neutral response, constrain the callback to `/auth/reset`, and allow a password update only after Supabase establishes a session. Reset never carries WG intent or performs a WG write.

## Risks / Trade-offs

- [Phone provider, SMS delivery, SMTP, CAPTCHA, limits, or redirects are unconfigured] -> Do not declare the respective flow released; enable and test it only with authorized Supabase dashboard changes.
- [Email confirmation leaves no immediate session] -> Show a neutral confirmation state and require the user to return after verification.
- [Unlinked legacy memberships lose their private route] -> Provide an explicit proof-based recovery path outside private WG rendering before merging the strict membership guard.
- [Reset delivery or callback configuration is incomplete] -> Keep password promotion behind the hosted reset gate and show only neutral request/error states.

## Migration Plan

Deploy the public-entry privacy boundary and credential UI together to a protected preview. Configure redirect URLs, production SMTP, phone/SMS delivery, rate limits, and CAPTCHA separately under explicit authority. Run real Supabase browser tests for create, invite, confirmation, incorrect credentials, OTP, logout/account switching, and non-member access before production promotion. Revert the UI and public-entry code together; provider configuration and existing users remain unchanged.
