/* eslint-env worker */
/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// AudioWorkletProcessor — downsamples the mic input to 16 kHz mono linear16
// PCM and posts the bytes back to the main thread.
//
// Contract:
//   - Registered name: "pcm-downsampler"
//   - Input  : 1 channel float32 at AudioContext sampleRate (16k–48k typical)
//   - Output : main-thread message { pcm: ArrayBuffer (Int16 LE), rms: number }
//   - Uses linear interpolation; no anti-alias filter (the source is already
//     band-limited to ~8 kHz of useful speech content for STT).
//
// Kept as plain JS — Next 16 has no first-class AudioWorklet TS bundling.

class PCMDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.residual = []; // float32 samples carried over between process() calls
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    // Append new samples to residual buffer.
    for (let i = 0; i < channel.length; i++) this.residual.push(channel[i]);

    const ratio = sampleRate / this.targetRate;
    if (ratio <= 0 || !isFinite(ratio)) return true;

    const outLen = Math.floor(this.residual.length / ratio);
    if (outLen <= 0) return true;

    const pcm = new Int16Array(outLen);
    let rmsAcc = 0;
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const i0 = Math.floor(srcIdx);
      const i1 = Math.min(i0 + 1, this.residual.length - 1);
      const frac = srcIdx - i0;
      const sample = this.residual[i0] * (1 - frac) + this.residual[i1] * frac;
      // Clamp + convert to int16.
      const clamped = Math.max(-1, Math.min(1, sample));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      rmsAcc += sample * sample;
    }

    const consumed = Math.floor(outLen * ratio);
    this.residual.splice(0, consumed);

    const rms = Math.sqrt(rmsAcc / outLen);
    this.port.postMessage({ pcm: pcm.buffer, rms }, [pcm.buffer]);
    return true;
  }
}

registerProcessor("pcm-downsampler", PCMDownsampler);
