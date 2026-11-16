let audio: AudioContext | null = null;
let muted = localStorage.getItem('pageleaf-sound') === '0';

export function soundEnabled(): boolean {
  return !muted;
}

export function setSoundEnabled(on: boolean) {
  muted = !on;
  localStorage.setItem('pageleaf-sound', on ? '1' : '0');
}

export function unlockSound() {
  const ctx = context();
  if (ctx.state === 'suspended') void ctx.resume();
}

function context(): AudioContext {
  if (!audio) audio = new AudioContext();
  return audio;
}

/** A short paper rustle. `strength` is about 0.2 (tick) to 1 (page landing). */
export function rustle(strength: number) {
  if (muted) return;
  const ctx = context();
  if (ctx.state === 'suspended') return;
  const duration = 0.12 + strength * 0.08;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.82 + white * 0.18;
    const env = Math.sin((Math.PI * i) / length);
    data[i] = brown * env;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900 + strength * 1400;
  filter.Q.value = 0.65;
  const gain = ctx.createGain();
  gain.gain.value = 0.045 * strength;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}
