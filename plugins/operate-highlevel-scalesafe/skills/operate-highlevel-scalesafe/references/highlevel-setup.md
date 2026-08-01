# HighLevel setup, one step at a time

## Contents

- How to run Guide mode
- Connect the official HighLevel MCP
- Business profile and timezone
- Inventory existing assets
- Select the first workflow
- Connect with least privilege
- Business and funnel domains
- Dedicated email sending domain
- Phone setup and A2P preparation
- Billing and wallet safeguards
- AI and premium workflow costs
- Supervised remote operation from a phone

## How to run Guide mode

Give a complete short procedure when the supported sequence is known. Do not turn ordinary
navigation into a back-and-forth exchange. A five-step connector installation belongs in one
response.

Ask what the owner sees only when the official path is absent, a step fails, or the next action
depends on account state. Use one-step guidance for risky, irreversible, paid, or genuinely
state-dependent work — not for clicking through a documented setup.

If the owner says "just give me the instructions", repeats a question, or shows frustration, stop
explaining the process. Give the complete answer immediately, with no follow-up question unless a
missing fact makes the procedure impossible.

Explain unfamiliar terms in one short clause as they arise, without a vocabulary lecture. A
subdomain is "a prefix on your web address". A2P is "the registration mobile carriers require before
they will reliably deliver business texts".

Avoid long checklists unless asked. Short, verified setup sequences are instructions, not checklists.

When the owner reports something unexpected, stop advancing and diagnose it. See
`references/troubleshooting.md`.

## Connect the official HighLevel MCP

When the owner asks how to connect HighLevel, use these exact instructions before asking them to
describe icons or menus. Do not invent a directory connector, reuse a connection bound to another
sub-account, or claim that the skill itself installs the MCP.

Give all applicable Claude.ai steps below in the same response. Do not stop after "open Settings",
ask whether they can see Connectors, or ask what appears next. End by saying the existing connection
stays untouched.

Current official source, checked 2026-07-30:
`https://marketplace.gohighlevel.com/docs/other/mcp/index.html`

### Claude.ai

1. Open **Claude.ai → Settings → Connectors → Add custom connector**.
2. Enter `https://services.leadconnectorhq.com/mcp/anthropic/v2` as the server URL. If Claude asks
   for a name, use a clear label such as `HighLevel - ScaleSafe Test`.
3. Select **Connect**.
4. Complete LeadConnector OAuth: sign in, choose the intended sub-account, review the scopes, and
   approve. OAuth is the recommended path; it avoids handling a token.
5. Start a new chat. Ask the skill to identify the connected agency and sub-account before any audit.

### Claude Cowork

Open Cowork's connectors or integrations settings, choose **Add custom connector**, use the same
`https://services.leadconnectorhq.com/mcp/anthropic/v2` URL, then complete the LeadConnector
sign-in, location selection, and approval.

For browser-controlled builders and ScaleSafe screens, configure browser access separately:

1. Use actual Google Chrome. Claude in Chrome is not supported in Brave or other Chromium browsers.
2. In Claude Desktop, open **Settings → Connectors → Claude in Chrome → Configure** and enable it.
3. Install or enable the Claude in Chrome extension and sign into the same Claude account.
4. Enable **Claude in Chrome** for the individual Cowork conversation.
5. Keep broader computer control off when the owner grants browser-only access.

`/chrome` is a Claude Code command, not a Cowork command. If the connector is missing, update or
restart Claude Desktop and the extension, verify the toggle, and start a new Cowork task if the
current task still cannot see it. Do not substitute LeadConnector or full desktop control.

### Codex browser control

Detect the current task's callable tools. Use `control-chrome` when existing signed-in Chrome state
is required, including when the macOS connector is displayed as **Control Chrome**. The in-app
Browser is also valid when it exposes the required authenticated session. Installation in another
task or a visible extension icon does not prove the current task can call it.

If neither browser route is callable, give the host's current plugin or connector setup steps and
limit the task to MCP-supported work. Never infer browser access from the HighLevel MCP connection.

### Add another sub-account in Claude.ai

Each HighLevel MCP authorization targets one sub-account. Claude.ai may reject a second custom
connector when the same server URL already exists. Never promise that repeating the preferred URL
will work, and never make the owner discover this through trial and error.

If `https://services.leadconnectorhq.com/mcp/anthropic/v2` is already connected to WholePay and
Claude reports **A server with this URL already exists**, keep that connector as-is and add Scale
Safe with HighLevel's other official endpoint:

1. Open **Claude.ai → Settings → Connectors → Add custom connector**.
2. Name it `HighLevel - Scale Safe`.
3. Use `https://services.leadconnectorhq.com/mcp/` as the server URL.
4. Select **Connect**, complete LeadConnector OAuth, choose **Scale Safe**, review the scopes, and
   approve.
5. Start a new chat and have the skill identify the connected sub-account before using it.

For this exact error, the only second URL you may provide is
`https://services.leadconnectorhq.com/mcp/`. Do not output any other proposed endpoint.

Do not append a query parameter, change the path, use a URL shortener, or introduce a proxy merely
to make Claude accept the preferred endpoint twice. Those variants are not the documented
LeadConnector connection and may break authentication or route data somewhere unintended.

The original `/mcp/` endpoint exposes a narrower tool catalog than `/mcp/anthropic/v2`. Say that
once, plainly. Use supervised browser control for required operations the connection does not
expose. Do not delete or reauthorize WholePay unless the owner explicitly chooses to replace that
connection.

For the full Claude-specific tool catalog in a separate local configuration, Claude Code can add a
named connection using the command below. Do not assume the owner uses Claude Code; offer it only
when the narrower Claude.ai connection is insufficient.

### Claude Code

Run:

```text
claude mcp add --transport http leadconnector https://services.leadconnectorhq.com/mcp/anthropic/v2
```

The first use opens LeadConnector authorization. Verify with `claude mcp list`.

### ChatGPT and Codex

HighLevel's dedicated OpenAI `/mcp/{client}/v2` endpoint is still listed as planned in the source
above. Do not invent `/mcp/openai/v2`. The original remote endpoint is available now:
`https://services.leadconnectorhq.com/mcp/`.

Use it only where the OpenAI account and plan support custom remote MCP apps. ChatGPT custom MCP
apps currently require the applicable developer-mode and workspace permissions; Codex connection
steps depend on its current MCP configuration surface. Check current official OpenAI instructions
at setup time rather than giving Claude UI steps to an OpenAI user.

### Private Integration Token fallback

Use a Private Integration Token only when OAuth is unavailable or the owner deliberately chooses
it. Inside the intended sub-account, go to **Settings → Private Integrations → Create New
Integration**, choose least-privilege scopes, and create it. The owner enters the token and location
value directly into the client's secure connection fields. Never ask them to paste, dictate, or
screenshot either value in conversation.

## Business profile and timezone

Start here. Timezone errors silently corrupt every appointment, reminder delay, send window, and
pulse schedule that follows, and they are painful to unwind later.

Confirm the business name, address, contact email, and timezone match the real business, and have
the owner read the timezone back. A sub-account created from a snapshot or by an agency often still
carries whoever built it.

## Inventory existing assets

Before building anything, find out what is already there. This is an Audit pass and changes nothing.

Walk through, or read where available: existing workflows and which are active, forms and surveys,
funnels and websites, calendars, pipelines and stages, custom fields and tags, connected domains,
connected integrations and Marketplace apps including whether ScaleSafe is installed, and roughly
how many contacts and open opportunities exist.

Report it back as a short inventory and ask which they still use. Owners routinely discover
abandoned automations still running and still messaging people — that discovery is often worth more
than whatever you were about to build.

## Select the first workflow

Run the interview in `references/discovery.md`, rank candidates, recommend one, and fill
`assets/workflow-blueprint-template.md` together before touching a builder.

## Connect with least privilege

Explain the model plainly: the connection lets you read and change specific kinds of records in one
sub-account, and the permissions decide which kinds.

Request only what the agreed first workflow needs, determined from the operations you actually plan
to call rather than a convenient preset. Read-only is the correct default for anything you only
inspect. Connect at sub-account level using delegated access — connecting with agency-level
credentials to operate one sub-account puts every other client's data inside the blast radius of a
mistake in this one.

Never ask the owner to paste a token, key, or password into the conversation. Values are entered
directly into the setting that consumes them, on their screen, by them. If one is pasted anyway, say
plainly it is now exposed and should be rotated, then continue without repeating it.

Permissions can be widened later with approval. Start narrow.

## Business and funnel domains

Domain changes affect live traffic and email, so each is a separate approval.

Establish first which domains already exist and what depends on them. A domain currently serving a
live funnel must not be repointed to test something.

Explain the split: the business website domain, and the domain or subdomain serving funnels and
landing pages. Many owners want funnels on a subdomain so the main site stays untouched.

**DNS records are edited at the authoritative DNS host for the domain, which may or may not be the
registrar.** Many domains are registered in one place and have their DNS served somewhere else
entirely — a CDN, a hosting provider, or a separate DNS service — and edits made at the registrar
have no effect when the nameservers point elsewhere. Establish where the domain's DNS is actually
served before giving any record-adding step, and confirm the owner can sign in there. Discovering
they cannot, halfway through, is the usual stall point.

Propagation is not instant; expect a wait rather than retrying. If records do not verify after a
reasonable wait, treat it as a specialist candidate — see `references/specialist-brief.md`.

## Dedicated email sending domain

Explain what it does and does not do, in that order, because the difference matters:

> A dedicated, authenticated sending domain gives you control over your own sending reputation and
> makes delivery problems diagnosable, instead of sharing a reputation you cannot influence. It does
> not guarantee that mail reaches the inbox. Authentication is necessary for good delivery; it is
> not sufficient.

Guide them to choose a sending subdomain, add the records the platform specifies at the
authoritative DNS host, and verify inside HighLevel. Have them confirm verification shows complete
on screen before sending anything real.

Then send one test to an address the owner controls and have them confirm receipt and where it
landed — inbox, promotions, or spam. Never claim deliverability is fixed because verification
passed. A newly authenticated domain still has no sending history, and content and volume continue
to matter.

## Phone setup and A2P preparation

Phone and SMS cost money per number and per message segment, rates vary by country, and they change.
Look up current official pricing before enabling anything and state both setup and recurring cost.

Purchasing a number is a separate approval even where the operation is directly available. Confirm
country, number type, and that the owner wants the recurring rental.

A2P registration needs accurate legal business details, a working opt-in mechanism, and sample
messages matching what will actually be sent. Prepare these together first; submission is its own
approval. Note that the opt-in mechanism is a prerequisite of registration, so a first build with no
consent capture silently blocks the SMS path later.

Never guarantee approval or a timeline. Registration can be rejected for reasons outside the
account. Say what happens if it is — SMS steps stay off and the email path carries the workflow — so
a rejection is a delay rather than a crisis. Until registration is approved, a number provisioned,
consent recorded, and the wallet funded, every SMS step stays conditional and inactive.

## Billing and wallet safeguards

Messaging and AI draw from a wallet balance, and an empty wallet stops sends silently mid-workflow,
which looks like a broken automation and leaves contacts in a partial state. The owner usually finds
out from a customer.

Adding billing details or funding a wallet is a separate approval, and the owner enters payment
details themselves. Never read, repeat, or store card data.

Recommend a funded balance with automatic top-up at an amount they are comfortable seeing charged,
plus whatever balance notifications exist. Before activating any workflow with paid steps, estimate
monthly cost from expected volume and confirm they accept it.

## AI and premium workflow costs

AI features and premium workflow actions are metered separately from messaging and are easy to
enable without noticing the meter.

Look up current pricing before enabling. State the per-use or per-period cost and expected volume.
Prefer starting without AI where a native asset achieves the outcome — a good form and a clear
branch often replace an AI step at zero marginal cost. If AI is warranted, enable the narrowest
feature, test with fictional contacts, review the actual output quality with the owner, and only
then let it touch real people.

## Supervised remote operation from a phone

Explain it in beginner language:

> Your trusted desktop stays signed in. It holds the connection and the browser session, so it is
> the thing that actually does the work. Your phone sends instructions, shows you results, and is
> where you give approvals. You do not need to set up any direct connection from your phone.

State the requirements plainly: the desktop must stay awake, online, signed in, and running the
required application. If it sleeps or signs out, work stops until it is back — approvals are not
lost, but nothing progresses.

Approvals still happen at action time. Remote operation shortens the distance to the owner; it does
not remove the approval step, and a phone-sized screen makes it more important to state what an
action touches before asking.

Never include a connection code, pairing code, QR code, token, or password in instructions,
screenshots, or reports. Point the owner to where it appears on their own screen.
