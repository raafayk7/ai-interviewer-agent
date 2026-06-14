---
name: frontend-voice-pipeline
description: Write, review, or reason about the candidate voice interview UI — anything touching the WebSocket lifecycle, MediaRecorder microphone capture, server-streamed TTS audio playback queue, reconnect/backoff, or the connection state machine. Lives in apps/web/src/containers/InterviewSessionContainer/ and its co-located helpers (AudioPlaybackQueue, reconnect backoff). Read backend ADR-002 (voice pipeline), ADR-010 (transport), ADR-011 (codec), ADR-017 (candidate signed-link auth) before coding. Use this skill when the user asks about WebSocket handlers, getUserMedia, MediaRecorder, AudioContext playback, barge-in/interruption, reconnect strategy, or candidate session state. Use proactively whenever the user is touching WebSocket, MediaRecorder, audio playback, the voice interview UI, or apps/web/src/containers/InterviewSessionContainer/.
user-invocable: true
version: 1.0.0
---

# Voice Pipeline (`InterviewSessionContainer`)

The voice pipeline is the most complex container in the frontend. It owns a WebSocket connection to the backend voice pipeline, a browser microphone capture, a streaming audio playback queue (for server TTS chunks), and a connection state machine. It is one feature but four subsystems, and they must coordinate cleanly.

**Before writing code, read** backend ADR-002 (voice pipeline architecture), ADR-010 (WS transport / protocol), ADR-011 (audio chunking and codec), ADR-017 (candidate signed-link auth). The wire protocol decisions live there.

**Location:** `apps/web/src/containers/InterviewSessionContainer/`

---

## Why this needs its own skill

The session container has a different shape than a CRUD container — TanStack Query is the wrong tool because audio is a stream, not a query; mutations are too coarse because we exchange small chunks at high frequency. Modeling the session as an explicit state machine plus refs to long-lived resources is what keeps this tractable.

---

## State machine — the canonical states

| State | Meaning |
|---|---|
| `IDLE` | Page loaded, signed link already verified by the layout, not yet connected |
| `REQUESTING_MIC` | Awaiting `getUserMedia` resolution |
| `CONNECTING` | WS handshake in flight |
| `CONNECTED` | WS open, mic streaming, playback queue active |
| `RECONNECTING` | WS closed unexpectedly, backoff timer running |
| `ENDED` | Interview completed normally — close code 1000 from server |
| `ERROR` | Unrecoverable: mic denied, signed link rejected, max retries exceeded |

Implement with `useReducer` (or a small XState chart). Transitions are explicit — never toggle booleans across multiple effects. A single reducer is much easier to reason about than scattered state.

---

## Auth handoff

The route layout has already verified the signed link server-side (per ADR-017). The container receives the token as a prop. Use it as a `?token=...` query parameter on the WS URL (or as a `Sec-WebSocket-Protocol` subprotocol, depending on what the backend prefers per ADR-010). The container does not re-verify the signature — the route did that. The container just uses the token.

Do not read the token from `window.location` inside the container. Receiving it as a prop keeps the container testable and the responsibility clear: the route gates, the container connects.

---

## Container hook skeleton

```ts
"use client"
import { useEffect, useReducer, useRef } from "react"

type State =
  | { kind: "IDLE" }
  | { kind: "REQUESTING_MIC" }
  | { kind: "CONNECTING" }
  | { kind: "CONNECTED" }
  | { kind: "RECONNECTING"; attempt: number; nextDelayMs: number }
  | { kind: "ENDED" }
  | { kind: "ERROR"; message: string }

type Event =
  | { type: "START" }
  | { type: "MIC_GRANTED"; stream: MediaStream }
  | { type: "MIC_DENIED" }
  | { type: "WS_OPEN" }
  | { type: "WS_CLOSE"; code: number }
  | { type: "WS_ERROR" }
  | { type: "INTERVIEW_DONE" }
  | { type: "MAX_RETRIES" }

function reducer(state: State, event: Event): State {
  // Explicit transitions only. Every state × event combination should be covered
  // (or fall through with `return state` for ignored events).
}

export function useInterviewSession({ sessionId, token }: { sessionId: string; token: string }) {
  const [state, dispatch] = useReducer(reducer, { kind: "IDLE" } as State)
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const playbackRef = useRef<AudioPlaybackQueue | null>(null)
  // connect / cleanup logic
}
```

Long-lived resources (`WebSocket`, `MediaStream`, `MediaRecorder`, `AudioContext`) live in refs because they outlive renders. They are imperative, the state machine is declarative — refs are the bridge.

---

## Microphone capture

```ts
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
})
```

Wrap in try/catch — a denial dispatches `MIC_DENIED` and we transition to `ERROR` with a clear "allow microphone" message.

Pick a `MediaRecorder` mimeType the backend supports per ADR-011 — typically `audio/webm;codecs=opus`. Verify support and fall back gracefully:

```ts
const candidate = "audio/webm;codecs=opus"
const mimeType = MediaRecorder.isTypeSupported(candidate) ? candidate : ""  // browser default
const recorder = new MediaRecorder(stream, { mimeType })
recorder.ondataavailable = (e) => {
  if (e.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(e.data) // binary frame
  }
}
recorder.start(250) // emit a chunk every 250ms — adjust per ADR-011
```

On every exit path (state `ENDED`, `ERROR`, or unmount), stop the recorder and release the tracks:

```ts
recorderRef.current?.stop()
streamRef.current?.getTracks().forEach((t) => t.stop())
```

Forgetting the `track.stop()` call leaves the OS-level mic indicator on, which is alarming to candidates and a hard-to-debug bug because the React tree has long since unmounted.

---

## Server → client audio playback queue

The backend streams TTS chunks as binary WS frames. They must play in order without gaps. Use a Web Audio API context + a tiny scheduling queue. Each chunk is decoded, then scheduled at `max(cursor, ctx.currentTime)`, and `cursor` advances by the buffer's duration.

```ts
export class AudioPlaybackQueue {
  private ctx = new AudioContext()
  private cursor = this.ctx.currentTime
  private nodes: AudioBufferSourceNode[] = []

  async enqueue(chunk: ArrayBuffer) {
    const buffer = await this.ctx.decodeAudioData(chunk.slice(0))
    const start = Math.max(this.cursor, this.ctx.currentTime)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.ctx.destination)
    src.start(start)
    this.nodes.push(src)
    this.cursor = start + buffer.duration
  }

  flush() {
    this.nodes.forEach((n) => {
      try { n.stop() } catch { /* already stopped */ }
    })
    this.nodes = []
    this.cursor = this.ctx.currentTime
  }

  close() {
    this.flush()
    this.ctx.close().catch(() => undefined)
  }
}
```

`flush()` exists for barge-in: when the candidate starts speaking and we want to interrupt the agent, we drop pending playback. Whether `flush()` is triggered by the server (sending an "interrupt" message) or detected locally (VAD) depends on ADR-002 — wire it accordingly.

Note: many browsers require a user gesture before `AudioContext` can produce sound. Create the context inside the `START` event handler (i.e., from a Click), not at module load.

---

## Reconnect / backoff

On unexpected `WS_CLOSE` (code not in `{1000, 1001}`), transition to `RECONNECTING` with exponential backoff plus jitter:

```ts
function nextDelay(attempt: number) {
  const base = 500    // ms
  const max = 8000    // ms cap
  const jitter = Math.random() * 250
  return Math.min(max, base * 2 ** attempt) + jitter
}
```

Cap attempts (e.g., 5). On exceed → dispatch `MAX_RETRIES` → `ERROR`. The cap prevents an infinite reconnect loop during a long outage; jitter prevents a thundering herd if many clients all retry at the same instant.

Distinguish close codes carefully. Normal close (`1000`) means the server is done — never auto-reconnect on that. `1001` (going away) is the server shutting down; treat it as normal end. Anything else is unexpected.

During `RECONNECTING`, pause MediaRecorder emission. Whether you buffer chunks locally or drop them depends on the backend's resume semantics (ADR-010). Buffering risks unbounded memory growth on a long outage; dropping risks gaps in transcription. Check the ADR.

---

## Cleanup contract — strict

Any path that ends the session must perform the same four steps, in this order:

1. Close the WS with code `1000` if still open
2. Stop the `MediaRecorder`
3. Stop every track on the `MediaStream`
4. `flush()` and `close()` the `AudioPlaybackQueue`

Define a single idempotent `cleanup()` ref and call it from both the `useEffect` return and any terminal state transition handler. Idempotence matters — you may enter cleanup from multiple paths in quick succession (server end + unmount in the same tick).

```ts
const cleanup = () => {
  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close(1000)
  recorderRef.current?.state === "recording" && recorderRef.current.stop()
  streamRef.current?.getTracks().forEach((t) => t.stop())
  playbackRef.current?.close()
  wsRef.current = null; recorderRef.current = null
  streamRef.current = null; playbackRef.current = null
}
```

---

## UI surface

The container component is a switch on `state.kind`:
- `IDLE` → CTA composite with a "Start interview" button
- `REQUESTING_MIC` → "Allow microphone access" prompt
- `CONNECTING` → connecting spinner
- `CONNECTED` → live indicator (speaking pulse) + running transcript composite
- `RECONNECTING` → reconnecting banner with attempt number
- `ENDED` → summary / thank-you composite
- `ERROR` → error composite with the message and (where applicable) a retry button

All visuals are composites. The container holds no raw HTML beyond the switch.

---

## What is forbidden

- Spreading WS event handlers across multiple `useEffect` hooks — coordinate through the state machine reducer instead
- Calling `fetch()` to ping the backend for liveness — the WS protocol defines keepalive
- Reading the signed-link token from `window.location` inside the container — receive it as a prop
- Forgetting `track.stop()` on unmount or end — leaves the OS mic indicator on
- `setTimeout` chained recursion for backoff without jitter (thundering herd) or without a cap (infinite loop)
- Putting reconnect logic in a hook that isn't the session hook — it can't see WS state cohesively
- Auto-reconnecting on close code `1000` — the server is saying "we're done"
- Storing audio chunks in TanStack Query cache — wrong tool, it's a stream not a query
- Importing `@repo/domain` or `@repo/application`
- Creating `AudioContext` at module scope — many browsers require a user gesture before it can produce sound

---

## File layout

```
apps/web/src/containers/InterviewSessionContainer/
├── InterviewSessionContainer.tsx     ← thin shell, switches on state.kind
├── useInterviewSession.ts            ← reducer + WS + recorder + playback orchestration
├── AudioPlaybackQueue.ts             ← Web Audio playback queue
├── reconnect.ts                      ← backoff helper (testable in isolation)
└── index.ts
```

Keeping `AudioPlaybackQueue` and `reconnect` as standalone modules lets you unit-test them without spinning up the whole hook.

---

## When in doubt

Voice pipelines fail in ways UI bugs don't — a dangling `MediaStream` means a red mic indicator on the user's OS, long after the React tree has unmounted. Hold the state machine sacred, and clean up on every exit path.
