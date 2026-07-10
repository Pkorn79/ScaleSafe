# External Evidence Event Taxonomy

Supported canonical event types:

| Area | Event types |
| --- | --- |
| Sessions | `session.scheduled`, `session.attended`, `session.completed`, `session.cancelled`, `session.no_show` |
| Appointments | `appointment.attended`, `appointment.cancelled`, `appointment.no_show` |
| Service access | `service.access_granted`, `service.login`, `service.usage`, `service.access_revoked` |
| Content | `content.viewed`, `content.downloaded` |
| Modules | `module.started`, `module.progressed`, `module.completed` |
| Courses | `course.started`, `course.progressed`, `course.completed` |
| Milestones | `milestone.completed`, `milestone.approved`, `milestone.rejected` |
| Assignments | `assignment.submitted`, `assignment.reviewed` |
| Deliverables | `deliverable.sent`, `deliverable.viewed`, `deliverable.downloaded`, `deliverable.accepted`, `deliverable.rejected` |
| Communication | `communication.sent`, `communication.received` |
| Support | `support.opened`, `support.responded`, `support.resolved` |
| Onboarding | `account.onboarding_completed` |
| Pulse | `pulse.submitted` |
| Supplemental payment proof | `payment.observed` |

`payment.observed` records supplemental evidence only. It cannot create, refund, cancel, retry, or otherwise mutate a ScaleSafe payment.

Custom event types must be approved in the connection configuration before ingestion. Unknown or unapproved types are rejected and never enter a defense packet.
