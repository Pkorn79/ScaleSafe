import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/offers', name: 'offers', component: () => import('./views/OffersView.vue') },
  { path: '/offers/new', name: 'offer-new', component: () => import('./views/OfferFormView.vue') },
  { path: '/offers/:id/edit', name: 'offer-edit', component: () => import('./views/OfferFormView.vue') },
  { path: '/clients', name: 'clients', component: () => import('./views/ClientsView.vue') },
  { path: '/clients/:contactId', name: 'client-detail', component: () => import('./views/ClientDetailView.vue') },
  { path: '/defense', name: 'defense', component: () => import('./views/DefenseView.vue') },
  { path: '/risk-health', name: 'risk-health', component: () => import('./views/StripeRiskHealth.vue') },
  { path: '/defense/disputes', name: 'dispute-management', component: () => import('./views/DisputeManagement.vue') },
  { path: '/defense/prevention', name: 'prevention-checklist', component: () => import('./views/PreventionChecklist.vue') },
  { path: '/defense/:id', name: 'defense-detail', component: () => import('./views/DefenseDetailView.vue') },
  { path: '/payments', name: 'payment-search', component: () => import('./views/PaymentSearch.vue') },
  { path: '/payments/:contactId', name: 'payment-management', component: () => import('./views/PaymentManagement.vue'), props: true },
  { path: '/roadmap', name: 'roadmap', component: () => import('./views/RoadmapView.vue') },
  { path: '/roadmap/:id', name: 'feature-preview', component: () => import('./views/FeaturePreviewView.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
  { path: '/settings/payments', name: 'settings-payments', component: () => import('./views/SettingsPayments.vue') },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
