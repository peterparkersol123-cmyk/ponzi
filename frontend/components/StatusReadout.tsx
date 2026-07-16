export function StatusReadout({
  label,
  time,
  banner,
}: {
  label: string;
  time: string;
  banner: { text: string; tone: "idle" | "urgent" };
}) {
  return (
    <div className="space-y-2">
      <div className="inline-block rounded-lg border-2 border-cream/15 bg-ink/70 px-4 py-2 font-mono backdrop-blur-sm">
        <div className="text-[10px] font-bold uppercase tracking-widest text-hotpot">${label}</div>
        <div className="text-2xl font-extrabold tabular-nums text-cream">{time}</div>
      </div>
      <div
        className={`inline-flex items-center gap-2 rounded-lg border-2 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wide backdrop-blur-sm ${
          banner.tone === "urgent" ? "border-tangerine text-tangerine" : "border-cream/20 text-cream/60"
        }`}
      >
        <span className={`h-2 w-2 rounded-full ${banner.tone === "urgent" ? "animate-pulse bg-tangerine" : "bg-cream/40"}`} />
        {banner.text}
      </div>
    </div>
  );
}
