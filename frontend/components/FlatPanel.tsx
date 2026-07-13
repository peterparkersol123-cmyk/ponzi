/** Plain black box, bold white label, no border/shadow/rounding — the flat
 *  minimal look. Used for every boxed panel on the page. */
export function FlatPanel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col bg-ink p-4 text-cream ${className}`}>
      <div className="mb-2 shrink-0 font-display text-base font-extrabold">{title}</div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
