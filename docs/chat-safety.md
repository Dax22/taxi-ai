# Advisory chat safety hints

Web and native journey chat now display contextual hints below received messages
for selected code requests, payment links, off-app payment pressure, threats and
harassment. The original message and existing manual Report message control remain
available, including in read-only conversations. The sender receives no automated
accusation, account penalty or report. No message is blocked or changed.

`packages/shared/src/chat-safety.mjs` is a pure, shared, bounded text classifier.
Both clients run it locally on messages they are already authorized to see. It
uses explicit English patterns and catches some similarly phrased Pidgin messages;
it is not a trained AI model, agent, comprehensive moderation system or validated
multilingual detector. No LLM receives messages and no new credentials are needed.
It performs no network calls, URL visits, persistence, scoring or enforcement.

Hints are cautionary. A payment link is labelled unverified, not malicious.
Code requests get an in-person pickup/handover reminder at any trip stage; the
classifier cannot establish physical arrival or when the sender intended sharing.
It never reads actual PIN values. Basic safety reminders and map-pin requests are
excluded where recognized. Unicode normalization handles some trivial obfuscation.
Euphemisms, quoted speech, sarcasm, unfamiliar languages, images, audio and deliberate
evasion can still lead to missed detections or false alarms. An unflagged message
must never be presented as safe. The persistent chat notice explains this limit.

The existing report submission is explicit and keeps its participant permissions,
reason selection, idempotency and staff review. Hints neither submit reports nor
contact emergency services. This development preview collects no real payments.

Verification covers positive examples, benign fare/pickup messages, negated advice,
map pins, separate requests after advice, repeated signals, Unicode variants and
bounded inputs. These are regression fixtures, not measured production accuracy.
Visual/device review remains pending because the available browser blocks localhost.

A future model-backed classifier should be a separate server adapter with scoped
message processing, defined retention, labelled multilingual evaluation, timeouts
and a fallback to these local hints. It must preserve explicit reporting and avoid
automatic account sanctions. No external model integration is enabled here.
