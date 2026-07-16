/// Infinite Cash Point ($ICP) mark — the infinity/"ICP" lockup, lime on
/// black. A raster asset (public/logo.jpg), not a vector — callers should
/// size the wrapper and let this fill it (object-cover), clipping with
/// rounded corners on the wrapper rather than here.
export function Logo({ className = "" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.jpg" alt="Infinite Cash Point" className={`object-cover ${className}`} />;
}
