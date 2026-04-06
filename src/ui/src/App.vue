<script setup lang="ts">
import { ssoSession } from './composables/useApi';
import {
  LayoutDashboard, Package, Users, CreditCard,
  Shield, Activity, Settings, ChevronRight,
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

  <!-- SSO failed — friendly error page -->
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
    <nav class="w-[200px] bg-slate-900 text-white py-5 flex-shrink-0">
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
      <router-link to="/defense/dashboard" class="nav-link nav-sub" :class="{ 'nav-active': $route.path.startsWith('/defense/dashboard') || $route.path.startsWith('/defense/disputes') || $route.path.startsWith('/defense/prevention') }">
        <Activity :size="14" /> Health Dashboard
      </router-link>
      <router-link to="/settings" class="nav-link" :class="{ 'nav-active': $route.name === 'settings' }">
        <Settings :size="16" /> Settings
      </router-link>
      <router-link to="/settings/payments" class="nav-link nav-sub" :class="{ 'nav-active': $route.name === 'settings-payments' }">
        <ChevronRight :size="14" /> Payments
      </router-link>
    </nav>
    <main class="flex-1 p-6 overflow-y-auto bg-slate-50">
      <router-view />
    </main>
  </div>
</template>

<style>
/* ── Base reset + font ──────────────────────────────── */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  color: #1a1a2e;
  background: #f8fafc;
}

/* ── Nav links ──────────────────────────────────────── */
.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 20px;
  color: #94a3b8;
  text-decoration: none;
  font-size: 14px;
  transition: all 0.15s;
}
.nav-link:hover { color: #fff; background: rgba(255,255,255,0.06); }
.nav-active { color: #fff !important; background: #3b82f6 !important; }
.nav-sub { padding-left: 36px; font-size: 13px; }

/* ── Shared component styles (used by all views) ───── */
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 20px;
  color: #0f172a;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  margin-bottom: 16px;
  border: 1px solid #f1f5f9;
}

.card-title {
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
}

.grid { display: grid; gap: 16px; }
.grid-4 { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.grid-2 { grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  text-decoration: none;
}

.btn-primary { background: #3b82f6; color: #fff; }
.btn-primary:hover { background: #2563eb; }
.btn-secondary { background: #f1f5f9; color: #374151; border: 1px solid #e2e8f0; }
.btn-secondary:hover { background: #e2e8f0; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { background: #dc2626; }
.btn-success { background: #10b981; color: #fff; }
.btn-success:hover { background: #059669; }
.btn-sm { padding: 5px 10px; font-size: 12px; }

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.badge-green { background: #d1fae5; color: #065f46; }
.badge-yellow { background: #fef3c7; color: #92400e; }
.badge-red { background: #fee2e2; color: #991b1b; }
.badge-blue { background: #dbeafe; color: #1e40af; }
.badge-gray { background: #f1f5f9; color: #475569; }

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th, .table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
}

.table th {
  color: #94a3b8;
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table tr:hover td { background: #f8fafc; }

.form-group { margin-bottom: 16px; }

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 4px;
}

.form-input, .form-select, .form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}

.form-input:focus, .form-select:focus, .form-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}

.form-textarea { min-height: 80px; resize: vertical; }

.loading {
  color: #94a3b8;
  padding: 40px;
  text-align: center;
  font-size: 14px;
}

.error-msg {
  color: #dc2626;
  background: #fef2f2;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
  border: 1px solid #fecaca;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #94a3b8;
}

.score-bar {
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 4px;
}

.score-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.flex { display: flex; }
.flex-between { display: flex; justify-content: space-between; align-items: center; }
.gap-2 { gap: 8px; }
.gap-4 { gap: 16px; }
.mt-2 { margin-top: 8px; }
.mt-4 { margin-top: 16px; }
.mb-4 { margin-bottom: 16px; }
.text-sm { font-size: 13px; }
.text-muted { color: #64748b; }

@keyframes spin { to { transform: rotate(360deg); } }
.animate-spin { animation: spin 0.8s linear infinite; }
</style>
