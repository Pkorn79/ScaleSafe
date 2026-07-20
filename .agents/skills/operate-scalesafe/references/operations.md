# ScaleSafe Operations

## Offers

- Use distinct internal and client-facing names.
- Show clients only the public program name in funnels, agreements, receipts, and workflows.
- Configure payment type, processor, duration, policies, acknowledgments, milestones, pulse cadence, and checkout mode intentionally.
- Archive stale test offers. Archiving must stop active enrollment pulse schedules.
- Never enable every clickwrap clause by default.

## Checkout Modes

- **Full enrollment:** identity, offer review, milestones, terms/signature, then payment.
- **Quick checkout:** streamlined checkout with inline consent and less pre-purchase evidence.
- **QMS:** merchant collects payment first, then sends the paid-enrollment consent flow.
- **Whop:** hosted Whop payment while ScaleSafe records enrollment and evidence.

Verify one processor action, one payment event, one correct enrollment, and one applicable workflow result. Do not resubmit after an ambiguous timeout until reconciliation is checked.

## Clients And Programs

- Treat each enrollment as a separate program record even when one contact has many programs.
- Select an enrollment explicitly for program-specific messages, milestones, evidence, and defenses.
- Never assign activity to the newest enrollment merely because the contact matches.
- Leave genuinely ambiguous client-level activity unlinked rather than fabricating program scope.

## Payments

- Reconcile processor transaction ID, ScaleSafe payment-event ID, enrollment ID, and subscription/membership ID when applicable.
- Record add-ons separately from recurring principal.
- Update local status only after processor success for refunds and lifecycle actions.
- Use Payment Reconciliation for diagnostics; do not manually repair until processor truth is known.

## Pulse

- Cadence belongs to the offer and active enrollment.
- App-event delivery, GHL workflow execution, outbound email, receipt, and client submission are separate proofs.
- Archived offers and inactive enrollments must not continue scheduling pulses.
- A response requesting follow-up should remain visible to the merchant and become enrollment-linked evidence.
- GHL send windows can leave executions waiting; queued GHL work is distinct from new ScaleSafe scheduling.

## Milestones

- Complete the milestone on the exact enrollment.
- Verify the outbound signoff message uses the same program and milestone.
- Client signoff becomes enrollment-scoped evidence.
- Do not infer completion from a scheduled appointment.

## GHL And Provider Evidence

- Scheduled appointments are engagement, not completed service.
- Attended/completed appointments, Zoom participation, deliverables, progress, and communications may support delivery when exactly matched.
- Provider Connected status does not prove an event was observed or published.
- Test connector events remain diagnostic and never become production evidence.
- Relevance tags guide defense selection; they are not standalone factual claims.

## Defense

1. Select the actual disputed transaction whenever available.
2. Use the matching card brand and reason code.
3. Confirm processor deadline rather than assuming a generic response window.
4. Review enrollment scope, chronology, letter, exhibits, signed packet, amounts, and missing evidence.
5. Treat `needs_review` as an intentional hold. It must not fire `ss_defense_ready` automatically.
6. Keep processor submission as a separate, explicitly approved action.

Never claim a guaranteed win or represent client-level activity as enrollment proof without a defensible match.
