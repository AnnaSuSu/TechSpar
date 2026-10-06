/* global AudioWorkletProcessor, registerProcessor */
// Level calculation adapted from Meetily audio/level_monitor.rs (MIT).
// Copyright (c) 2024 Zackriya Solutions. See docs/third-party/meetily.md.
class CopilotPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1600); // 100 ms at the context's 16 kHz.
    this.offset = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.samples[this.offset++] = sample / channels.length;
      if (this.offset !== this.samples.length) continue;
      const pcm = new ArrayBuffer(this.samples.length * 2);
      const view = new DataView(pcm);
      let sum = 0;
      let peak = 0;
      for (let j = 0; j < this.samples.length; j++) {
        const value = Math.max(-1, Math.min(1, this.samples[j]));
        sum += value * value;
        peak = Math.max(peak, Math.abs(value));
        view.setInt16(j * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
      const rms = Math.sqrt(sum / this.samples.length);
      this.port.postMessage({ pcm, rms, peak, active: rms > 0.001 }, [pcm]);
      this.offset = 0;
    }
    return true;
  }
}

registerProcessor('copilot-pcm', CopilotPcmProcessor);
