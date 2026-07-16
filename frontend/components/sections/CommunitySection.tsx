"use client";

import { TerminalPanel } from "@/components/TerminalPanel";
import { explorerUrl, TOKEN_ADDRESS } from "@/lib/config";
import { XFeed } from "@/components/XFeed";

export function CommunitySection() {
  return (
    <div className="space-y-5">
      <div className="h-[480px]">
        <XFeed />
      </div>
      <TerminalPanel title="icp / community / links">
        <div className="flex flex-wrap gap-3">
          <a
            href="https://x.com/ICPxRh"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border-2 border-cream/20 px-4 py-2 font-mono text-xs font-bold text-cream/70 transition-colors hover:border-hotpot hover:text-hotpot"
          >
            @ICPxRh on X ↗
          </a>
          <a
            href="https://www.infinitecashpoint.xyz/"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border-2 border-cream/20 px-4 py-2 font-mono text-xs font-bold text-cream/70 transition-colors hover:border-hotpot hover:text-hotpot"
          >
            infinitecashpoint.xyz ↗
          </a>
          {explorerUrl && (
            <a
              href={`${explorerUrl}/address/${TOKEN_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border-2 border-cream/20 px-4 py-2 font-mono text-xs font-bold text-cream/70 transition-colors hover:border-hotpot hover:text-hotpot"
            >
              contract on explorer ↗
            </a>
          )}
        </div>
      </TerminalPanel>
    </div>
  );
}
