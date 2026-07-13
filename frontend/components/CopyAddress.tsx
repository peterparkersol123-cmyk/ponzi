"use client";

import { useState } from "react";
import { shortAddr } from "@/lib/format";

/** "CA: 0x1234…5678 [copy]" — click to copy the full address, brief checkmark
 *  confirms it landed on the clipboard. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  function flash() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      flash();
      return;
    } catch {
      // Clipboard API blocked/unavailable — fall back to the old textarea trick.
    }
    try {
      const el = document.createElement("textarea");
      el.value = address;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(el);
      if (ok) flash();
      else console.warn("copy: both clipboard paths were blocked");
    } catch {
      // both paths failed — nothing more we can do without a permissions prompt
    }
  }

  return (
    <button
      onClick={copy}
      title={copied ? "copied!" : address}
      className="inline-flex items-center gap-1.5 rounded-full border border-cream/15 bg-cream/5 px-2.5 py-1 font-mono text-xs font-semibold text-cream/60 transition-colors hover:border-hotpot hover:text-hotpot"
    >
      <span className="text-cream/35">CA</span>
      <span>{shortAddr(address)}</span>
      <span aria-hidden className="text-[13px] leading-none">
        {copied ? "✓" : "⧉"}
      </span>
    </button>
  );
}
