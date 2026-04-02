# Claude Code + Cursor: Strategy for ScaleSafe Launch

**Version:** 1.0 — March 26, 2026
**Purpose:** How to use both tools together to speed up ScaleSafe's path to launch. Written for Philip — no dev jargon.

---

## The Big Picture

Claude Code and Cursor are not competing tools. They do different things well. The fastest path to launch uses both at the same time, each doing what it's best at.

Think of it like this: **Claude Code is the builder.** You tell it what to do, it goes away and does it, and comes back with results. **Cursor is the workshop.** You see the code visually, point at things, get instant suggestions, and have background workers running in parallel.

You've already been using Claude Code through the terminal. Cursor adds a visual layer on top AND gives you background agents that can work on multiple things simultaneously.

---

## What Each Tool Does Best

### Claude Code (What You're Already Using)

**Strengths:**
- Big, multi-file tasks: "Build the entire defense service with repository, controller, and routes"
- Sequential logic: "Fix this bug, then run the tests, then deploy"
- Terminal-heavy work: database migrations, deployments, git operations
- Deep reasoning about architecture and how pieces connect
- Works great through Cowork (what you're using right now with me)

**Where it's slow:**
- One thing at a time — can't parallelize
- Can't visually review code (it's all text in a terminal)
- No automated background monitoring

### Cursor (What You Should Add)

**Strengths:**
- Up to 20 background agents working in parallel (each on its own branch)
- BugBot: automatically reviews every PR and fixes bugs before they ship
- Visual code editing with instant AI suggestions
- Automations: agents that trigger automatically on events (PR created, code pushed, schedule)
- You can SEE the code, click on files, and understand the project structure visually

**Where it's weaker:**
- Not as strong at complex multi-step reasoning
- Needs more hand-holding for big architectural decisions
- Not available through Cowork

---

## How They Work Together (The Hybrid Setup)

Open your ScaleSafe project in Cursor. Inside Cursor, open the integrated terminal. Run Claude Code in that terminal. Now you have both tools running on the same project at the same time.

**What this looks like in practice:**

You're in Cursor, looking at the code. You see something that needs fixing. Two choices:

1. **Small fix** (a typo, a missing field, a style change) → Fix it right in Cursor. Click the line, let Cursor's AI suggest the fix, accept it.

2. **Big change** (a new service, a refactor across multiple files, a deployment) → Switch to the Claude Code terminal inside Cursor and tell it what to do.

Meanwhile, Cursor's background agents can be running tests, writing documentation, or polishing the UI — all at the same time.

---

## ScaleSafe Launch Strategy: What to Use When

### Phase: SSO Fix + GHL Integration Testing (Tomorrow)

| Task | Tool | Why |
|------|------|-----|
| Debug SSO key issue | Claude Code | Sequential debugging, needs to check code → test → fix → test again |
| Test OAuth flow end-to-end | Claude Code | Terminal work, needs to watch logs and make fixes |
| Fix any webhook issues | Claude Code | Needs to read server logs, trace data flow, make targeted fixes |

### Phase: Test Coverage (This Week)

| Task | Tool | Why |
|------|------|-----|
| Write integration tests for enrollment service | Cursor Background Agent #1 | Can work independently in its own branch |
| Write integration tests for defense service | Cursor Background Agent #2 | Parallel with enrollment tests |
| Write integration tests for evidence service | Cursor Background Agent #3 | Parallel with both above |
| Write integration tests for payment observation | Cursor Background Agent #4 | All four agents run simultaneously |
| Review and merge test PRs | You in Cursor | Visual review, click through the diffs |

**Time saved:** Instead of Claude Code writing tests one service at a time (4 sessions), Cursor writes all 4 in parallel (1 session). That's roughly 3-4x faster for test coverage.

### Phase: UI Polish

| Task | Tool | Why |
|------|------|-----|
| Redesign Dashboard view | Cursor Background Agent | Visual work, agent can iterate on CSS/layout |
| Add loading states and error handling to all views | Cursor Background Agent | Repetitive across 8 views — agent handles it |
| Add data validation to Offer form | Cursor (interactive) | You can see the form and test changes live |
| Connect Settings view to merchant config API | Claude Code | Needs to understand the data flow end-to-end |

### Phase: Pre-Launch Hardening

| Task | Tool | Why |
|------|------|-----|
| BugBot on every PR | Cursor (automatic) | Reviews code, finds bugs, proposes fixes — no manual work |
| End-to-end test of full enrollment flow | Claude Code | Complex multi-step test requiring deep reasoning |
| Load testing | Claude Code | Terminal-based, needs to run scripts and analyze output |
| Security audit of webhook endpoints | Cursor Background Agent | Can scan systematically while you work on other things |

### Phase: Ongoing After Launch

| Task | Tool | Why |
|------|------|-----|
| Daily automated test runs | Cursor Automation | Trigger on schedule, runs tests, opens PR if failures |
| PR review on every push | Cursor BugBot | Automatic, catches issues before they hit production |
| New feature development | Claude Code | Better for complex new logic spanning multiple files |
| Bug fixes from user reports | Cursor | Quick visual edits, fast turnaround |

---

## BugBot Setup (Do This ASAP)

BugBot is Cursor's automatic PR reviewer. Once enabled, every time code gets pushed to GitHub, BugBot reads the PR, finds potential bugs, and either flags them or fixes them automatically.

**Why this matters for ScaleSafe:** Claude Code built 66 files in one session. That's fast, but fast means there are almost certainly edge cases, missing error handling, and subtle bugs hiding in there. BugBot will systematically find them.

**How to set it up:**
1. Open Cursor
2. Go to cursor.com/bugbot (or find BugBot in Cursor settings)
3. Connect your GitHub repo (Pkorn79/ScaleSafe)
4. Enable BugBot for the repo
5. Enable Autofix (lets BugBot propose fixes, not just flag issues)
6. Optional: Create a BUGBOT.md file in the repo root with rules like "focus on error handling, webhook validation, and TypeScript type safety"

**What happens next:** Every PR that gets pushed will automatically get reviewed. BugBot opens in its own cloud VM, runs the code, finds issues, and either comments on the PR or pushes a fix directly.

---

## Cursor Automations (Set Up After Launch)

Automations are agents that trigger on events — not just code review, but any workflow you define.

**Examples for ScaleSafe:**

1. **Nightly test runner:** Every night at 2am, an agent clones the repo, runs all tests, and if anything fails, opens a PR with the fix or alerts you on Slack.

2. **PR-triggered deployment test:** When a PR is merged to main, an agent automatically deploys to a staging environment and runs smoke tests.

3. **Weekly dependency check:** Every Monday, an agent checks for outdated npm packages with known vulnerabilities and opens a PR to update them.

**How to set up:** Go to cursor.com/automations or start from a template in the Cursor app.

---

## The Daily Workflow (What Your Day Looks Like)

**Morning:**
1. Open Cursor with ScaleSafe project
2. Check if BugBot found anything overnight (look at GitHub PRs)
3. Review and merge any background agent PRs from yesterday
4. Decide what to work on today

**Working:**
1. If it's a big feature or fix → Open Claude Code in Cursor's terminal, describe the task
2. If it's a quick edit → Fix it directly in Cursor
3. If it's repetitive work (tests, docs, cleanup) → Spawn background agents
4. If you need strategic help → Come to Cowork (me)

**End of day:**
1. Push your changes
2. BugBot reviews automatically
3. Background agents continue working while you sleep

---

## Cost

| Tool | Plan | Cost | What You Get |
|------|------|------|-------------|
| Claude Code | Claude Max (you already have this) | $100/month | Unlimited Claude Code usage |
| Cursor | Pro | $20/month | 500 fast premium requests, unlimited slow, BugBot, background agents |
| Cursor | Business | $40/month | Everything in Pro + admin features, higher limits |

**Recommendation:** Start with Cursor Pro at $20/month. Between Claude Max ($100) and Cursor Pro ($20), you'd have the full toolkit for $120/month total. That's less than one hour of developer consulting.

---

## What NOT to Do

1. **Don't use Cursor for big architecture decisions.** That's what Cowork (me) and Claude Code are for. Cursor is great at executing, not strategizing.

2. **Don't use Claude Code for parallel work.** If you need 4 things done at once, use Cursor's background agents. Claude Code does one thing at a time.

3. **Don't duplicate effort.** If Claude Code is refactoring a file, don't also edit it in Cursor at the same time. They'll conflict.

4. **Don't skip BugBot.** Free automated code review on every push. There's no reason not to use it.

5. **Don't forget CLAUDE.md.** Both Claude Code and Cursor read this file for project context. Keep it updated with architecture decisions, coding standards, and what's been built.

---

## Quick-Start Checklist

- [ ] Install Cursor (cursor.com) if not already installed
- [ ] Open ScaleSafe folder in Cursor
- [ ] Open integrated terminal in Cursor (Ctrl+` or View → Terminal)
- [ ] Run `claude` in the terminal to start Claude Code inside Cursor
- [ ] Go to cursor.com/bugbot and enable BugBot on the ScaleSafe repo
- [ ] Create a `.cursorrules` file in the repo root (same content as CLAUDE.md)
- [ ] Try spawning a background agent: Cmd/Ctrl+I → "Write integration tests for enrollment.service.ts"
- [ ] Watch BugBot review the next PR automatically

---

*This strategy should be revisited after the first week of using both tools together. Adjust the workflow based on what actually speeds things up.*
