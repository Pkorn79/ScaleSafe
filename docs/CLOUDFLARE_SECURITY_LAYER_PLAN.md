# Cloudflare Security Layer Plan

## Goal

Put Cloudflare in front of the ScaleSafe dashboard/API without breaking GHL iframes, NMI/Stripe/GHL webhooks, public checkout, payment update, terms, or milestone signoff links.

## Recommended Setup

### DNS and TLS

- Proxy `dashboard.scalesafe.app` through Cloudflare.
- Keep Railway as the origin.
- Use Full Strict TLS.
- Keep Always Use HTTPS enabled.
- Keep HSTS off until the proxy has been stable for at least one week.

### Origin Protection

- Prefer locking Railway origin access to Cloudflare IPs if Railway/network setup allows it.
- If IP allowlisting is not practical, keep all webhook signature/token checks active in the app.
- Do not rely on Cloudflare alone for webhook authentication.

### WAF Rules

- Block obvious attack traffic for:
  - SQL injection patterns
  - XSS/script injection patterns
  - path traversal patterns
  - known malicious bots
- Challenge unusual countries only if it does not affect real merchant/client traffic.
- Do not challenge payment/webhook endpoints. Processors must be able to post without browser challenges.

### Rate Limits

Use Cloudflare rate limits as the outer shield. Keep the app rate limits as the inner shield.

- `/api/checkout/*`: strict limit, because this is public and payment-facing.
- `/payment-update*`: strict limit, because it accepts public action tokens.
- `/milestone-signoff*` and `/api/milestone-signoff/*`: moderate limit.
- `/webhooks/*`: high enough for bursts, but block abusive floods.
- `/api/debug/*`: very strict limit and only usable with `DEBUG_ADMIN_TOKEN`.
- `/health`: low or no challenge, because Railway may use it for health checks.

ScaleSafe also applies an inner app-level limiter to `/api/debug/*`. Cloudflare should still rate limit it at the edge, because Cloudflare blocks abusive traffic before it reaches Railway.

### Routes That Must Stay Bot-Friendly

Do not put interactive challenges on these:

- `/webhooks/nmi/*`
- `/webhooks/stripe/*`
- `/webhooks/ghl/*`
- `/api/checkout/*`
- `/payment-update*`
- `/subscription-cancel*`
- `/milestone-signoff*`
- `/widgets/*`
- `/terms/*`

### Security Headers

The app now sets these safe baseline headers:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Do not add `X-Frame-Options: DENY` or a restrictive `frame-ancestors` policy until GHL and merchant funnel embed domains are fully mapped. ScaleSafe must remain iframe-compatible.

### Logging to Watch After Enabling

For the first 24 hours, watch:

- NMI webhook delivery
- Stripe webhook delivery
- GHL workflow/webhook delivery
- checkout completion rate
- payment-update page loads
- milestone signoff page loads/submits
- `/api/debug/*` access attempts

## Rollout Order

1. Proxy DNS through Cloudflare.
2. Enable Full Strict TLS.
3. Enable basic WAF managed rules.
4. Add rate limits in log/simulate mode if available.
5. Watch live NMI/Stripe/GHL webhook delivery.
6. Turn rate limits to enforcement after webhooks are confirmed healthy.
7. Consider HSTS after one stable week.

## Do Not Do Yet

- Do not block all non-US traffic until merchant/client geography is known.
- Do not put CAPTCHA/challenges on webhooks or payment pages.
- Do not add strict iframe blocking headers yet.
- Do not trust Cloudflare as the only security control.
