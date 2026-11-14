import type { Chain } from './config.ts';

/** Різні біржі називають ту саму мережу по-різному. */
const ALIASES: Record<Chain, string[]> = {
  bsc: ['BSC', 'BEP20', 'BEP20BSC', 'BSCBEP20', 'BNBSMARTCHAIN', 'BNBSMARTCHAINBEP20', 'BSCMAINNET'],
  arbitrum: ['ARB', 'ARBITRUM', 'ARBONE', 'ARBITRUMONE', 'ARBEVM', 'ARBI', 'ARBITRUMONEARB'],
  base: ['BASE', 'BASEEVM', 'BASEMAINNET', 'BASECHAIN'],
  solana: ['SOL', 'SOLANA', 'SPL', 'SOLSPL'],
};

const LOOKUP = new Map<string, Chain>();
for (const [chain, names] of Object.entries(ALIASES) as [Chain, string[]][]) {
  for (const n of names) LOOKUP.set(n, chain);
}

export function normalizeChain(...names: unknown[]): Chain | undefined {
  for (const n of names) {
    if (typeof n !== 'string') continue;
    const key = n.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hit = LOOKUP.get(key);
    if (hit) return hit;
  }
  return undefined;
}

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidAddress(chain: Chain, addr: string): boolean {
  return chain === 'solana' ? SOL_ADDR.test(addr) : EVM_ADDR.test(addr);
}

/** Адреси EVM порівнюємо без урахування регістру, Solana чутлива до регістру. */
export function addrKey(chain: Chain, addr: string): string {
  return chain === 'solana' ? addr : addr.toLowerCase();
}

/**
 * Шукає адресу контракту в сирій відповіді біржі.
 * Біржі кладуть її під різними ключами: contractAddress (Binance), ctAddr (OKX),
 * contract (MEXC), addr (Gate) тощо.
 */
export function findContractAddress(chain: Chain, info: unknown, depth = 0): string | undefined {
  if (!info || typeof info !== 'object' || depth > 3) return undefined;
  for (const [k, v] of Object.entries(info as Record<string, unknown>)) {
    if (typeof v === 'string' && /contract|ctaddr|tokenaddress|^addr$/i.test(k)) {
      const s = v.trim();
      if (isValidAddress(chain, s)) return s;
    }
  }
  for (const v of Object.values(info as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const hit = findContractAddress(chain, v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

export const DEXSCREENER_CHAIN_ID: Record<Chain, string> = {
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  base: 'base',
  solana: 'solana',
};

export const EXPLORER: Record<Chain, string> = {
  bsc: 'https://bscscan.com/token/',
  arbitrum: 'https://arbiscan.io/token/',
  base: 'https://basescan.org/token/',
  solana: 'https://solscan.io/token/',
};
