/// HOTPOT mark — an angular cracked cauldron with a flame rising from the split.
/// Faceted, straight-edged shapes to match the brand's sharp look. Uses
/// currentColor so it inherits the ink color. Swap this file for the real asset
/// (drop an SVG/PNG in /public and render it) if you have the exact vector.
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 108"
      role="img"
      aria-label="HOTPOT"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* flame — main tongue */}
      <path d="M49 6 L59 23 L52.5 28 L61 44 L47 44 L45 31 L51.5 25.5 L43 16 Z" />
      {/* flame — right leaf */}
      <path d="M63 26 L72.5 39 L67 45 L59 45 L60 34 Z" />
      {/* brim: bar + flared jagged ends */}
      <path d="M24 47 L76 47 L76 56 L24 56 Z" />
      <path d="M24 49 L13 58 L24 57 Z" />
      <path d="M76 49 L87 58 L76 57 Z" />
      {/* body — left half (right edge is the lightning crack) */}
      <path d="M26 56 L23.5 69 L30 83 L41 90 L46 90 L45 76 L49.5 66 L46 56 Z" />
      {/* body — right half (left edge mirrors the crack) */}
      <path d="M74 56 L76.5 69 L70 83 L59 90 L54 90 L55 76 L50.5 66 L54 56 Z" />
      {/* feet */}
      <path d="M38 90 L45 90 L43 96 L40 96 Z" />
      <path d="M55 90 L62 90 L60 96 L57 96 Z" />
    </svg>
  );
}
