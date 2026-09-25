// Loopback-only preview: fictional contacts and simulated sends. No provider or database access.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');

async function main() {
  const root = path.resolve(__dirname, '../src/ui');
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const { default: vue } = await import(pathToFileURL(path.join(root, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
  const app = express();
  const sends = [];
  const contacts = Array.from({ length: 23 }, (_, index) => ({
    id: `fictional-${index + 1}`, name: `Alex Example ${index + 1}`, firstName: 'Alex', lastName: `Example ${index + 1}`,
    email: index === 1 ? '' : `alex${index + 1}@example.com`, phone: `+1555555${String(index + 1).padStart(4, '0')}`,
  }));
  const offer = { id: 'fictional-offer', offer_name: 'Fictional Program', active: true, price: 10, payment_type: 'one_time', processor_override: 'stripe' };
  app.use(express.json());
  app.get('/__preview', (_req, res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Send Offer - Fictional Preview</title></head><body style="margin:0"><iframe id="app" title="ScaleSafe fictional preview" src="/#/offers" style="border:0;width:100%;height:100vh"></iframe><script>
    window.addEventListener('message', event => {
      const frame = document.getElementById('app');
      if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.message === 'REQUEST_USER_DATA') {
        frame.contentWindow.postMessage({ message: 'REQUEST_USER_DATA_RESPONSE', payload: 'fictional-preview-only' }, location.origin);
      }
    });
  </script></body></html>`));
  app.post('/auth/sso', (_req, res) => res.json({ locationId: 'fictional-location', userId: 'fictional-user', role: 'admin', userName: 'Preview' }));
  app.get('/api/offers', (_req, res) => res.json([offer]));
  app.get('/api/enrollment/contacts/search', (req, res) => {
    const query = String(req.query.q || '').toLowerCase();
    const page = Number(req.query.page || 1);
    if (query === 'error') return res.status(502).json({ error: 'Fictional HighLevel outage. Please retry.' });
    const results = contacts.filter(contact => `${contact.name} ${contact.email} ${contact.phone}`.toLowerCase().includes(query));
    const respond = () => res.json({ contacts: results.slice((page - 1) * 20, page * 20), page, hasMore: page * 20 < results.length });
    setTimeout(respond, query === 'alex' ? 700 : 20);
  });
  app.post('/api/enrollment/send-link', (req, res) => {
    sends.push(req.body);
    res.json({ success: true, contactId: req.body.contactId || 'fictional-new', sentVia: req.body.sendVia });
  });
  app.get('/__preview/sends', (_req, res) => res.json(sends));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unavailable in fictional preview' }));
  app.use('/auth', (_req, res) => res.status(404).json({ error: 'Unavailable in fictional preview' }));
  const vite = await createServer({ configFile: false, root, plugins: [vue()], server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
  const server = app.listen(4391, '127.0.0.1', () => console.log('Fictional preview: http://127.0.0.1:4391/__preview'));
  const close = async () => { server.close(); await vite.close(); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
