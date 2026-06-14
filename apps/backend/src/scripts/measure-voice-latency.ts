/**
 * Phase 5 latency harness.
 *
 * Usage:
 *   tsx apps/backend/src/scripts/measure-voice-latency.ts \
 *     --wav ./fixtures/sample-reply.wav \
 *     --interview-id smoke-1 \
 *     --url ws://localhost:3002/interviews/smoke-1/session
 *
 * Expects the Phase 5 ConductInterview WebSocket envelope:
 * `{ "type": "session.completed", "payload": ... }`, with Langfuse spans
 * rooted at `interview.session.agent`.
 *
 * The candidate WAV should contain at least one full utterance per agent turn.
 * Phase 4's hardcoded script was forgiving; the Phase 5 agent keeps going until
 * it calls `end_interview`. For smoke testing, prefer a recorded conversation
 * with 5-8 candidate utterances or expect the harness to hit the hard ceiling.
 *
 * TODO(phase-10): replace heuristic silence detection with explicit server
 * protocol frames such as `{ "type": "tts.end" }`.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import WebSocket from "ws";

interface Args {
  readonly wav: string;
  readonly interviewId: string;
  readonly url: string;
}

interface TurnMetric {
  readonly ttsFirstChunkMs: number;
  readonly roundTripMs: number | null;
  ttsBytes: number;
}

function parseCliArgs(): Args {
  const { values } = parseArgs({
    options: {
      wav: { type: "string" },
      "interview-id": { type: "string" },
      url: { type: "string" },
    },
  });

  if (!values.wav || !values["interview-id"] || !values.url) {
    throw new Error("--wav --interview-id --url are required");
  }

  return {
    wav: values.wav,
    interviewId: values["interview-id"],
    url: values.url,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const wavBytes = readFileSync(args.wav);
  const ws = new WebSocket(args.url);
  const turns: TurnMetric[] = [];
  let turnIndex = 0;
  let turnStartedAt = Date.now();
  let lastCandidateAudioEndedAt = 0;
  let lastBinaryReceivedAt = 0;
  let candidateStreaming = false;

  ws.on("open", () => {
    turnStartedAt = Date.now();
    console.log(`connected: ${args.url} interviewId=${args.interviewId}`);
  });

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const now = Date.now();
      lastBinaryReceivedAt = now;
      const bytes = Buffer.isBuffer(data) ? data.byteLength : data.toString().length;

      if (!turns[turnIndex]) {
        turns[turnIndex] = {
          ttsFirstChunkMs: now - turnStartedAt,
          roundTripMs: lastCandidateAudioEndedAt ? now - lastCandidateAudioEndedAt : null,
          ttsBytes: 0,
        };
      }

      turns[turnIndex]!.ttsBytes += bytes;
      return;
    }

    const envelope = JSON.parse(data.toString("utf-8")) as {
      type: string;
      payload?: {
        interviewId: string;
        turnsCompleted: number;
        transcript: unknown[];
        notes: unknown[];
        internalScores: unknown[];
        endReason: string | null;
        hardCeilingHit: boolean;
      };
    };

    if (envelope.type === "session.completed" && envelope.payload) {
      const { turnsCompleted, notes, internalScores, endReason, hardCeilingHit } = envelope.payload;
      console.log(
        `session.completed: turns=${turnsCompleted}, notes=${notes.length}, scores=${internalScores.length}, endReason=${endReason}, ceiling=${hardCeilingHit}`,
      );
      printMetrics(turns);
      ws.close();
    }
  });

  ws.on("close", (code, reason) => {
    console.log(`closed: ${code} ${reason.toString()}`);
  });

  ws.on("error", (error) => {
    console.error("ws error:", error);
    process.exitCode = 1;
  });

  const silenceTimer = setInterval(() => {
    if (candidateStreaming || !turns[turnIndex]) return;
    if (Date.now() - lastBinaryReceivedAt < 500) return;

    candidateStreaming = true;
    void streamCandidateAudio(ws, wavBytes).then(() => {
      lastCandidateAudioEndedAt = Date.now();
      turnIndex += 1;
      turnStartedAt = Date.now();
      candidateStreaming = false;
    });
  }, 100);

  ws.once("close", () => clearInterval(silenceTimer));
}

async function streamCandidateAudio(ws: WebSocket, wavBytes: Buffer): Promise<void> {
  const frameMs = 20;
  const frameBytes = Math.max(1, Math.floor(wavBytes.byteLength / 1500));

  for (let offset = 0; offset < wavBytes.byteLength; offset += frameBytes) {
    ws.send(wavBytes.subarray(offset, offset + frameBytes), { binary: true });
    await sleep(frameMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printMetrics(turns: ReadonlyArray<TurnMetric>): void {
  console.log("turn,tts_first_chunk_ms,tts_bytes,round_trip_ms");
  turns.forEach((turn, index) => {
    console.log(`${index},${turn.ttsFirstChunkMs},${turn.ttsBytes},${turn.roundTripMs ?? ""}`);
  });
}

void main();
