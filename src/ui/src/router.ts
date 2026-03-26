import { createRouter, createWebHashHistory } from 'vue-router';

const routes = [
  { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
  { path: '/offers', name: 'offers', component: () => import('./views/OffersView.vue') },
  { path: '/offers/new', name: 'offer-new', component: () => import('./views/OfferFormView.vue') },
  { path: '/offers/:id/edit', name: 'offer-edit', component: () => import('./views/OfferFormView.vue') },
  { path: '/clients', name: 'clients', component: () => import('./views/ClientsView.vue') },
  { path: '/clients/:contactId', name: 'client-detail', component: () => import('./views/ClientDetailView.vue') },
  { path: '/defense', name: 'defense', component: () => import('./views/DefenseView.vue') },
  { path: '/defense/:id', name: 'defense-detail', component: () => import('./views/DefenseDetailView.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
