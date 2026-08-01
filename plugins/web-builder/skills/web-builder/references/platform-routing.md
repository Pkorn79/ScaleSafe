# Platform and tool routing

## Capability detection

At the start, determine what the current session can actually call. Names in documentation or prior conversations do not prove availability.

Separate these capabilities:

- reading and writing project files;
- running builds and local servers;
- controlling a browser for visual QA;
- using an existing signed-in browser session;
- generating or editing images;
- using source control;
- deploying to a hosting provider.

If a capability is missing, complete the parts that remain possible and state the exact blocked step. Do not substitute a different browser or hosting account after the user specifies one.

## Claude

- Claude web with a skill can guide, write content, and produce files that its session supports.
- Use Cowork or Claude Code when the task requires local project files, builds, supervised browser work, or deployment.
- Browser control must be enabled for the current session. Detect it before promising visual QA or publication.
- Do not invent slash commands, connector menus, or browser setup steps. Inspect the current UI or use current official documentation when setup is needed.

## Codex

- Use Codex desktop, CLI, or an IDE with workspace access for project work.
- Prefer a purpose-built connector or CLI for semantic operations and the browser for visual inspection and interaction.
- Use Control Chrome when existing Chrome login state is required. Use the in-app Browser for isolated local and public site testing when available.
- Start a local server for framework sites and provide its URL. Do not call a local URL public.

## Hosting

Detect whether the project uses Git integration, direct upload, a deployment CLI, or another release mechanism.

- A successful Git push does not prove a hosting deployment occurred.
- A successful hosting upload does not prove the custom domain has updated.
- Verify the public domain after deployment.
- Reuse the existing project and production branch. Do not create a replacement project because discovery was skipped.
- Check current official provider documentation when command behavior or authentication is uncertain.
