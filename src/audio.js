// All sound is made on the fly from filtered noise, so there is nothing to download and nothing to license:
// wind that roars with speed, the hiss of the board on sand, and a thump when you land.

export function createRideAudio() {
  let ctx = null, wind = null, hiss = null, master = null;

  function noiseBuffer(seconds = 2) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function loop(type, frequency, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(); src.loop = true;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master); src.start();
    return { filter, gain };
  }

  // Must be called from a click (browsers only allow sound after one).
  function start() {
    if (ctx) { ctx.resume?.(); return; }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    wind = loop('bandpass', 500, 0.7);
    hiss = loop('highpass', 2400, 0.4);
  }

  // speed in m/s, grounded: on the sand, carve: 0..1 how hard you are turning.
  function update(speed, grounded, carve = 0) {
    if (!ctx) return;
    const t = ctx.currentTime, v = Math.min(speed / 26, 1.2);
    wind.gain.gain.setTargetAtTime(0.03 + 0.42 * v * v, t, 0.15);
    wind.filter.frequency.setTargetAtTime(320 + 900 * v, t, 0.2);
    hiss.gain.gain.setTargetAtTime(grounded ? Math.min(0.32, 0.04 + 0.22 * v + 0.12 * carve) : 0, t, grounded ? 0.05 : 0.02);
    hiss.filter.frequency.setTargetAtTime(1800 + 1600 * v, t, 0.1);
  }

  function thump(strength = 1) {
    if (!ctx) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(0.4);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, 0.25 + 0.6 * strength), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(master); src.start(); src.stop(t + 0.4);
  }

  function chime(up = true) {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [i, hz] of (up ? [660, 880, 1320] : [520]).entries()) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.5);
      o.connect(g).connect(master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.55);
    }
  }

  function silence() { if (ctx) update(0, false); }

  return { start, update, thump, chime, silence };
}
