"use client";

import { useEffect, useRef } from "react";

const HOTPOT = "207, 242, 63";
const PULSE_COLORS = ["255, 92, 138", "255, 157, 61"]; // berry, tangerine
const BURST_COLOR = "255, 92, 138"; // berry

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

interface Pulse {
  a: number; // node index
  b: number; // node index
  t: number; // 0..1 progress along the edge
  color: string;
}

interface Burst {
  x: number;
  y: number;
  life: number; // 1 -> 0
}

const LINK_DIST = 210;
const SPEED = 0.16;

/// The dominant background texture: a dense, glowing node/edge mesh drifting
/// behind the cards, with colored pulses "confirming" along edges like
/// transactions settling on a live chain.
///
/// `activityTick` is an ever-increasing counter (pass events.length from
/// useActivityEvents) — each increase drops a bright shockwave on a random
/// node, so on-chain activity visibly ripples through the background instead
/// of being purely decorative. `urgent` speeds the whole mesh up during a
/// hot countdown / lottery reveal.
export function NodeNetwork({ activityTick = 0, urgent = false }: { activityTick?: number; urgent?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const burstsRef = useRef<Burst[]>([]);
  const urgentRef = useRef(urgent);
  urgentRef.current = urgent;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let pulses: Pulse[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;

    function seed() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(160, Math.max(60, Math.floor((w * h) / 11000)));
      nodesRef.current = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: 1.4 + Math.random() * 1.6,
      }));
      pulses = [];
      burstsRef.current = [];
    }

    function maybeSpawnPulse(edges: [number, number][]) {
      if (edges.length === 0) return;
      if (pulses.length >= 10) return;
      if (Math.random() > (urgentRef.current ? 0.12 : 0.05)) return;
      const [a, b] = edges[Math.floor(Math.random() * edges.length)];
      pulses.push({ a, b, t: 0, color: PULSE_COLORS[Math.floor(Math.random() * PULSE_COLORS.length)] });
    }

    function frame() {
      const nodes = nodesRef.current;
      const speedMul = urgentRef.current ? 1.8 : 1;
      ctx!.clearRect(0, 0, w, h);
      const edges: [number, number][] = [];

      for (const n of nodes) {
        n.x += n.vx * speedMul;
        n.y += n.vy * speedMul;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }

      ctx!.shadowBlur = 0;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < LINK_DIST) {
            edges.push([i, j]);
            const alpha = (1 - dist / LINK_DIST) * 0.55;
            ctx!.strokeStyle = `rgba(${HOTPOT}, ${alpha})`;
            ctx!.lineWidth = 1;
            ctx!.beginPath();
            ctx!.moveTo(nodes[i].x, nodes[i].y);
            ctx!.lineTo(nodes[j].x, nodes[j].y);
            ctx!.stroke();
          }
        }
      }

      ctx!.shadowColor = `rgba(${HOTPOT}, 0.9)`;
      ctx!.shadowBlur = 6;
      for (const n of nodes) {
        ctx!.fillStyle = `rgba(${HOTPOT}, 0.75)`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.shadowBlur = 0;

      if (!reduceMotion) {
        maybeSpawnPulse(edges);
        pulses = pulses.filter((p) => p.t < 1);
        ctx!.shadowBlur = 8;
        for (const p of pulses) {
          const na = nodes[p.a];
          const nb = nodes[p.b];
          if (!na || !nb) {
            p.t = 1;
            continue;
          }
          const x = na.x + (nb.x - na.x) * p.t;
          const y = na.y + (nb.y - na.y) * p.t;
          ctx!.shadowColor = `rgba(${p.color}, 0.9)`;
          ctx!.fillStyle = `rgba(${p.color}, ${0.95 * (1 - Math.abs(p.t - 0.5) * 0.6)})`;
          ctx!.beginPath();
          ctx!.arc(x, y, 3, 0, Math.PI * 2);
          ctx!.fill();
          p.t += 0.011 * speedMul;
        }
        ctx!.shadowBlur = 0;

        // Activity shockwaves — an expanding, fading ring dropped wherever a
        // burst landed (see the activityTick effect below).
        burstsRef.current = burstsRef.current.filter((b) => b.life > 0);
        for (const b of burstsRef.current) {
          const radius = (1 - b.life) * 90;
          ctx!.strokeStyle = `rgba(${BURST_COLOR}, ${b.life})`;
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          ctx!.arc(b.x, b.y, radius, 0, Math.PI * 2);
          ctx!.stroke();
          b.life -= 0.02;
        }

        raf = requestAnimationFrame(frame);
      }
    }

    seed();
    window.addEventListener("resize", seed);

    if (reduceMotion) {
      frame(); // draw one static mesh, no pulses, no loop
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", seed);
    };
  }, []);

  // Fires a shockwave on a random node whenever new on-chain activity comes
  // in. Skips tick 0 (initial mount) so nothing fires before real data exists.
  const primedTick = useRef(false);
  useEffect(() => {
    if (!primedTick.current) {
      primedTick.current = true;
      return;
    }
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;
    const n = nodes[Math.floor(Math.random() * nodes.length)];
    burstsRef.current.push({ x: n.x, y: n.y, life: 1 });
  }, [activityTick]);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />;
}
