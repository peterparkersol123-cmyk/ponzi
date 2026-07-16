"use client";

export function SoundToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={enabled ? "mute sound" : "unmute sound"}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-cream/15 text-[13px] text-cream/60 transition-colors hover:border-cream/30 hover:text-cream"
    >
      {enabled ? "🔊" : "🔇"}
    </button>
  );
}
