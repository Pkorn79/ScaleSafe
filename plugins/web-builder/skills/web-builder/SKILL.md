---
name: web-builder
description: Build, redesign, audit, verify, and publish polished business websites. Use when the user asks to create or improve a landing page, company site, product site, portfolio, event or workshop page, download or resource hub, documentation or support site, or another responsive web experience from a prompt, brand files, existing repository, or reference site.
---

# Web Builder

Build the smallest complete website that achieves the user's real goal. Make the process feel conversational and simple while doing the engineering, design, testing, and release work rigorously.

## Conversation contract

- Keep replies short, plain, and outcome-focused.
- Ask exactly one question for exactly one missing fact at a time only when the answer materially changes the build and cannot be inferred from supplied files or context. Never bundle two requested facts into one sentence.
- When the brief is usable, begin inspecting and building instead of conducting a long interview.
- Explain costs, credentials, blockers, and external actions before they matter. Do not narrate routine implementation details.
- Present options only when the choice has a meaningful tradeoff. Recommend one.

## Modes

- **Discover:** Turn a rough idea into a small site brief.
- **Build:** Create the approved site or page.
- **Improve:** Make scoped changes to an existing site.
- **Audit:** Inspect content, layout, accessibility, performance, and release readiness without changing files.
- **Publish:** Deploy a verified build after explicit approval.

If the user does not name a mode, infer it from the request. Building or editing files is allowed when requested. Publishing, submitting forms, changing DNS, creating paid services, and changing access require action-time approval.

## 1. Preflight

1. Detect the host and actual callable capabilities: filesystem, shell, browser, image generation, source control, and deployment tools.
2. Inspect the current folder before choosing a stack. Read the package manifest, existing routes, styles, assets, hosting configuration, and git status.
3. Preserve unrelated changes. Never reset, replace, or reformat work outside the requested surface.
4. For an existing site, follow its framework, components, tokens, and deployment model.
5. For a new site, choose the lightest maintainable option that supports the goal. Prefer a static site for informational pages; Astro is a strong default when a build system is useful.
6. Read [platform-routing.md](references/platform-routing.md) when tool availability, Claude/Codex surfaces, or browser control affects execution.

Do not claim a browser, connector, image tool, login, hosting account, or deployment path is available until it is detected.

## 2. Scope the site

Read [intake-and-scope.md](references/intake-and-scope.md). Use supplied context first. Ask only for the highest-value missing decision.

Default a quick business build to:

- one primary audience;
- one primary action;
- one to five pages;
- real supplied content and assets;
- static output unless the requested behavior needs a server;
- responsive desktop and mobile layouts;
- a clear handoff and release report.

Record the working brief using [site-brief-template.md](assets/site-brief-template.md) when the build is more than a narrow edit. Do not force the user to fill out the template.

## 3. Choose the page pattern

Read [page-patterns.md](references/page-patterns.md) for the requested site type. Build the actual experience as the first screen:

- A business or offer site leads with the business, offer, or literal category.
- A download hub leads with the downloadable products and clear platform choices.
- A tool or application opens to the working interface, not a marketing page.
- A support or documentation site opens to navigation and answers.

Do not invent testimonials, customer counts, certifications, pricing, guarantees, case-study results, team members, or integrations. Mark missing claims as content needed or omit them.

## 4. Design and build

Read [design-and-build.md](references/design-and-build.md) before creating a new visual system or substantially changing one.

- Use the user's brand assets and content when available.
- Use relevant real or generated bitmap images when the subject needs visual proof. Do not substitute decorative blobs, generic stock atmosphere, or fabricated product screenshots.
- Use the project's icon library. Prefer familiar icons for familiar actions and include accessible names or tooltips.
- Keep controls complete and usable. Forms need real destinations or an explicit non-submitting state.
- Use stable responsive dimensions for fixed-format elements. Prevent text, controls, and media from shifting or overlapping.
- Keep cards for repeated items, modals, and genuinely framed tools. Do not put cards inside cards or turn every section into a floating panel.
- Write concise, specific copy. Avoid generic AI language and feature narration.

For download pages, copy release files into the site's public/static directory, use direct download links, show platform-specific setup, and include hashes when package integrity matters.

## 5. Validate

Read [validation-and-publishing.md](references/validation-and-publishing.md). At minimum:

1. Run the project's typecheck and production build.
2. Start the correct local server when the site requires one.
3. Inspect desktop and mobile screenshots using browser control when available. If it is unavailable, label visual QA blocked or unverified; a source review or successful build is not a substitute.
4. Check for horizontal overflow, clipped text, overlapping controls, broken assets, unreadable contrast, and unstable layout.
5. Test primary navigation, calls to action, copy controls, downloads, and other critical interactions.
6. Confirm public files return the expected status, content type, size, and checksum where applicable.
7. Report anything that could not be tested as unverified, not passed.

Do not call a site finished because the build command passed. Visual and interaction checks are part of completion.

## 6. Publish

Publish only after the user authorizes the exact destination and production action.

1. Identify the existing hosting project and deployment method. Do not create a second project when the intended one already exists.
2. Check authentication without exposing account IDs, tokens, or credential contents.
3. Build from the exact source being released.
4. Commit only scoped files when source control is part of the release.
5. Deploy using the host's supported current method. A Git push and a hosting deployment are separate until the integration is verified.
6. Verify the production URL, page content, primary interactions, and downloadable artifacts from the public domain.
7. Preserve rollback information such as the commit and deployment identifier without printing secrets.

Never place credentials in the site, skill, repository, chat, screenshots, or downloadable package. Never change DNS, billing, access control, or custom-domain ownership without narrow approval.

## 7. Finish cleanly

Use [release-report-template.md](assets/release-report-template.md) as an internal structure. Keep the user-facing result brief:

- live or local URL;
- what was created or changed;
- validation performed;
- anything still blocked or unverified.

When a deployment is live, link directly to it. Do not imply that a local preview is public.
