# Changelog

All notable changes to ScaleSafe are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## 2026-04-02

### Fixed
- T&C logic now additive: URL + clickwrap clauses show together, not either/or (4463ec7)
- Enrollment preview page shows program duration, refund policy, and compiled T&C (4463ec7)
- Provisioning recovery: snapshot error shown in UI, retry button, auto-retry on page load (4463ec7)
- Custom value provisioning checks by known ID instead of name — works for fresh installs and v1 migrations (db0c140)

### Added
- Logo file upload to Supabase Storage with preview thumbnail (4463ec7)
- `POST /api/merchants/logo` endpoint with multer multipart handling (4463ec7)

### Security
- Removed leaked database URI (`supabase/.temp/pooler-url`) from repo, added to `.gitignore` (348833d)

## 2026-04-01

### Added
- Merchant onboarding configuration service — Phase 3: full config read/write, GHL custom value sync, T&C clause management, module toggles (7f13c3e)

### Fixed
- Offer configurator: delivery method dropdown, auto-calculated installment amount, T&C clauses moved to per-offer, milestone labels, program duration (ac95ba9)
- Offer form build failure from missing field references (013d229)

## 2026-03-31

### Fixed
- OAuth reinstall: handle snake_case `locationId` from GHL, add `user_type=Location` to token request (6541bed)
- OAuth for agency-level installs: resolve locationId via `/oauth/installedLocations` when GHL returns companyId only (1e34096)
- `installedLocations` 422 error: added required `appId` parameter (682b6d2)
- Location resolution: switched to `/locations/search` since `/oauth/installedLocations` requires unavailable appId (bdd0cc9)
- SSO for agency-level access: try multiple locationId field names, fall back to companyId merchant lookup (8063bb3)

### Added
- Diagnostic debug output to OAuth callback for Railway-free debugging (6f09e9a)

## 2026-03-28

### Fixed
- Merchant provisioning: corrected GHL v2 API endpoints (807fdc7)
- Custom fields endpoint: use `/locations/{locationId}/customFields` for contacts (0e2a016)

## 2026-03-27

### Added
- Merchant provisioning service: pipeline detection, custom fields, custom values, workflow triggers (6447281)
- Friendly error page when SSO/tenant context is missing (a2c66cf)

### Fixed
- OAuth callback to provision merchants + evidence getCounts null safety (984d9c8)
- Auth callback route double-prefix issue (`/auth/auth/callback`) (bd2fb39)
- SSO auth: GHL sends `sso_key` (snake_case), not `ssoKey` (4fa18d8)
- SSO: switched to GHL postMessage handshake instead of query params (df065ce)
- Provisioning trigger, offer creation, and offer form completeness (20d1d6b)
- Provisioning trigger + public enrollment page (ea763e2)

### Changed
- Enrollment API refactored with improved error handling (b6de5e9)
- Offer form and provisioning features enhanced (9e6e23e)

## 2026-03-26

### Added
- ScaleSafe v2.1 complete backend + frontend build — all 6 phases (c7cbeda)
- Migration script, ran v2.1 migrations on Supabase (3901c67)
- Service-level tests for evidence, payment, defense, disengagement (eb20561)
- Railway deployment config: Dockerfile + railway.json (70f7e9c)

### Fixed
- `/auth/callback` route was double-prefixed (7f5240f)

### Security
- Removed exposed credentials from archived docs (a04be2f)

## 2026-03-24

### Added
- Initial context package and setup guide for Node.js app build (f9854ea)
