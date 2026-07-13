import { FlatPanel } from "./FlatPanel";

const STEPS = [
  "every buy resets the countdown to 60s",
  "every trade pays a 3% fee",
  "fee split: 75% prize pool · 25% operations",
  "when timer hits 0:00 the last buyer wins",
  "new scheme starts immediately",
];

export function HowItWorks() {
  return (
    <FlatPanel title="How It Works">
      <ol className="space-y-3 font-mono text-sm font-semibold leading-relaxed text-cream">
        {STEPS.map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 font-extrabold text-hotpot">{i + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </FlatPanel>
  );
}
