# Workflow blueprint: [workflow name]

Fill this with the owner before building. A disagreement here costs a conversation; the same
disagreement after building costs a rebuild and possibly messages sent to real customers.

Leave nothing as "TBD". An unanswered section is an untested branch waiting to happen. Where a value
genuinely cannot be established — a pricing lookup that failed, a prerequisite you could not check —
write "unverified" and why, which is honest, rather than a guess, which is not.

---

## 1. Goal and success metric

- **Business outcome:**
- **Success metric (one number):**
- **Current baseline:**
- **Target after 30 days:**

## 2. Account

- **Agency / company:**
- **Sub-account name (exact, as shown in the switcher):**
- **Identity verified by:** local tool comparison / owner compared on their own screen / **not
  verified**
- **Comparison result:** match / mismatch / could not be performed
- **Test or production context:**
- **All work confined to this one sub-account:** yes / no

Never record the location identifier here, and never construct or paste a URL containing one. The
result of the comparison is what belongs in this file. If identity could not be verified, account
reads and writes do not proceed.

## 3. Trigger and eligible contacts

- **Trigger:**
- **Who is eligible:**
- **Required conditions at entry:**

## 4. Exclusions and re-entry

- **Excluded contacts:**
- **Can a contact re-enter:** yes / no
- **Re-entry interval or condition:**
- **Existing workflows with overlapping triggers:**

## 5. Required data and consent

- **Fields required, and where each is captured:**
- **Existing fields reused:**
- **New fields needed (and confirmed not duplicates):**
- **Consent captured for email:**
- **Consent captured for SMS:**
- **Consent wording location:**

## 6. Actions, timing, branches

| Step | Action | Channel | Delay | Condition / branch |
|---|---|---|---|---|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

- **Branches defined:**
- **Behaviour when a delay lands outside the sending window:**

## 7. Stop conditions

- [ ] Replied
- [ ] Booked
- [ ] Paid / became a customer
- [ ] Asked to stop
- [ ] Unsubscribed or opted out
- [ ] Other:

**Do opt-outs halt other workflows this contact is in?** yes / no — how verified:

## 8. Human decisions and handoffs

- **Decisions a person must make:**
- **Who receives each handoff:**
- **Tasks or notifications created, and for whom:**
- **What happens if nobody acts:**

## 9. Routing

- **Via MCP:**
- **Via supervised browser control:**
- **Cannot be created by either route (interface or snapshot only):**
- **Where the authoritative verification lives for each step:**

## 10. Costs

- **Activation cost:**
- **Per-contact usage cost:**
- **Expected monthly volume:**
- **Estimated monthly cost:** [figure, or "unverified — pricing lookup unavailable on (date)"]
- **Current pricing checked against official source:** yes / no
- **Wallet or billing state confirmed:**
- **Paid or AI features required, and approval obtained:**

## 11. Test scenarios and required proof

Fictional records only: `DEMO - ` prefix, `example.com` addresses, visible demo tag where the
surface supports one.

Test what this workflow actually does. Delete rows for states it does not contain — a review-request
flow has no no-show branch, and inventing one produces junk records and a dishonest sign-off.

**Always required:**

| Scenario | Test record | Expected result | Proof to capture | Passed |
|---|---|---|---|---|
| Happy path |  |  |  |  |
| Branch: |  |  |  |  |
| Branch: |  |  |  |  |
| Stop condition: |  |  |  |  |
| Stop condition: |  |  |  |  |

One row per branch and per stop condition this blueprint actually defines.

**Required where applicable — delete what does not apply:**

| Scenario | Applies | Test record | Expected result | Proof | Passed |
|---|---|---|---|---|---|
| Duplicate / retry idempotency | y / n |  |  |  |  |
| Opt-out halts this workflow | y / n |  |  |  |  |
| Opt-out halts other workflows | y / n |  |  |  |  |
| No-show | y / n |  |  |  |  |
| Attended, undecided | y / n |  |  |  |  |
| Sold / Closed Won | y / n |  |  |  |  |
| Payment, in test context | y / n |  |  |  |  |

**Sold-client rows — delete if this workflow does not reach a sale:**

| Scenario | Applies | Expected result | Proof | Passed |
|---|---|---|---|---|
| Contact with two opportunities: right one selected | y / n |  |  |  |
| Consent packet stored against the correct enrollment | y / n |  |  |  |
| Payment reconciles: processor / record / enrollment / instalment | y / n |  |  |  |
| Receipt and welcome — nothing arrives twice from both sides | y / n |  |  |  |
| Milestone completes against the exact enrollment | y / n |  |  |  |
| Evidence links to the exact enrollment | y / n |  |  |  |
| Archiving the offer stops the pulse schedule (test last) | y / n |  |  |  |

- **Branches knowingly untested, and why:**
- **How the call outcome is recorded, and tested the way the owner will actually set it:**
- **Demo records created, for cleanup:**

### 11a. Native testing, in Draft

- **Native Test Workflow run:** yes / no — date:
- **What it proved:**
- **Contacts used (fictional, `DEMO - `):**
- **Test Action used for an external-app action:** yes / no / not offered
- **If used — the real API call it made, and the approval obtained for that side effect:**
- **What native testing could NOT prove, and therefore needs publication:**

### 11b. Limited publication, if needed

Skip entirely if native testing was sufficient.

- **Why publication was necessary** (entry trigger / actual timing / inbox delivery / duplicate
  sends):
- **Scoping mechanism verified in this account:** yes / no — if yes, name it and what it covers:
- **If no scoping: exposure disclosed to the owner, in their words:**
- **Owner approved that exposure:** yes / no — when:
- **Window start:**
- **Window end:**
- **Real events that entered during the window:**
- **Owner-controlled inbox used, and for which delivery checks:**
- **All work stayed in the one confirmed sub-account:** yes / no

### 11c. Final state

- **Production activation approved:** yes / no
- **Agreed final state:** Draft / published — page: unpublished / published
- **Restored to that state:** yes / no — when:
- **Verified by reloading and looking, not assumed:** yes / no
- **Who confirmed:**

## 12. Activation

- **Everything left in the agreed final state, verified by looking:** yes / no — see 11c
- **Who could receive a communication once active:**
- **Separate activation approval obtained:** yes / no
- **How to switch it off:**

## 13. Next measured experiment

- **One change to try next:**
- **What will be measured, and after how long:**
