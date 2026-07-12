// Sound effects synthesized with the Web Audio API — no audio files, fully
// offline. The AudioContext is created lazily and resumed on first use (sounds
// only ever fire from user gestures: a click or keypress).
import { useSettings } from '../store/settingsStore';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  /** Start offset in seconds from now. */
  at: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
}

function play(notes: Note[]) {
  // Sound toggle + master volume (0–100) from settings, checked here so no
  // caller has to. Skip work entirely when muted.
  const { soundOn, volume } = useSettings.getState();
  const vol = volume / 100;
  if (!soundOn || vol <= 0) return;
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  for (const n of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    const start = now + n.at;
    const end = start + n.dur;
    const peak = (n.gain ?? 0.3) * vol;
    osc.type = n.type ?? 'sine';
    osc.frequency.value = n.freq;
    // Quick attack, smooth exponential release to avoid clicks.
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/** Soft click when a country is picked. */
export function playSelect() {
  play([{ freq: 440, at: 0, dur: 0.07, type: 'triangle', gain: 0.22 }]);
}

/** Rising two-tone chime for a correct answer. */
export function playCorrect() {
  play([
    { freq: 660, at: 0, dur: 0.12, type: 'sine', gain: 0.34 },
    { freq: 990, at: 0.1, dur: 0.2, type: 'sine', gain: 0.34 },
  ]);
}

/** Low descending buzz for a wrong answer. */
export function playWrong() {
  play([
    { freq: 220, at: 0, dur: 0.16, type: 'sawtooth', gain: 0.26 },
    { freq: 150, at: 0.12, dur: 0.24, type: 'sawtooth', gain: 0.26 },
  ]);
}
