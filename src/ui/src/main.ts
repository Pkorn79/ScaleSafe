import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import { installStaleBundleRecovery } from './lib/staleBundleRecovery';
import './style.css';

installStaleBundleRecovery(window);
createApp(App).use(router).mount('#app');
