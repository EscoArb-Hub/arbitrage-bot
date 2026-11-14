import type { Chain } from './config.ts';
import { addrKey, DEXSCREENER_CHAIN_ID } from './chains.ts';

export interface DexQuote {
  chain: Chain;
  address: string;
  symbol: string;
  priceUsd: number;
  liquidityUsd: number;
  dexId: string;
  pairUrl: string;
}

interface DsPair {
  chainId: string;
  dexId: string;
  url: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { address: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

const BATCH = 30; // ліміт DexScreener на кількість адрес у запиті
const API = 'https://api.dexscreener.com/tokens/v1';

/**
 * Ціни токенів на DEX через DexScreener (безкоштовно, без ключа, 300 запитів/хв).
 * Для кожного токена беремо найліквідніший пул, де він є базовим токеном.
 */
export async function fetchDexQuotes(chain: Chain, addresses: string[]): Promise<Map<string, DexQuote>> {
  const unique = [...new Set(addresses.map((a) => addrKey(chain, a)))];
  const out = new Map<string, DexQuote>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await fetch(`${API}/${DEXSCREENER_CHAIN_ID[chain]}/${batch.join(',')}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`DexScreener ${chain}: HTTP ${res.status}`);
    const pairs = (await res.json()) as DsPair[];
    for (const p of pairs) {
      const key = addrKey(chain, p.baseToken?.address ?? '');
      if (!batch.includes(key)) continue;
      const price = Number(p.priceUsd);
      const liq = p.liquidity?.usd ?? 0;
      if (!(price > 0) || !(liq > 0)) continue;
      const prev = out.get(key);
      if (prev && prev.liquidityUsd >= liq) continue;
      out.set(key, {
        chain,
        address: p.baseToken.address,
        symbol: p.baseToken.symbol,
        priceUsd: price,
        liquidityUsd: liq,
        dexId: p.dexId,
        pairUrl: p.url,
      });
    }
  }
  return out;
}
