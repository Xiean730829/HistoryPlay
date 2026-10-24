/** Explicit local generation. A cloud tts.start must never reset this generation. */
export class PlaybackQueue {
  private sources = new Set<AudioBufferSourceNode>();
  private generation = 0;
  private nextTime = 0;
  private drained: (() => void)[] = [];

  constructor(private readonly context: AudioContext) {}

  get epoch(): number {
    return this.generation;
  }

  enqueue(pcm: Int16Array, sampleRate: number, epoch: number): boolean {
    if (epoch !== this.generation || pcm.length === 0 || !Number.isFinite(sampleRate)
      || sampleRate < 8000 || sampleRate > 48000) {
      return false;
    }
    const buffer = this.context.createBuffer(1, pcm.length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) data[i] = pcm[i] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (epoch === this.generation && this.sources.size === 0) {
        const callbacks = this.drained.splice(0);
        for (const callback of callbacks) callback();
      }
    };
    const startAt = Math.max(this.context.currentTime + 0.02, this.nextTime);
    this.nextTime = startAt + buffer.duration;
    source.start(startAt);
    return true;
  }

  /** Must happen synchronously before forwarding speech_started/abort to a bridge. */
  stop(): number {
    this.generation += 1;
    this.drained = [];
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
    return this.generation;
  }

  onDrained(epoch: number, callback: () => void): void {
    if (epoch !== this.generation) return;
    if (this.sources.size === 0) callback();
    else this.drained.push(callback);
  }
}
