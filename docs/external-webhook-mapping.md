# Raw Webhook Mapping

Raw connections accept a provider's native JSON and map safe dot paths to ScaleSafe's canonical event contract.

A connection can contain up to 50 ordered mapping rules. A rule may define a safe match path and exact value, such as `event.type = meeting.ended`, so one provider connection can normalize payloads that use different shapes. If no rule matches, the event is retained as rejected diagnostic intake and never becomes evidence.

## Authentication

The ScaleSafe HQ operator chooses one method during assisted setup:

- Secret webhook URL for systems that cannot add headers.
- Bearer API key.
- HMAC signature using `X-ScaleSafe-Signature: t=UNIX_TIME,v1=HEX_DIGEST`. The digest is HMAC-SHA256 of `timestamp + "." + raw request body`; timestamps outside five minutes are rejected.

Unsigned requests are never accepted.

## Mapping Fields

Required:

- Event ID path
- Event type path or fixed event type
- Occurred-at path

Identity:

- Enrollment reference path, preferred
- External enrollment ID path
- External contact ID path
- Contact email path

Resource:

- Resource type path or fixed value
- Resource ID path
- Resource name path

Activity fields may map status, title, description, duration, progress, result, start time, and end time.

A rule may also map one HTTPS attachment URL and filename. The URL must use a domain approved on the connection and cannot contain query credentials. Protected files must use the canonical API's signed upload flow.

Mappings use property names and numeric array indexes only. They cannot run scripts, expressions, network calls, or provider-supplied defense templates.

## Resource Mapping

Map each outside product, course, calendar, or service to one ScaleSafe offer. The mapping is configured once. Events are then resolved automatically; merchants do not link individual evidence rows.

Use the HQ sample preview before activation. Suggested offer matches use exact identifiers or normalized names, but an HQ operator must approve every mapping. Preview and test events never create evidence.
