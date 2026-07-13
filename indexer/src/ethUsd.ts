const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

/** Starts polling CoinGecko for the ETH/USD rate and returns a getter for
 *  the latest known value (null until the first successful fetch). A failed
 *  fetch just keeps the last known-good price instead of breaking callers —
 *  used by both the indexer (display) and the keeper (qualifying-buy check),
 *  so a transient CoinGecko hiccup should degrade gracefully, not crash. */
export function startEthUsdPoller(intervalMs = 60_000): () => number | null {
  let price: number | null = null;

  async function refresh() {
    try {
      const res = await fetch(COINGECKO_URL);
      const json = (await res.json()) as { ethereum?: { usd?: number } };
      if (typeof json.ethereum?.usd === "number") price = json.ethereum.usd;
    } catch (err) {
      console.error("eth/usd price fetch failed:", err);
    }
  }

  void refresh();
  setInterval(refresh, intervalMs);
  return () => price;
}
