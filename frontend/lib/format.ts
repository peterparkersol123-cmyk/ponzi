import { formatEther } from "viem";

/** Format a plain ETH number (not wei) with sensible precision for its
 *  magnitude. Split out from fmtEth so animated/interpolated values (which
 *  are already floats, not wei strings) can share the same formatting rules
 *  without a lossy round-trip through BigInt. */
export function fmtEthFromNumber(eth: number, maxDigits = 4): string {
  if (eth === 0) return "0";
  if (Math.abs(eth) < 0.0001) return eth.toExponential(2);
  return eth.toLocaleString("en-US", { maximumFractionDigits: maxDigits });
}

/** Format a wei string as ETH with sensible precision for its magnitude. */
export function fmtEth(wei: string | bigint, maxDigits = 4): string {
  return fmtEthFromNumber(Number(formatEther(BigInt(wei))), maxDigits);
}

/** Format a wei string as ETH with K/M abbreviation for large values — for
 *  compact display of market cap / volume rather than a long decimal string. */
export function fmtEthCompact(wei: string | bigint): string {
  const eth = Number(formatEther(BigInt(wei)));
  if (eth === 0) return "0";
  if (eth >= 1_000_000) return `${(eth / 1_000_000).toFixed(2)}M`;
  if (eth >= 1_000) return `${(eth / 1_000).toFixed(2)}K`;
  if (eth < 0.0001) return eth.toExponential(2);
  return eth.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Format a plain USD number (not wei) with $ + K/M abbreviation — the
 *  number-input counterpart to fmtUsdCompact, for animated/interpolated
 *  values that are already floats. */
export function fmtUsdFromNumber(usd: number): string {
  if (usd === 0) return "$0";
  if (Math.abs(usd) >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (Math.abs(usd) >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** Format a wei string as USD with $ + K/M abbreviation, given a live
 *  ETH/USD price. This is what "market cap" / "volume" should read as —
 *  the ETH-denominated fallback is only for when the price feed is down. */
export function fmtUsdCompact(wei: string | bigint, ethUsd: number): string {
  return fmtUsdFromNumber(Number(formatEther(BigInt(wei))) * ethUsd);
}

/** Format a wei string as a USD unit price, given a live ETH/USD rate. Unlike
 *  fmtUsdCompact (built for totals like market cap), this keeps enough
 *  decimal places for sub-cent per-token prices instead of rounding them to
 *  "$0.0000" — these bonding-curve tokens routinely price in the
 *  $0.000001-ish range early on. */
export function fmtUsdPrice(wei: string | bigint, ethUsd: number): string {
  const usd = Number(formatEther(BigInt(wei))) * ethUsd;
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (usd >= 0.01) return `$${usd.toFixed(4)}`;
  // Sub-cent: keep ~3 significant figures in fixed notation (not scientific)
  // so it still reads at a glance in a compact stat card.
  const leadingZeros = Math.max(0, -Math.floor(Math.log10(usd)) - 1);
  const decimals = Math.min(leadingZeros + 3, 12);
  return `$${usd.toFixed(decimals)}`;
}

/** Format a token-wei string as a whole-ish token amount. */
export function fmtTokens(wei: string | bigint): string {
  const n = Number(formatEther(BigInt(wei)));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** "3s" / "2m" / "4h" age from a unix-seconds timestamp. */
export function fmtAge(tsSec: number, nowSec: number): string {
  const d = Math.max(0, nowSec - tsSec);
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

/** "0:47" countdown from seconds. */
export function fmtCountdown(s: number): string {
  const clamped = Math.max(0, s);
  const m = Math.floor(clamped / 60);
  const sec = Math.floor(clamped % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
