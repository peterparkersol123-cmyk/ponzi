"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPanel } from "./TerminalPanel";

declare global {
  interface Window {
    twttr?: {
      widgets: { load: (el?: HTMLElement) => void };
      events: { bind: (event: "loaded" | "rendered", cb: () => void) => void };
    };
  }
}

const HANDLE = "ICPxRh";
const PROFILE_URL = `https://x.com/${HANDLE}`;

/** Real, live feed — X's official embedded-timeline widget for the
 *  configured HANDLE. No API key needed (it's X's public embed), but the
 *  tweets themselves render inside X's own iframe/chrome, only themed dark
 *  to blend in. Falls back to a "view on X" card if the widget is slow,
 *  blocked by the viewer's browser, or the account has no posts yet — and to
 *  a "coming soon" placeholder entirely if no HANDLE is set yet. */
export function XFeed() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "timeout">("loading");

  useEffect(() => {
    if (!HANDLE) return;

    const verify = () => {
      const ok = [...(hostRef.current?.querySelectorAll("iframe") ?? [])].some(
        (f) => f.offsetWidth > 0 && f.offsetHeight > 0,
      );
      setStatus(ok ? "loaded" : "timeout");
    };

    const render = () => {
      window.twttr?.widgets.load(hostRef.current ?? undefined);
      window.twttr?.events.bind("loaded", () => setTimeout(verify, 400));
    };

    if (window.twttr) {
      render();
    } else {
      const existing = document.getElementById("twitter-wjs");
      if (existing) {
        existing.addEventListener("load", render, { once: true });
      } else {
        const script = document.createElement("script");
        script.id = "twitter-wjs";
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        script.addEventListener("load", render, { once: true });
        document.body.appendChild(script);
      }
    }

    const timeout = setTimeout(() => setStatus((s) => (s === "loading" ? "timeout" : s)), 7000);
    return () => clearTimeout(timeout);
  }, []);

  if (!HANDLE) {
    return (
      <TerminalPanel title="icp / x / —" className="h-full" bodyClassName="overflow-hidden p-0">
        <div className="grid h-full place-items-center px-6 text-center">
          <p className="font-mono text-xs text-cream/40">no X account yet — check back soon</p>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel title={`icp / x / @${HANDLE}`} className="h-full" bodyClassName="overflow-hidden p-0">
      <div className="flex items-center gap-1.5 border-b border-cream/10 px-3.5 py-2 text-[10px] uppercase tracking-wider text-cream/40">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-berry" />
        live from x.com/{HANDLE}
      </div>

      <div className="relative h-[calc(100%-33px)]">
        {status !== "loaded" && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-ink px-6 text-center">
            {status === "loading" ? (
              <p className="font-mono text-xs text-cream/40">connecting to @{HANDLE}…</p>
            ) : (
              <div className="space-y-2">
                <p className="font-mono text-xs text-cream/50">
                  feed didn&apos;t load — could be no posts yet, or your browser is blocking the embed.
                </p>
                <a
                  href={PROFILE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block rounded-full border border-hotpot px-3 py-1 font-mono text-xs font-bold text-hotpot hover:bg-hotpot hover:text-ink"
                >
                  view @{HANDLE} on x ↗
                </a>
              </div>
            )}
          </div>
        )}

        <div ref={hostRef} className="h-full overflow-y-auto px-1">
          <a
            className="twitter-timeline"
            data-theme="dark"
            data-chrome="noheader nofooter noborders transparent"
            data-link-color="#CFF23F"
            data-height="2000"
            href={`https://twitter.com/${HANDLE}?ref_src=twsrc%5Etfw`}
          >
            Tweets by @{HANDLE}
          </a>
        </div>
      </div>
    </TerminalPanel>
  );
}
