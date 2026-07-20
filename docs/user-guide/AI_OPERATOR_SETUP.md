# ScaleSafe AI Operator Setup

ScaleSafe includes a portable operator skill at `.agents/skills/operate-scalesafe`. It gives an authorized AI assistant the same tenant-safety rules, onboarding order, certification standard, and troubleshooting process used by the ScaleSafe team.

## Supported Uses

- Guide a human through onboarding one step at a time.
- Operate an authorized GHL/ScaleSafe browser session.
- Audit a merchant setup without changing it.
- Test offers, checkouts, workflows, evidence, and defense behavior.
- Troubleshoot from Railway, GHL, processor, and ScaleSafe proof.

The skill does not bypass authentication, approvals, CAPTCHAs, processor controls, or GHL permissions.

## Repository Agents

Codex-compatible agents should discover `.agents/skills/operate-scalesafe/SKILL.md` from the repository. Start with:

> Use the ScaleSafe Operator skill. Guide me through onboarding this merchant one step at a time.

Claude Code is pointed to the same skill from `CLAUDE.md`. Start with:

> Read `.agents/skills/operate-scalesafe/SKILL.md` and guide this ScaleSafe setup one step at a time.

## Browser Chat Or Project Knowledge

Give the assistant access to the complete `operate-scalesafe` folder, not only `SKILL.md`, because the four reference files contain the actual runbooks. Keep one canonical copy and replace older uploads when the repository version changes.

Use one of these starting prompts:

> Operate ScaleSafe in Guide mode. Give me one step, wait for my result, and never switch GHL sub-accounts as a troubleshooting shortcut.

> Audit this ScaleSafe installation. Make no changes. Identify the GHL location, check each setup layer, and report only evidence-backed findings.

> Operate this authorized ScaleSafe account. You may perform read-only checks and the setup actions I explicitly approve. Check Railway logs before proposing fixes for unexpected errors.

## Access Rules

- Open only the intended GHL sub-account.
- Connect the merchant's own processor and provider accounts.
- Never place merchant credentials or location values in Railway.
- Approve sensitive actions at the moment they occur unless the user already granted a narrow batch approval.
- Use test mode and fictional clients for certification.
- Keep screenshots and reports free of secrets and unnecessary client data.

## Updating The Skill

The repository copy is authoritative. Validate it after changes with:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\skill-creator\scripts\quick_validate.py" ".agents\skills\operate-scalesafe"
```

Re-export or re-upload the complete folder after a validated update.
