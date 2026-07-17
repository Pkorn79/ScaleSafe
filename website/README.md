# ScaleSafe website

Source-controlled public website for `https://scalesafe.app`.

The application remains at `https://dashboard.scalesafe.app`. The website is a
separate Astro build intended for Cloudflare Pages. GoHighLevel continues to own
lead capture, calendars, and follow-up workflows.

## Local development

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm run build
```

Cloudflare Pages should use `website` as the root directory, `npm run build` as
the build command, and `dist` as the output directory.
