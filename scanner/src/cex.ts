import ccxt, { type Exchange } from 'ccxt';
import type { CexId, Chain, Config } from './config.ts';
import { findContractAddress, isValidAddress, normalizeChain } from './chains.ts';

/** Один токен на одній CEX у конкретній мережі. */
export interface Listing {
  cex: CexId;
  /** Символ ринку в ccxt, напр. "PEPE/USDT" */
  symbol: string;
  base: string;
  chain: Chain;
  address: string;
  /** undefined = біржа не повідомила статус */
  deposit?: boolean;
  withdraw?: boolean;
  /** Комісія виводу в токенах */
  withdrawFee?: number;
  source: 'exchange' | 'manual';
}

export interface CexQuote {
  bid: number;
  ask: number;
  quoteVolume: number;
}

export interface OrderBookSide {
  /** [ціна, кількість] */
  levels: [number, number][];
}

const QUOTES = ['USDT'];
const SKIP_BASES = new Set(['USDT', 'USDC', 'FDUSD', 'DAI', 'TUSD', 'BUSD', 'USDE', 'PYUSD']);

const exchanges = new Map<CexId, Exchange>();

function credentials(id: CexId): Record<string, string> {
  const up = id.toUpperCase();
  const creds: Record<string, string> = {};
  const key = process.env[`${up}_API_KEY`];
  const secret = process.env[`${up}_SECRET`];
  const password = process.env[`${up}_PASSWORD`];
  if (key) creds.apiKey = key;
  if (secret) creds.secret = secret;
  if (password) creds.password = password;
  return creds;
}

export function getExchange(id: CexId): Exchange {
  let ex = exchanges.get(id);
  if (!ex) {
    const Ctor = (ccxt as unknown as Record<string, new (opts: object) => Exchange>)[id];
    ex = new Ctor({ enableRateLimit: true, options: { defaultType: 'spot' }, ...credentials(id) });
    exchanges.set(id, ex);
  }
  return ex;
}

export function hasCredentials(id: CexId): boolean {
  return Boolean(credentials(id).apiKey);
}

/** Завантажує ринки й мережі депозиту/виводу та будує список токенів для порівняння з DEX. */
export async function loadListings(id: CexId, cfg: Config): Promise<Listing[]> {
  const ex = getExchange(id);
  await ex.loadMarkets(true);
  const currencies = ex.currencies ?? {};
  const out: Listing[] = [];
  const manualBySymbol = new Map<string, typeof cfg.manualTokens>();
  for (const t of cfg.manualTokens) {
    const s = t.symbol.toUpperCase();
    manualBySymbol.set(s, [...(manualBySymbol.get(s) ?? []), t]);
  }

  for (const m of Object.values(ex.markets ?? {})) {
    if (!m || !m.spot || m.active === false || !QUOTES.includes(m.quote) || SKIP_BASES.has(m.base)) continue;
    const currency = currencies[m.base];
    const seen = new Set<string>();

    for (const [netKey, net] of Object.entries(currency?.networks ?? {})) {
      if (!net) continue;
      const info = (net.info ?? {}) as Record<string, unknown>;
      const chain = normalizeChain(netKey, net.network, net.id, info.network, info.chain, info.chainName, info.chain_name, info.name);
      if (!chain || !cfg.chains.includes(chain) || seen.has(chain)) continue;
      const address = findContractAddress(chain, info);
      if (!address) continue;
      seen.add(chain);
      out.push({
        cex: id,
        symbol: m.symbol,
        base: m.base,
        chain,
        address,
        deposit: typeof net.deposit === 'boolean' ? net.deposit : undefined,
        withdraw: typeof net.withdraw === 'boolean' ? net.withdraw : undefined,
        withdrawFee: typeof net.fee === 'number' ? net.fee : undefined,
        source: 'exchange',
      });
    }

    for (const t of manualBySymbol.get(m.base.toUpperCase()) ?? []) {
      if (seen.has(t.chain) || !cfg.chains.includes(t.chain) || !isValidAddress(t.chain, t.address)) continue;
      seen.add(t.chain);
      const net = Object.entries(currency?.networks ?? {}).find(([k, n]) =>
        normalizeChain(k, n?.network, n?.id) === t.chain,
      )?.[1];
      out.push({
        cex: id,
        symbol: m.symbol,
        base: m.base,
        chain: t.chain,
        address: t.address,
        deposit: typeof net?.deposit === 'boolean' ? net.deposit : undefined,
        withdraw: typeof net?.withdraw === 'boolean' ? net.withdraw : undefined,
        withdrawFee: typeof net?.fee === 'number' ? net.fee : undefined,
        source: 'manual',
      });
    }
  }
  return out;
}

export async function fetchQuotes(id: CexId, symbols: string[]): Promise<Map<string, CexQuote>> {
  const ex = getExchange(id);
  const tickers = await ex.fetchTickers();
  const want = new Set(symbols);
  const out = new Map<string, CexQuote>();
  for (const [sym, t] of Object.entries(tickers)) {
    if (!want.has(sym) || !t.bid || !t.ask) continue;
    const quoteVolume = t.quoteVolume ?? (t.baseVolume && t.last ? t.baseVolume * t.last : 0);
    out.set(sym, { bid: t.bid, ask: t.ask, quoteVolume });
  }
  return out;
}

export async function fetchBook(id: CexId, symbol: string): Promise<{ bids: OrderBookSide; asks: OrderBookSide }> {
  const ob = await getExchange(id).fetchOrderBook(symbol, 50);
  const conv = (rows: unknown[][]): [number, number][] =>
    rows.map((r) => [Number(r[0]), Number(r[1])] as [number, number]).filter(([p, a]) => p > 0 && a > 0);
  return { bids: { levels: conv(ob.bids) }, asks: { levels: conv(ob.asks) } };
}

export function tradeUrl(id: CexId, base: string): string {
  switch (id) {
    case 'binance': return `https://www.binance.com/en/trade/${base}_USDT?type=spot`;
    case 'bybit': return `https://www.bybit.com/en/trade/spot/${base}/USDT`;
    case 'okx': return `https://www.okx.com/trade-spot/${base.toLowerCase()}-usdt`;
    case 'gate': return `https://www.gate.io/trade/${base}_USDT`;
    case 'mexc': return `https://www.mexc.com/exchange/${base}_USDT`;
  }
}
