# External Evidence Defense Contract

Outside systems report facts. ScaleSafe determines how those facts appear in evidence and defense packets.

Every published event records:

- Exact enrollment, offer, contact, connection, and source record.
- Source event time and ScaleSafe receipt time.
- Source authentication and enrollment match method.
- Neutral exhibit title and factual one-sentence summary.
- Client, merchant, provider, or system actor.
- Activity status, duration, progress, result, and resource when present.
- Server-owned proof role, reason categories, priority, and confidence.
- Payload and attachment hashes.

Outside callers cannot set issuer exhibit titles, reason-code tags, confidence, or defense conclusions. Raw JSON, mapping diagnostics, rejected events, synthetic tests, and unapproved custom events are excluded from packets.

Validated external files are retained in private storage. PDF and image evidence can be appended to the generated defense bundle; text and CSV evidence are rendered into a readable PDF section.
