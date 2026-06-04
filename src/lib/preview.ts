// Preview-only conveniences.
//
// VITE_PREVIEW is set at the Vercel "Preview" environment scope, so it's true
// only in preview deployments and never in production. Preview deployments are
// gated behind Vercel Authentication (anonymous requests get HTTP 401), so it's
// safe to ship preview-only behavior like auto-login here — the bundle is only
// ever served to the authenticated owner, not the public.
export const IS_PREVIEW = import.meta.env.VITE_PREVIEW === 'true';

// Optional owner credentials for preview auto-login (Preview-scoped env vars,
// never committed, never in the production bundle). When present, the app signs
// in automatically so reviewing a preview doesn't require typing the password.
export const PREVIEW_EMAIL = import.meta.env.VITE_PREVIEW_EMAIL as string | undefined;
export const PREVIEW_PASSWORD = import.meta.env.VITE_PREVIEW_PASSWORD as string | undefined;
