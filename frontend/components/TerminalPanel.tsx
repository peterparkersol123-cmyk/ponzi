/** Terminal-window chrome for data-heavy panels (trades, cooks, payouts) —
 *  same hotpot palette as the rest of the page, but reads as a readout
 *  instead of another sticker card. */
export function TerminalPanel({
  title,
  children,
  bodyClassName = "p-3.5",
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-2xl border-[2.5px] border-ink bg-ink/60 text-cream shadow-[5px_5px_0_0_var(--ink),0_0_32px_-10px_rgba(207,242,63,0.45)] backdrop-blur-sm ${className}`}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b-[2.5px] border-ink bg-hotpot/80 px-3 py-2 backdrop-blur-sm">
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/35" />
        <span className="ml-1.5 truncate font-mono text-[11px] font-semibold tracking-tight text-ink/65">
          {title}
        </span>
      </div>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
