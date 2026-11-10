# Open friend views find changes by polling, inside a server-sent event stream

A friend's open page holds a server-sent event stream (`GET /api/friends/:token/events`). The stream sends the whole friend view on connect and again whenever it changes. The server finds a change by reading the view every 250 ms for each open stream, not by being told about it.

A payment is recorded by whichever web service process receives the capture response or PayPal's webhook, and the Workflow task makes the Ode in another process. An in-process "something changed" signal would reach only the views held open on the process that took the payment, so a second instance, or a restart, would silently stop live updates. Postgres `LISTEN`/`NOTIFY` would fix that but adds a long-lived connection per process and a failure mode (a missed notification) that the payer would see as a line that never unlocks. Polling needs nothing beyond the reads the page already makes, works the same across processes, and finishes well inside the one second the spec allows.

Sending the whole view each time means a reconnect needs no catch-up protocol: the browser's `EventSource` reconnects by itself and the first event is the current state.

## Consequences

Each open friend view costs a handful of cheap queries four times a second; a few friends and judges watching is nothing, a crowd would not be. If that ever matters, put `NOTIFY` in front of the same read and keep the poll as the fallback.
