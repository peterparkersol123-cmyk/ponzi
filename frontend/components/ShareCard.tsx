"use client";

import { fmtEth, shortAddr } from "@/lib/format";

/** Renders a downloadable PNG summarizing a win, entirely client-side —
 *  no network calls, no auto-posting anywhere. The winner decides whether
 *  and where to share it. */
export function ShareCard({
  kind,
  winner,
  amount,
  roundId,
}: {
  kind: "payout" | "lotteryPayout";
  winner: string;
  amount: string;
  roundId: number;
}) {
  function download() {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#cff23f";
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    ctx.textAlign = "center";

    ctx.fillStyle = "#cff23f";
    ctx.font = "bold 48px monospace";
    ctx.fillText(kind === "lotteryPayout" ? "LOTTERY WINNER" : "HOTPOT WON", canvas.width / 2, 170);

    ctx.fillStyle = "#fffdf3";
    ctx.font = "bold 96px monospace";
    ctx.fillText(`+${fmtEth(amount)} ETH`, canvas.width / 2, 320);

    ctx.font = "36px monospace";
    ctx.fillStyle = "rgba(255,253,243,0.7)";
    ctx.fillText(shortAddr(winner), canvas.width / 2, 400);
    ctx.fillText(`${kind === "lotteryPayout" ? "draw" : "round"} #${roundId}`, canvas.width / 2, 448);

    ctx.font = "bold 34px monospace";
    ctx.fillStyle = "#cff23f";
    ctx.fillText("$HOTPOT", canvas.width / 2, 560);

    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `hotpot-win-${kind === "lotteryPayout" ? "lottery" : "pot"}-${roundId}.png`;
    a.click();
  }

  return (
    <button
      type="button"
      onClick={download}
      className="mt-4 w-full rounded-full border-2 border-hotpot bg-hotpot px-4 py-2 font-display text-xs font-extrabold uppercase tracking-widest text-ink transition-transform hover:scale-[1.02]"
    >
      download share card
    </button>
  );
}
