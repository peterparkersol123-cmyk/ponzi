"use client";

import { HowItWorks } from "@/components/HowItWorks";
import { MinBuyExample } from "@/components/MinBuyExample";

export function SystemSection() {
  return (
    <div className="space-y-5">
      <p className="font-mono text-[11px] font-semibold text-cream/50">
        every claim below maps directly to a line in the FlapJackpot contract — nothing here is trust-me,
        it&apos;s all verifiable on-chain.
      </p>
      <HowItWorks />
      <MinBuyExample />
    </div>
  );
}
