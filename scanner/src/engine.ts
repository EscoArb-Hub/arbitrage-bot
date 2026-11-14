import type { CexId, Chain, Config } from './config.ts';
import type { CexQuote, Listing, OrderBookSide } from './cex.ts';
import type { DexQuote } from './dex.ts';

export type Direction = 'DEX_TO_CEX' | 'CEX_TO_DEX';

export interface Opportunity {
  id: string;
  direction: Direction;
  base: string;
  cex: CexId;
  chain: Chain;
  address: string;
  dexId: string;
  dexPrice: number;
  /** bid для DEX→CEX (продаємо на CEX), ask для CEX→DEX (купуємо на CEX) */
  cexPrice: number;
  rawSpreadPct: number;
  tradeSizeUsd: number;
  profitUsd: number;
  profitPct: number;
  dexLiquidityUsd: number;
  cexVolumeUsd: number;
  /** true = депозит/вивід відкритий, undefined = невідомо */
  transferOk?: boolean;
  withdrawFee?: number;
  /** true, якщо розраховано по стакану, false — лише по найкращій ціні */
  depthChecked: boolean;
  pairUrl: string;
  source: Listing['source'];
  updatedAt: number;
}

/** Купівля на CEX за usd: скільки токенів отримаємо, проходячи по стакану. undefined = не вистачає глибини. */
export function bookBuyTokens(asks: OrderBookSide, usd: number): number | undefined {
  let left = usd;
  let tokens = 0;
  for (const [price, amount] of asks.levels) {
    const cost = price * amount;
    if (cost >= left) return tokens + left / price;
    tokens += amount;
    left -= cost;
  }
  return undefined;
}

/** Продаж tokens на CEX: скільки USD отримаємо. undefined = не вистачає глибини. */
export function bookSellUsd(bids: OrderBookSide, tokens: number): number | undefined {
  let left = tokens;
  let usd = 0;
  for (const [price, amount] of bids.levels) {
    if (amount >= left) return usd + left * price;
    usd += amount * price;
    left -= amount;
  }
  return undefined;
}

/**
 * Модель пулу x*y=k: половина ліквідності в USD-стороні.
 * Для пулів з концентрованою ліквідністю (Uniswap v3 тощо) це консервативна оцінка.
 */
export function ammBuyTokens(usd: number, priceUsd: number, liquidityUsd: number, feePct: number): number {
  const dx = usd * (1 - feePct / 100);
  const x = liquidityUsd / 2;
  return dx / priceUsd / (1 + dx / x);
}

export function ammSellUsd(tokens: number, priceUsd: number, liquidityUsd: number, feePct: number): number {
  const v = tokens * (1 - feePct / 100) * priceUsd;
  const x = liquidityUsd / 2;
  return v / (1 + v / x);
}

function topOfBook(price: number): OrderBookSide {
  return { levels: [[price, Number.POSITIVE_INFINITY]] };
}

export interface EvalInput {
  listing: Listing;
  cex: CexQuote;
  dex: DexQuote;
  book?: { bids: OrderBookSide; asks: OrderBookSide };
  cfg: Config;
  now?: number;
}

/** Рахує обидва напрямки і повертає ті, що мають сенс (з урахуванням статусу депозиту/виводу). */
export function evaluate({ listing, cex, dex, book, cfg, now = Date.now() }: EvalInput): Opportunity[] {
  const S = cfg.tradeSizeUsd;
  const gas = cfg.gasUsd[listing.chain] ?? 0;
  const fee = cfg.cexTakerFeePct / 100;
  const bids = book?.bids ?? topOfBook(cex.bid);
  const asks = book?.asks ?? topOfBook(cex.ask);
  const out: Opportunity[] = [];

  const common = {
    base: listing.base,
    cex: listing.cex,
    chain: listing.chain,
    address: listing.address,
    dexId: dex.dexId,
    dexPrice: dex.priceUsd,
    tradeSizeUsd: S,
    dexLiquidityUsd: dex.liquidityUsd,
    cexVolumeUsd: cex.quoteVolume,
    depthChecked: Boolean(book),
    pairUrl: dex.pairUrl,
    source: listing.source,
    updatedAt: now,
  };

  // 1) Купуємо на DEX → депозит на CEX → продаємо на CEX
  if (!(cfg.requireTransferCheck && listing.deposit !== true) && listing.deposit !== false) {
    const tokens = ammBuyTokens(S, dex.priceUsd, dex.liquidityUsd, cfg.dexFeePct);
    const usd = bookSellUsd(bids, tokens);
    if (usd !== undefined) {
      const profitUsd = usd * (1 - fee) - S - 2 * gas; // своп + переказ на біржу
      out.push({
        ...common,
        id: `${listing.base}:${listing.chain}:${listing.cex}:DEX_TO_CEX`,
        direction: 'DEX_TO_CEX',
        cexPrice: cex.bid,
        rawSpreadPct: (cex.bid / dex.priceUsd - 1) * 100,
        profitUsd,
        profitPct: (profitUsd / S) * 100,
        transferOk: listing.deposit,
      });
    }
  }

  // 2) Купуємо на CEX → вивід у мережу → продаємо на DEX
  if (!(cfg.requireTransferCheck && listing.withdraw !== true) && listing.withdraw !== false) {
    const bought = bookBuyTokens(asks, S);
    if (bought !== undefined) {
      const tokens = bought * (1 - fee) - (listing.withdrawFee ?? 0);
      if (tokens > 0) {
        const profitUsd = ammSellUsd(tokens, dex.priceUsd, dex.liquidityUsd, cfg.dexFeePct) - S - gas;
        out.push({
          ...common,
          id: `${listing.base}:${listing.chain}:${listing.cex}:CEX_TO_DEX`,
          direction: 'CEX_TO_DEX',
          cexPrice: cex.ask,
          rawSpreadPct: (dex.priceUsd / cex.ask - 1) * 100,
          profitUsd,
          profitPct: (profitUsd / S) * 100,
          transferOk: listing.withdraw,
          withdrawFee: listing.withdrawFee,
        });
      }
    }
  }
  return out;
}
