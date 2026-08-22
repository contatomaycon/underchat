# Canonical connection status

WhatsMeow exposes the same provider-neutral status contract as the Baileys and
WWebJS integrations. Reading the status is an in-memory operation and never
queries PostgreSQL or the WhatsApp network:

```go
snapshot := client.GetConnectionStatus()
if snapshot.Status == events.ConnectionStatusOnline && snapshot.Connected && snapshot.Authenticated {
	// The authenticated socket is ready.
}
```

Status changes use the existing native event handler mechanism:

```go
handlerID := client.AddEventHandler(func(rawEvent any) {
	switch event := rawEvent.(type) {
	case *events.ConnectionStatus:
		fmt.Printf("status=%s sequence=%d\n", event.Status, event.Sequence)
	}
})
defer client.RemoveEventHandler(handlerID)
```

The wire statuses are `initializing`, `restoring`, `connecting`, `qr`,
`online`, `reconnecting`, `offline`, `logged_out`, `invalid_session`,
`conflict`, `lease_lost`, `handoff`, `stopped` and `error`.

`SessionValid` is tri-state (`nil`, `true` or `false`). `Sequence` increases
once per semantic transition, repeated equivalent transitions are suppressed,
and `ChangedAt` is UTC. Snapshots are detached copies; callers cannot mutate
the client's internal state or another handler's event. Events are delivered
in sequence order even when multiple goroutines report state concurrently.

`online` is fail-closed. Both the event transition and every later
`GetConnectionStatus` verify a live Noise socket, authenticated login, valid
registered credentials and the exact active PostgreSQL owner/fencing token/
generation/epoch. Fence reads use only the worker's atomic in-memory provider;
they do not query PostgreSQL. A disconnected cached socket is downgraded to
`reconnecting`/`offline`, while lease expiry or a takeover generation becomes
`lease_lost` synchronously. Late `Connected`/`Disconnected` callbacks cannot
resurrect or overwrite a terminal lifecycle state.

The normal socket, QR, pairing, reconnect, logout and conflict paths update the
status automatically. Session orchestration must additionally call:

- `MarkConnectionRestoring` before restoring a provider projection;
- `MarkConnectionHandoff` before draining for a provider handoff;
- `MarkConnectionHandoffSourceClosed` only after drain, transport close and the
  exact lease release are confirmed;
- `MarkConnectionLeaseAcquired` after an explicit lease reacquire and before
  reconnecting the same client lifecycle;
- `MarkConnectionLeaseLost` before immediately disconnecting a fenced writer;
- `MarkConnectionStopped` for an intentional stop;
- `MarkConnectionInvalidSession` when canonical validation rejects credentials;
- `MarkConnectionError` with a bounded machine code, never a raw error.

QR status is accepted only while the native session validity is still unknown
and the client is genuinely unpaired. A QR callback received for registered,
restoring or handoff state fails closed as `invalid_session`; the QR contents
are never copied into the status snapshot or event.

`logged_out`, `invalid_session`, `lease_lost` and `error` are sticky terminal
states. Late socket, reconnect, QR or orchestration callbacks cannot move that
client back to `online`. An intentional `stopped` client can only restart from
an explicit public `Connect` call after its store and current fence have been
validated; automatic reconnects and late callbacks cannot recover it. Other
recovery starts a new client lifecycle or uses the explicit, fence-validated
lease reacquire transition.

Neither snapshots nor status events contain QR data, JIDs, database URLs,
cookies, keys, tokens or raw error strings. QR payloads remain exclusively in
the existing `events.QR`/`GetQRChannel` APIs.

`handoff` is published with `connected=false` as soon as draining begins. This
matches the Baileys and WWebJS contract and prevents orchestration code from
treating a source socket that is only draining as an available channel.
While draining, the exact original lease remains mandatory. Only a confirmed
`handoff_source_closed` transition is lease-free; a missing/taken-over lease
before that boundary becomes sticky `lease_lost`. A later acquire clears this
exception before any reconnect is permitted.
