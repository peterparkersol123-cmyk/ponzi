import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "icp:soundEnabled";

/** Sound is opt-in and remembered per-browser — defaults off so the page
 *  never makes noise on a first, unexpected visit. */
export function useSoundEnabled(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = useCallback(() => {
    setEnabled((e) => {
      const next = !e;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return [enabled, toggle];
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function tone(freq: number, durationMs: number, type: OscillatorType, gainPeak: number, delayMs = 0) {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") c.resume();

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const start = c.currentTime + delayMs / 1000;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainPeak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

/** Soft blip for a qualifying buy. */
export function playBlip() {
  tone(880, 120, "sine", 0.08);
}

/** Bigger three-note chime for a payout. */
export function playChime() {
  tone(660, 220, "triangle", 0.09);
  tone(990, 260, "triangle", 0.08, 90);
  tone(1320, 320, "triangle", 0.07, 180);
}
