/**
 * MediaSource-backed MP3 playback queue. Server-side TTS chunks (ElevenLabs
 * `mp3_44100_128`) arrive as binary WebSocket frames; we feed them into a
 * single `<audio>` element via a `SourceBuffer` of type `audio/mpeg`.
 *
 * Lifecycle:
 *  - constructor: create <audio>, MediaSource, set src to objectURL.
 *  - `sourceopen`: addSourceBuffer; start draining the pending queue.
 *  - enqueue(): push chunk; drain runs on `updateend`.
 *  - dispose(): pause audio + null src so the resource is collectable.
 *
 * No backpressure handling — server emits at near-real-time pace, so a small
 * pending queue is sufficient. If it grows pathologically, the page is
 * already in trouble and the connection-loss UX will take over.
 */
// ElevenLabs streams MP3 at ~16 KB/s; 64 chunks ≈ 1–2 s of audio. If the
// queue grows past this (e.g. tab backgrounded for tens of seconds) we
// drop the oldest chunks rather than letting memory grow unbounded.
const MAX_PENDING_CHUNKS = 64;

export class AudioPlaybackQueue {
  private readonly audioEl: HTMLAudioElement;
  private readonly mediaSource: MediaSource;
  private sourceBuffer: SourceBuffer | null = null;
  private readonly pending: Uint8Array[] = [];
  private disposed = false;

  constructor() {
    this.audioEl = new Audio();
    this.audioEl.autoplay = true;
    this.mediaSource = new MediaSource();
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener("sourceopen", this.onSourceOpen);
  }

  private readonly onSourceOpen = (): void => {
    if (this.disposed) return;
    try {
      this.sourceBuffer = this.mediaSource.addSourceBuffer("audio/mpeg");
      this.sourceBuffer.addEventListener("updateend", this.drain);
      this.drain();
    } catch {
      // SourceBuffer construction failed (likely Safari rejecting audio/mpeg).
      // The pre-interview check is supposed to have caught this — silently
      // swallow here.
    }
  };

  enqueue(chunk: Uint8Array): void {
    if (this.disposed) return;
    this.pending.push(chunk);
    while (this.pending.length > MAX_PENDING_CHUNKS) this.pending.shift();
    this.drain();
  }

  private readonly drain = (): void => {
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    const next = this.pending.shift();
    if (!next) return;
    try {
      this.sourceBuffer.appendBuffer(new Uint8Array(next));
    } catch {
      // If appendBuffer throws, drop the chunk — the connection-loss UX
      // will surface the broken state at the WS layer if it persists.
    }
  };

  /** Read-only — only intended for tests + diagnostics. */
  get pendingLength(): number {
    return this.pending.length;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.audioEl.pause();
      this.audioEl.src = "";
    } catch {
      /* ignore */
    }
  }
}
