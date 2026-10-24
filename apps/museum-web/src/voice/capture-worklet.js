/* New museum capture adapter. Sends 20ms mono PCM16 frames at 16kHz. */
class MuseumCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.phase = 0;
    this.total = 0;
    this.count = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let index = 0; index < samples.length; index += 1) {
      this.total += samples[index];
      this.count += 1;
      this.phase += 16000;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.min(1, Math.max(-1, this.total / this.count));
      this.total = 0;
      this.count = 0;
      this.pending.push(Math.round(value * (value < 0 ? 32768 : 32767)));
      if (this.pending.length !== 320) continue;
      const pcm = Int16Array.from(this.pending);
      let energy = 0;
      for (const item of pcm) energy += (item / 32768) ** 2;
      this.port.postMessage({
        pcm: pcm.buffer,
        rms: Math.sqrt(energy / pcm.length),
        capturedAt: (currentFrame + index + 1) / sampleRate,
      }, [pcm.buffer]);
      this.pending = [];
    }
    return true;
  }
}
registerProcessor("museum-capture", MuseumCaptureProcessor);
