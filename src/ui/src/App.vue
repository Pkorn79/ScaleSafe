<script setup lang="ts">
import { ssoSession } from './composables/useApi';
</script>

<template>
  <!-- Loading state while SSO handshake completes -->
  <div v-if="!ssoSession.ready" class="sso-loading">
    <div class="sso-loading-inner">
      <div class="sso-spinner"></div>
      <p>Connecting to GoHighLevel...</p>
    </div>
  </div>

  <!-- SSO failed — friendly error page -->
  <div v-else-if="ssoSession.error || !ssoSession.locationId" class="sso-error">
    <div class="sso-error-card">
      <div class="sso-error-icon">!</div>
      <h1>Unable to Connect</h1>
      <p class="sso-error-detail">
        ScaleSafe couldn't verify your account with GoHighLevel.
        This usually means the app needs to be reinstalled.
      </p>
      <div class="sso-error-steps">
        <p><strong>To fix this:</strong></p>
        <ol>
          <li>Go to <strong>Settings &gt; Integrations</strong> in your GHL account</li>
          <li>Find ScaleSafe and click <strong>Uninstall</strong></li>
          <li>Reinstall ScaleSafe from the Marketplace</li>
        </ol>
      </div>
      <p class="sso-error-support">
        Still having trouble? Contact support at
        <a href="mailto:support@scalesafe.app">support@scalesafe.app</a>
      </p>
      <details class="sso-error-debug">
        <summary>Technical details</summary>
        <code>{{ ssoSession.error || 'No location context received' }}</code>
      </details>
    </div>
  </div>

  <!-- Normal app -->
  <div v-else class="app">
    <nav class="sidebar">
      <div class="logo">ScaleSafe</div>
      <router-link to="/" class="nav-item" :class="{ active: $route.name === 'dashboard' }">
        Dashboard
      </router-link>
      <router-link to="/offers" class="nav-item" :class="{ active: $route.path.startsWith('/offers') }">
        Offers
      </router-link>
      <router-link to="/clients" class="nav-item" :class="{ active: $route.path.startsWith('/clients') }">
        Clients
      </router-link>
      <router-link to="/defense" class="nav-item" :class="{ active: $route.path.startsWith('/defense') }">
        Defense
      </router-link>
      <router-link to="/settings" class="nav-item" :class="{ active: $route.name === 'settings' }">
        Settings
      </router-link>
    </nav>
    <main class="content">
      <router-view />
    </main>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #1a1a2e;
  background: #f5f6fa;
}

.app {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 200px;
  background: #1a1a2e;
  color: #fff;
  padding: 20px 0;
  flex-shrink: 0;
}

.logo {
  font-size: 20px;
  font-weight: 700;
  padding: 0 20px 20px;
  border-bottom: 1px solid #2d2d50;
  margin-bottom: 10px;
}

.nav-item {
  display: block;
  padding: 12px 20px;
  color: #a0a0c0;
  text-decoration: none;
  font-size: 14px;
  transition: all 0.15s;
}

.nav-item:hover { color: #fff; background: #2d2d50; }
.nav-item.active { color: #fff; background: #3b82f6; }

.content {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
}

/* Shared component styles */
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 20px;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  margin-bottom: 16px;
}

.card-title {
  font-size: 14px;
  color: #6b7280;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
}

.grid { display: grid; gap: 16px; }
.grid-4 { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.grid-2 { grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); }

.btn {
  display: inline-flex;
  align-items: center;
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
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; }
.btn-danger { background: #ef4444; color: #fff; }
.btn-danger:hover { background: #dc2626; }
.btn-success { background: #10b981; color: #fff; }
.btn-success:hover { background: #059669; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

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
.badge-gray { background: #f3f4f6; color: #374151; }

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th, .table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 14px;
}

.table th {
  color: #6b7280;
  font-weight: 500;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table tr:hover td { background: #f9fafb; }

.form-group {
  margin-bottom: 16px;
}

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
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

.form-input:focus, .form-select:focus, .form-textarea:focus {
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}

.form-textarea { min-height: 80px; resize: vertical; }

.loading {
  color: #6b7280;
  padding: 40px;
  text-align: center;
}

.error-msg {
  color: #dc2626;
  background: #fee2e2;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #9ca3af;
}

.score-bar {
  height: 8px;
  background: #e5e7eb;
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
.text-muted { color: #6b7280; }

/* SSO Loading */
.sso-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f5f6fa;
}

.sso-loading-inner {
  text-align: center;
  color: #6b7280;
  font-size: 15px;
}

.sso-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  margin: 0 auto 16px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* SSO Error */
.sso-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f5f6fa;
  padding: 24px;
}

.sso-error-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  max-width: 480px;
  width: 100%;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  text-align: center;
}

.sso-error-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fee2e2;
  color: #dc2626;
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
}

.sso-error-card h1 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #1a1a2e;
}

.sso-error-detail {
  color: #6b7280;
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 20px;
}

.sso-error-steps {
  text-align: left;
  background: #f9fafb;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 20px;
  font-size: 14px;
  color: #374151;
}

.sso-error-steps p { margin-bottom: 8px; }

.sso-error-steps ol {
  margin: 0;
  padding-left: 20px;
}

.sso-error-steps li {
  margin-bottom: 4px;
  line-height: 1.5;
}

.sso-error-support {
  font-size: 13px;
  color: #9ca3af;
  margin-bottom: 16px;
}

.sso-error-support a {
  color: #3b82f6;
  text-decoration: none;
}

.sso-error-debug {
  text-align: left;
  font-size: 12px;
  color: #9ca3af;
}

.sso-error-debug summary {
  cursor: pointer;
  margin-bottom: 4px;
}

.sso-error-debug code {
  display: block;
  background: #f3f4f6;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 11px;
  word-break: break-all;
  color: #6b7280;
}
</style>
