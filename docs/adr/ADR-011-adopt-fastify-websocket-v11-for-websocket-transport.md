# ADR-011 Adopt @fastify/websocket v11 for WebSocket Transport in the Voice Pipeline

## Status

Accepted. Date: 2026-05-10.

## Context

Phase 4 introduces a real-time endpoint `GET /interviews/:id/session` that upgrades an HTTP connection to a WebSocket. The browser streams raw binary audio frames to the backend, which pipes them into Deepgram (STT) and writes ElevenLabs audio chunks back to the browser. The WebSocket library choice is architecturally significant for three reasons:

1. It determines how the HTTP upgrade handshake is wired into Fastify's route lifecycle, specifically whether authentication and validation hooks fire before the upgrade.
2. It sets the message-handling API (`ws.on("message", (data, isBinary) => …)`) and frame-size cap that the presentation controller and the `voice-websocket.ts` adapter depend on.
3. It must be version-compatible with Fastify 5, which introduced breaking API changes relative to Fastify 4, making the library version a non-trivial constraint rather than a mere semver bump.

The project already runs Fastify 5 (established before Phase 4; no ADR is being superseded). Audio frames in the Phase 4 implementation are 20-ms PCM chunks at 16 kHz mono linear16, which yields approximately 640 bytes per frame. The 1 MiB maxPayload cap chosen here is therefore three orders of magnitude above normal operating frame size.

This ADR covers the presentation-layer transport only. The application-layer streaming contracts (`AsyncIterable<Uint8Array>` in/out) are governed by ADR-010. The choice of STT and TTS vendors (Deepgram and ElevenLabs) is governed by ADR-002.

## Decision

Add `@fastify/websocket ^11.0.0` as a production dependency of the backend app. Register it as a Fastify plugin with a 1 MiB per-frame maxPayload cap:

```typescript
// apps/backend/src/app.ts:18-20
await app.register(websocket, {
  options: { maxPayload: 1024 * 1024 },
});
```

WebSocket routes are declared with the `{ websocket: true }` route option. This gives each handler a typed `WebSocket` handle (re-exported from the underlying `ws` library) and a standard `FastifyRequest`, letting Fastify's hook chain (authentication, request parsing) execute before the upgrade completes.

Binary audio frames are received via `ws.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => …)`. The presentation-layer helper `wsBinaryToAsyncIterable` (at `apps/backend/src/presentation/websocket/voice-websocket.ts`) adapts these events into an `AsyncIterable<Uint8Array>` backed by an `AsyncQueue`. The outbound helper `sendBinaryFrame` wraps `ws.send(chunk, { binary: true }, callback)` in a `Promise`. Both helpers are the only files in the codebase that import `WebSocket` from `@fastify/websocket`. The `InterviewSessionController` consumes them and passes the resulting `AsyncIterable` and sink callback to the use case, keeping the use case free of all WebSocket types, as required by ADR-001 and ADR-010.

## Alternatives Considered

### Alternative A: Raw `ws` package with manual Fastify lifecycle integration

The `ws` library is the underlying WebSocket engine that `@fastify/websocket` wraps. It could be used directly by intercepting Fastify's `rawRequest` inside a `preClose` hook to call `ws.handleUpgrade`, then emitting the resulting `WebSocket` instance into a `WebSocketServer`.

Rejected because: Fastify 5 changed its internal request handling in ways that make manual upgrade interception fragile. The `@fastify/websocket` plugin encapsulates the correct `upgrade` event wiring and `preClose` / `close` lifecycle management for Fastify 5. Reimplementing this correctly would require ongoing maintenance against Fastify internals and risks subtle lifecycle bugs (for example, the connection draining behaviour during graceful shutdown). The added complexity brings no capability benefit.

### Alternative B: socket.io

Socket.IO ships its own framing layer (the Socket.IO wire format) on top of the raw WebSocket transport. The browser must load the `socket.io-client` library to decode this framing. Socket.IO adds features such as namespaces, rooms, automatic reconnection, and fallback to long-polling.

Rejected because: the voice pipeline requires raw binary frames, not Socket.IO's text-envelope protocol. Sending PCM or MP3 audio over Socket.IO would require either encoding the binary payload as base64 inside a JSON event (lossy performance trade-off) or using Socket.IO's binary event type, which still wraps data in a custom framing header. Neither approach integrates cleanly with the `Buffer`-based `ws.on("message")` API that `wsBinaryToAsyncIterable` expects. The Socket.IO reconnection and room features are irrelevant to Phase 4 and would be dead weight in the bundle.

### Alternative C: Native Node.js 22 built-in WebSocket

Node 22 ships a native `WebSocket` class (exposed as `globalThis.WebSocket`). This is a client-side API for initiating WebSocket connections from Node code, matching the browser `WebSocket` API.

Rejected because: Node 22 provides a WebSocket client but not a WebSocket server. There is no `WebSocketServer` in the Node 22 standard library. A server-side listener requires a third-party library regardless; this alternative therefore reduces to choosing `ws` directly (Alternative A) or `@fastify/websocket` (the chosen option).

### Alternative D: Do nothing (defer WebSocket support)

The voice pipeline could be deferred to a later phase and Phase 4 could focus solely on the application-layer port contracts without a live transport.

Rejected because: Phase 4's explicit goal is to prove the end-to-end voice loop including the browser-to-backend audio stream. A latency measurement (audio-in to first-TTS-chunk-out) is a Phase 4 deliverable documented in the plan at `.claude/plan/phase-4-voice-pipeline-spike.md`. Deferring transport would block that measurement and leave the STT and TTS adapters untested against a real binary stream.

## Consequences

**Benefits**

- Fastify route hooks (authentication, schema validation) execute before the WebSocket upgrade, providing the same security guarantees as standard HTTP routes at zero additional wiring cost.
- The `{ websocket: true }` option is declared inline in the route registration (`apps/backend/src/presentation/routes/interview-session.ws.ts:15`), making WebSocket routes visually distinct from REST routes without a separate router.
- The 1 MiB maxPayload cap prevents runaway clients from allocating large server-side buffers. A 20-ms audio frame at 16 kHz mono linear16 is approximately 640 bytes; the cap is roughly 1,600x the expected frame size, leaving substantial margin for codec differences while bounding the worst case.
- `@fastify/websocket` v11 is the officially maintained plugin for Fastify 5. It inherits Fastify's graceful-shutdown handling and is tested against the same Fastify version matrix used in this project.

**Trade-offs**

- The `WebSocket` type imported from `@fastify/websocket` is a re-export of the `ws` library type. Any future swap to a different WebSocket server library (for example, `uWebSockets.js`) would require changes to `voice-websocket.ts` and `interview-session.controller.ts` in the presentation layer only, but it would still be a code change rather than a configuration change.
- Adding `@fastify/websocket` as a direct production dependency means the backend must track `@fastify/websocket` major versions in lockstep with Fastify major versions. A future Fastify 6 upgrade would require verifying `@fastify/websocket` compatibility before upgrading either.

**Risks and mitigations**

- *Risk*: A future Fastify major version breaks `@fastify/websocket` v11 compatibility silently (TypeScript compiles but runtime behaviour differs). *Mitigation*: The Enforcement block (below) requires `@fastify/websocket` to remain on `^11` in `apps/backend/package.json` until explicitly superseded; any bump to `^12` or higher triggers a review prompt. The integration test at `apps/backend/src/presentation/routes/interview-session.ws.test.ts` exercises the upgrade handshake on every CI run.
- *Risk*: A developer imports `WebSocket` from `@fastify/websocket` inside a use-case file, violating ADR-001's layer separation. *Mitigation*: The Enforcement block forbids `@fastify/websocket` imports in `packages/application/**`. ADR-010's Enforcement block independently forbids `ws` imports in `packages/application/src/use-cases/**`. The `wsBinaryToAsyncIterable` adapter in `voice-websocket.ts` is the single designated translation point.

## Related Decisions

- **ADR-001 (Adopt Clean Architecture and DDD with Immutable Entities and Result/Option Error Handling)**: `@fastify/websocket` types are confined to the presentation layer. The `WebSocket` type does not appear in any use case, DTO, or domain file. This ADR implements the presentation-boundary rule of ADR-001 for the WebSocket transport.
- **ADR-002 (Use Sandwich Architecture for Voice Interviews)**: The `GET /interviews/:id/session` WebSocket endpoint is the entry point of the browser-to-Deepgram audio leg (the inbound side of the sandwich). This ADR specifies the transport mechanism for that entry point.
- **ADR-010 (Use AsyncIterable Stream Contracts for STT and TTS Application Ports)**: The presentation controller uses `wsBinaryToAsyncIterable` and `sendBinaryFrame` (both in `voice-websocket.ts`) to translate between the `@fastify/websocket` message API and the `AsyncIterable<Uint8Array>` / `(chunk: Uint8Array) => Promise<void>` shapes required by the use case. ADR-011 depends on ADR-010.

## References

- Plugin registration: `apps/backend/src/app.ts` lines 2, 18-20
- Route declaration (websocket: true): `apps/backend/src/presentation/routes/interview-session.ws.ts` line 15
- WebSocket adapter helpers: `apps/backend/src/presentation/websocket/voice-websocket.ts`
- Controller WebSocket usage: `apps/backend/src/presentation/controllers/interview-session.controller.ts` lines 3, 34, 57-58
- Dependency declaration: `apps/backend/package.json` (`@fastify/websocket: ^11.0.0` at line 23)
- Phase 4 plan section D5: `.claude/plan/phase-4-voice-pipeline-spike.md`
- @fastify/websocket GitHub repository: https://github.com/fastify/fastify-websocket
- `ws` library (underlying engine): https://github.com/websockets/ws

## Enforcement

Declarative: the rules map cleanly to import pattern matching and a version pin check on the dependency manifest.

```json
{
  "forbid_import": [
    {
      "pattern": "from ['\"]@fastify/websocket['\"]",
      "path_glob": "packages/application/**/*.ts",
      "message": "Application-layer code must not import @fastify/websocket. Convert WebSocket events to AsyncIterable at the presentation boundary (ADR-011, ADR-001)."
    },
    {
      "pattern": "from ['\"]@fastify/websocket['\"]",
      "path_glob": "packages/domain/**/*.ts",
      "message": "Domain-layer code must not import @fastify/websocket (ADR-011, ADR-001)."
    }
  ],
  "forbid_pattern": [
    {
      "pattern": "\"@fastify/websocket\":\\s*\"\\^(?!11\\.)",
      "path_glob": "apps/backend/package.json",
      "message": "Pin @fastify/websocket to ^11 while on Fastify 5. A major-version bump requires explicit review (ADR-011)."
    }
  ],
  "require_pattern": [],
  "llm_judge": false
}
```
