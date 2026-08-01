# Routing: connection versus supervised browser

## Contents

- The rule
- Inspect capability at runtime
- Host and browser preflight
- Read the safety metadata before executing
- What each route is good for
- ScaleSafe surfaces
- Mixed routing
- Browser control boundaries

## The rule

Never claim a capability from memory. What the connected HighLevel MCP exposes differs by
connection, by granted permissions, and over time, so a capability present in one account or one
month may be absent in another.

At the start of any Build, Operate, Improve, or Audit task, inspect what the connection actually
exposes for the surfaces you need, then choose the route. If no connection is present, say so and
either use supervised browser control with approval, or stop.

## Inspect capability at runtime

The HighLevel MCP is a gateway rather than a fixed tool list. The pattern is:

1. **Search** for operations matching what you need, optionally filtered by domain and by kind —
   read, write, delete, money movement.
2. **Describe** the chosen operation before using it, to get its real parameters, request body
   fields, required permissions, and safety metadata.
3. **Execute** only after approval, and only with parameters you actually confirmed.

Search first, describe second, execute last. Skipping describe is how wrong field names and
wrong-shaped payloads happen, and a failed write can still leave a partial record behind.

If a search returns nothing for the surface you need, that is the answer: route to the browser. Do
not substitute a similar-sounding operation on a different object.

## Host and browser preflight

Detect callable tools in the current conversation. An installed extension, enabled application, or
tool used in a different conversation is not proof that this conversation can call it.

- **Codex:** prefer an actually callable `control-chrome` capability when signed-in Chrome state is
  needed. The in-app Browser is also valid when it exposes the required authenticated session.
- **Claude Cowork:** use Claude in Chrome or another browser connector actually exposed to the task.
  Claude in Chrome requires Google Chrome; Brave and other Chromium browsers are not supported.
  Enable it in Claude Desktop settings and for the individual Cowork conversation.
- **Claude Code:** `/chrome` manages Claude Code's Chrome integration. Never give `/chrome` as a
  Cowork or Claude Chat instruction.

Browser permission is not computer permission. If the owner approves browser-only access, never
request or substitute desktop computer control, LeadConnector control, clipboard access, or another
application. If the browser connector is absent, name the missing connector and provide its exact
setup path. Do not keep offering broader access.

When several HighLevel connections are callable, bind the task to one named connection using account
metadata before any business-data read. Never probe the others to see what they contain. If a call
unexpectedly returns another tenant, stop and report the cross-tenant access without repeating its
business data.

## Read the safety metadata before executing

Each operation reports metadata that maps onto this skill's approval rules. Let it drive behaviour
rather than guessing from the operation name.

- **kind** — read, write, delete, or money movement. Anything other than read needs approval. Delete
  and money movement always need standalone approval and can never be batched.
- **readOnlyHint** — when true, safe in Audit mode. When false, Audit must not call it.
- **destructiveHint** — treat as irreversible: name what is lost, confirm a duplicate or export
  exists, get explicit standalone approval.
- **requiresApproval** — a direct instruction. Surface it to the owner rather than deciding for
  them.
- **idempotencyRequired** — a retry may double-create. After an ambiguous timeout, verify current
  state before retrying, and never blind-retry a payment or a message send.
- **requiredScopes** — request only these when connecting. If an operation needs a permission the
  connection lacks, the fix is usually a narrower plan, not a broader token.

In Audit mode, restrict yourself to read operations. If the only route to an answer is a write, the
answer is that Audit cannot get it — report that rather than escalating silently.

## What each route is good for

Prefer the **connection** for structured records and repeatable data operations — things with stable
fields and verifiable identifiers. In current connections this typically includes location
information, contacts, custom fields and values, conversations and messages, calendars and
appointments, opportunities and pipeline reads, and payment records such as orders, transactions,
and subscriptions where exposed. Verify per connection rather than trusting this list.

Prefer **authenticated browser control through the owner-approved browser capability** for visual builders and settings
surfaces. In current connections the MCP commonly exposes forms, surveys, funnels, and workflows as
**read-only** — you can list and inspect them but not construct them — so building any of those
means the browser. The same applies to workflow execution history, domain and DNS connection, email
sending-domain setup, phone settings, A2P registration, billing and wallet, AI configuration,
Marketplace apps, and integrations.

Two consequences worth saying out loud to the owner:

- Some operations that feel like settings are exposed as writes and spend money — buying a phone
  number and sending a message are the common ones. Availability is not permission; these still need
  separate approval.
- Some things cannot be created by any route and must be built by hand in the interface or come from
  a snapshot. Pipelines are a common example. When you hit one, say so rather than improvising a
  substitute.

## ScaleSafe surfaces

Treat the ScaleSafe app as a supervised browser surface unless a connection demonstrably exposes the
operation you need. Merchant configuration, offers, enrollment, consent and signature, checkout,
payment actions, milestones, pulse settings, evidence connections, provisioning health, and defense
material are app surfaces the owner can see, and seeing them is part of the verification.

Some downstream results are visible through the HighLevel connection even when the action was taken
in the app — the contact, the opportunity, appointments, conversations, and payment records among
them. Use whichever route holds the authoritative record for the specific thing you are proving.
Enrollment state is authoritative in the app; the opportunity's stage is authoritative in the CRM
record.

Buyer-facing pages — the enrollment funnel, the consent and signature flow, the checkout — get
verified as the buyer sees them, in a browser, at mobile width as well as desktop. A page that
renders correctly in the builder and badly on a phone still costs the sale.

## Mixed routing

Most real work mixes routes. Say which route does what in the action plan, so the owner knows when
they will see the browser move on their own screen.

A typical shape:

- The connection creates the `DEMO - ` contact and the custom fields.
- The supervised browser constructs the workflow, left inactive.
- The connection or the interface verifies the resulting opportunity, and the browser reads
  execution history to confirm the run happened.
- The ScaleSafe app performs enrollment and the test payment, and the connection confirms the
  resulting payment record and contact state.

Verify in the route that holds the authoritative record. Checking the convenient one instead of the
authoritative one is how work gets reported as working when it is not.

## Browser control boundaries

Browser control acts as the owner, inside their signed-in session, so it can do anything they can —
including things they did not ask for.

- Stay inside the approved browser capability. Do not broaden access to the desktop or another app.
- Confirm the correct sub-account is loaded on screen before the first click, and again after any
  navigation that could have switched context.
- Never open password fields, cookie or storage inspectors, developer tools, saved payment methods,
  or token screens. Nothing here requires reading a secret.
- Do not read a location identifier out of the screen into the conversation. Confirming that two
  screens agree is what is needed, not the value.
- Do not trigger confirmation dialogs on delete controls unless deletion is the separately approved
  action.
- Prefer save-as-draft and save-inactive controls. If a builder only offers publish, stop and get
  publish approval before saving at all.
- Report what you saw on screen, not what you assume the click did.
