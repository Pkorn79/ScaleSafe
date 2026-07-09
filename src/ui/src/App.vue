<script setup lang="ts">
import { ssoSession, selectSsoLocation } from './composables/useApi';
import ToastContainer from './components/ToastContainer.vue';
import {
  LayoutDashboard, Package, Users, CreditCard,
  Shield, Activity, Settings, ChevronRight, Map,
} from 'lucide-vue-next';
</script>

<template>
  <!-- Loading state while SSO handshake completes -->
  <div v-if="!ssoSession.ready" class="flex items-center justify-center min-h-screen bg-slate-50">
    <div class="text-center text-slate-500 text-sm">
      <div class="w-9 h-9 border-3 border-slate-200 border-t-ss-primary-500 rounded-full mx-auto mb-4 animate-spin"></div>
      <p>Connecting to GoHighLevel...</p>
    </div>
  </div>

  <!-- Agency-level launch - choose which installed sub-account to open -->
  <div
    v-else-if="!ssoSession.locationId && ssoSession.locationOptions.length > 0"
    class="flex items-center justify-center min-h-screen bg-slate-50 p-6"
  >
    <div class="bg-white rounded-xl p-10 max-w-lg w-full shadow-sm">
      <h1 class="text-xl font-semibold text-slate-900 mb-2">Choose Sub-Account</h1>
      <p class="text-slate-500 text-sm leading-relaxed mb-5">
        GoHighLevel opened ScaleSafe from the agency view instead of a specific sub-account. Choose the account you intended to open.
      </p>
      <div class="space-y-2">
        <button
          v-for="location in ssoSession.locationOptions"
          :key="location.locationId"
          type="button"
          class="w-full text-left rounded-lg border border-slate-200 bg-white p-4 hover:border-ss-primary-500 hover:bg-ss-primary-50 disabled:opacity-60"
          :disabled="ssoSession.selectingLocation"
          @click="selectSsoLocation(location.locationId)"
        >
          <div class="font-semibold text-slate-900">{{ location.name || 'ScaleSafe sub-account' }}</div>
          <div class="text-xs text-slate-400 mt-1">{{ location.locationId }}</div>
        </button>
      </div>
      <p v-if="ssoSession.selectingLocation" class="text-sm text-slate-500 mt-4">Opening ScaleSafe...</p>
      <p v-if="ssoSession.error" class="text-sm text-red-600 mt-4">{{ ssoSession.error }}</p>
    </div>
  </div>

  <!-- SSO failed - friendly error page -->
  <div v-else-if="ssoSession.error || !ssoSession.locationId" class="flex items-center justify-center min-h-screen bg-slate-50 p-6">
    <div class="bg-white rounded-xl p-10 max-w-md w-full shadow-sm text-center">
      <div class="w-12 h-12 rounded-full bg-red-50 text-red-600 text-2xl font-bold flex items-center justify-center mx-auto mb-4">!</div>
      <h1 class="text-xl font-semibold text-slate-900 mb-2">Unable to Connect</h1>
      <p class="text-slate-500 text-sm leading-relaxed mb-5">
        ScaleSafe couldn't verify your account with GoHighLevel.
        This usually means the app needs to be reinstalled.
      </p>
      <div class="text-left bg-slate-50 rounded-lg p-4 mb-5 text-sm text-slate-700">
        <p class="mb-2"><strong>To fix this:</strong></p>
        <ol class="pl-5 space-y-1 list-decimal">
          <li>Go to <strong>Settings &gt; Integrations</strong> in your GHL account</li>
          <li>Find ScaleSafe and click <strong>Uninstall</strong></li>
          <li>Reinstall ScaleSafe from the Marketplace</li>
        </ol>
      </div>
      <p class="text-xs text-slate-400 mb-4">
        Still having trouble? Contact support at
        <a href="mailto:support@scalesafe.app" class="text-ss-primary-500 no-underline">support@scalesafe.app</a>
      </p>
      <details class="text-left text-xs text-slate-400">
        <summary class="cursor-pointer mb-1">Technical details</summary>
        <code class="block bg-slate-100 p-2 rounded text-[11px] break-all text-slate-500">{{ ssoSession.error || 'No location context received' }}</code>
      </details>
    </div>
  </div>

  <!-- Normal app -->
  <div v-else class="flex min-h-screen">
    <nav class="w-[200px] h-screen sticky top-0 overflow-y-auto bg-slate-900 text-white py-5 flex-shrink-0">
      <div class="text-lg font-bold px-5 pb-5 border-b border-slate-700 mb-2">ScaleSafe</div>

      <router-link to="/" class="nav-link" :class="{ 'nav-active': $route.name === 'dashboard' }">
        <LayoutDashboard :size="16" /> Dashboard
      </router-link>
      <router-link to="/offers" class="nav-link" :class="{ 'nav-active': $route.path.startsWith('/offers') }">
        <Package :size="16" /> Offers
      </router-link>
      <router-link to="/clients" class="nav-link" :class="{ 'nav-active': $route.path.startsWith('/clients') }">
        <Users :size="16" /> Clients
      </router-link>
      <router-link to="/payments" class="nav-link" :class="{ 'nav-active': $route.path.startsWith('/payments') }">
        <CreditCard :size="16" /> Payments
      </router-link>
      <router-link to="/defense" class="nav-link" :class="{ 'nav-active': $route.path === '/defense' }">
        <Shield :size="16" /> Defense
      </router-link>
      <router-link to="/roadmap" class="nav-link" :class="{ 'nav-active': $route.path.startsWith('/roadmap') }">
        <Map :size="16" /> Roadmap
      </router-link>
      <router-link to="/risk-health" class="nav-link nav-sub" :class="{ 'nav-active': $route.path === '/risk-health' }">
        <Activity :size="14" /> Stripe Risk Health
      </router-link>
      <router-link to="/settings" class="nav-link" :class="{ 'nav-active': $route.name === 'settings' }">
        <Settings :size="16" /> Settings
      </router-link>
      <router-link to="/settings/payments" class="nav-link nav-sub" :class="{ 'nav-active': $route.name === 'settings-payments' }">
        <ChevronRight :size="14" /> Payments
      </router-link>
    </nav>
    <main class="flex-1 overflow-y-auto bg-slate-50">
      <div class="page-shell">
        <!-- #22/#26: key by full path so a param-only navigation (e.g. /clients/A -> /clients/B,
             or one payment-management contact -> another) remounts the view and reloads data,
             instead of showing the previously viewed client on a money-handling screen. -->
        <router-view :key="$route.fullPath" />
      </div>
    </main>
  </div>

  <!-- Global toast notifications (teleports to body; rendered in every app state) -->
  <ToastContainer />
</template>

<style>
/*
 * Global utility layer - used by every view.
 * Brand tokens are defined in src/ui/src/style.css (:root). This file consumes them.
 * Phase 4a (brand-systematization workstream): repointed to brand tokens -
 *   .btn-primary  blue  → emerald (engagement CTA)
 *   .nav-active   blue  → teal    (sidebar active state)
 *   .form-input   blue  → emerald (focus ring)
 *   body bg       slate → cream
 */

/* -- Base reset --------------------------------------- */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: var(--ss-navy-800);
  background: var(--ss-cream-50);
}

h1, h2, h3, h4 {
  font-family: 'Manrope', 'Inter', system-ui, sans-serif;
  letter-spacing: -0.01em;
}

/* -- Page shell - content gutter (no max-width cap) ------------ */
/* Padding stays small (~1/3 inch desktop) so content sits close to the sidebar
   without touching it. No max-width: wide screens use the full available width. */
.page-shell {
  padding: 32px 32px;
}
@media (max-width: 1024px) {
  .page-shell { padding: 24px 24px; }
}
@media (max-width: 640px) {
  .page-shell { padding: 20px 16px; }
}

/* -- Sidebar nav -------------------------------------- */
.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  color: var(--ss-navy-400);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
  border-left: 3px solid transparent;
}
.nav-link svg { flex-shrink: 0; }
.nav-link:hover { color: #fff; background: rgba(255,255,255,0.06); }
.nav-active {
  color: #fff !important;
  background: rgba(20, 184, 166, 0.15) !important;
  border-left-color: var(--ss-teal-500) !important;
}
.nav-sub { padding-left: 36px; font-size: 13px; }

.nav-badge {
  margin-left: auto;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.18);
  color: #fecaca;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

/* -- Page title --------------------------------------- */
.page-title {
  font-family: 'Manrope', 'Inter', sans-serif;
  font-size: 26px;
  font-weight: 700;
  margin-bottom: 20px;
  color: var(--ss-navy-900);
  letter-spacing: -0.02em;
}

/* -- Card - white surface with subtle lift ------------ */
.card {
  background: #fff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  margin-bottom: 16px;
  border: 1px solid var(--ss-navy-200);
}

.card-title {
  font-size: 11px;
  color: var(--ss-navy-500);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.card-value {
  font-family: 'Manrope', 'Inter', sans-serif;
  font-size: 30px;
  font-weight: 700;
  color: var(--ss-navy-900);
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.grid { display: grid; gap: 16px; }
.grid-4 { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.grid-2 { grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); }

/* -- Buttons - brand primary is emerald, pill shape -- */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: 9999px;            /* pill */
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  text-decoration: none;
  white-space: nowrap;
  user-select: none;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.3); }

.btn-primary {
  /* emerald-700 so white text clears WCAG AA contrast (4.5:1); 500/600 fail. */
  background: var(--ss-primary-700);
  color: #fff;
  border-color: var(--ss-primary-700);
}
.btn-primary:hover:not(:disabled) {
  background: var(--ss-primary-800);
  border-color: var(--ss-primary-800);
}

/* Funnel orange - top-of-funnel only (enrollment funnel, customer checkout). DO NOT use in-app. */
.btn-funnel {
  background: var(--ss-funnel-500);
  color: #fff;
  border-color: var(--ss-funnel-500);
}
.btn-funnel:hover:not(:disabled) {
  background: var(--ss-funnel-600);
  border-color: var(--ss-funnel-600);
}

.btn-secondary {
  background: transparent;
  color: var(--ss-primary-700);
  border: 1px solid var(--ss-primary-300);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--ss-primary-50);
  border-color: var(--ss-primary-500);
  color: var(--ss-primary-800);
}

/* Tertiary - text-only, used for low-emphasis links inline with text */
.btn-tertiary {
  background: transparent;
  color: var(--ss-primary-700);
  border-color: transparent;
}
.btn-tertiary:hover:not(:disabled) {
  background: var(--ss-primary-50);
  color: var(--ss-primary-800);
}

/* Destructive - red ghost. Cancel program, Archive, Delete, Disconnect. */
.btn-danger {
  background: transparent;
  color: #b91c1c;
  border: 1px solid #fecaca;
}
.btn-danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #ef4444;
  color: #991b1b;
}
.btn-danger:focus-visible { box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.25); }

/* Success - used in archived-list "Activate" action. Same as primary at the moment. */
.btn-success {
  /* emerald-700 for AA contrast with white text (mirrors .btn-primary). */
  background: var(--ss-primary-700);
  color: #fff;
  border-color: var(--ss-primary-700);
}
.btn-success:hover:not(:disabled) {
  background: var(--ss-primary-800);
  border-color: var(--ss-primary-800);
}

.btn-sm { padding: 5px 12px; font-size: 12px; }

/* -- Badges (pill-shaped status labels) --------------- */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.badge-green  { background: var(--ss-primary-50); color: var(--ss-primary-800); }
.badge-yellow { background: #fef3c7;              color: #92400e; }
.badge-red    { background: #fee2e2;              color: #991b1b; }
.badge-blue   { background: var(--ss-teal-50);    color: var(--ss-teal-700); }   /* repurposed: was blue, now teal accent - preserves "informational tone" semantics */
.badge-gray   { background: var(--ss-navy-100);   color: var(--ss-navy-600); }
.badge-orange { background: #ffedd5;              color: #9a3412; }   /* needs_review: attention-required, distinct from pending (yellow) and failed (red) */
.badge-purple { background: var(--ss-navy-100);   color: var(--ss-navy-700); }   /* deprecated; renamed to navy semantically. callers should migrate to badge-gray */

/* -- Tables ------------------------------------------- */
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th, .table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ss-navy-200);
  font-size: 14px;
}
.table th {
  color: var(--ss-navy-500);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.table tr:hover td { background: var(--ss-cream-50); }

/* -- Forms -------------------------------------------- */
.form-group { margin-bottom: 16px; }

.form-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--ss-navy-700);
  margin-bottom: 6px;
  letter-spacing: 0.01em;
}

/* Required-field asterisk - visually distinct red, not blended with label. */
.form-label-required::after {
  content: ' *';
  color: #dc2626;
  font-weight: 700;
}

.form-input, .form-select, .form-textarea {
  width: 100%;
  padding: 9px 13px;
  border: 1px solid var(--ss-navy-300);
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
  background: #fff;
}
.form-input:focus, .form-select:focus, .form-textarea:focus {
  border-color: var(--ss-primary-500);
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
}
.form-textarea { min-height: 80px; resize: vertical; }

/* -- Page-level states -------------------------------- */
.loading {
  color: var(--ss-navy-500);
  padding: 40px;
  text-align: center;
  font-size: 14px;
}

.error-msg {
  color: #991b1b;
  background: #fef2f2;
  padding: 12px 16px;
  border-radius: 12px;
  margin-bottom: 16px;
  font-size: 14px;
  border: 1px solid #fecaca;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--ss-navy-500);
}

/* -- Score bar (used by evidence readiness widgets) -- */
.score-bar {
  height: 8px;
  background: var(--ss-navy-200);
  border-radius: 9999px;
  overflow: hidden;
  margin-top: 4px;
}
.score-fill {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.3s;
}

/* -- Layout helpers ----------------------------------- */
.flex { display: flex; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-4 { margin-bottom: 16px; }
.text-sm { font-size: 13px; }
.text-muted { color: var(--ss-navy-500); }

@keyframes spin { to { transform: rotate(360deg); } }
.animate-spin { animation: spin 0.8s linear infinite; }
</style>
