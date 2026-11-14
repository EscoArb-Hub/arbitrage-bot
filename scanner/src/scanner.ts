import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, type CexId, type Config } from './config.ts';
import { fetchBook, fetchQuotes, hasCredentials, loadListings, type Listing } from './cex.ts';
import { fetchDexQuotes, type DexQuote } from './dex.ts';
import { addrKey } from './chains.ts';
import { evaluate, type Opportunity } from './engine.ts';
import { formatSignal, sendTelegram, telegramConfigured } from './telegram.ts';

export interface Signal {
  at: number;
  opportunity: Opportunity;
  sent: boolean;
  error?: string;
}

export interface SourceStatus {
  ok: boolean;
  error?: string;
  at?: number;
  listings?: number;
  hasKeys?: boolean;
}

export interface ScannerState {
  opportunities: Opportunity[];
  signals: Signal[];
  status: {
    lastScanAt?: number;
    lastUniverseAt?: number;
    scanMs?: number;
    telegram: boolean;
    sources: Record<string, SourceStatus>;
  };
}

const SIGNALS_FILE = path.join(DATA_DIR, 'signals.json');
const MAX_SIGNALS = 500;
/** Скільки кандидатів максимум перевіряємо по стакану за один прохід (щоб не впертися в ліміти бірж). */
const MAX_BOOK_CHECKS = 25;

export class Scanner {
  state: ScannerState = { opportunities: [], signals: [], status: { telegram: telegramConfigured(), sources: {} } };
  private listings = new Map<CexId, Listing[]>();
  private lastSent = new Map<string, { at: number; profitPct: number }>();
  private running = false;

  constructor(public cfg: Config) {
    try {
      this.state.signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8'));
    } catch {
      /* ще немає історії */
    }
  }

  async refreshUniverse(): Promise<void> {
    await Promise.all(
      this.cfg.cex.map(async (id) => {
        try {
          const list = await loadListings(id, this.cfg);
          this.listings.set(id, list);
          this.state.status.sources[id] = { ok: true, at: Date.now(), listings: list.length, hasKeys: hasCredentials(id) };
        } catch (e) {
          this.state.status.sources[id] = { ok: false, at: Date.now(), error: String((e as Error).message ?? e), hasKeys: hasCredentials(id) };
        }
      }),
    );
    for (const id of [...this.listings.keys()]) if (!this.cfg.cex.includes(id)) this.listings.delete(id);
    this.state.status.lastUniverseAt = Date.now();
  }

  async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const t0 = Date.now();
    try {
      const cfg = this.cfg;
      const all = [...this.listings.values()].flat().filter((l) => cfg.chains.includes(l.chain));

      // Ціни на DEX: один набір запитів на мережу
      const dex = new Map<string, DexQuote>();
      await Promise.all(
        cfg.chains.map(async (chain) => {
          const addrs = all.filter((l) => l.chain === chain).map((l) => l.address);
          if (addrs.length === 0) return;
          const key = `dex:${chain}`;
          try {
            const q = await fetchDexQuotes(chain, addrs);
            for (const [a, v] of q) dex.set(`${chain}:${a}`, v);
            this.state.status.sources[key] = { ok: true, at: Date.now(), listings: q.size };
          } catch (e) {
            this.state.status.sources[key] = { ok: false, at: Date.now(), error: String((e as Error).message ?? e) };
          }
        }),
      );

      // Ціни на CEX і попередній розрахунок за найкращою ціною
      const prelim: { listing: Listing; opp: Opportunity; cexQuote: Parameters<typeof evaluate>[0]['cex']; dexQuote: DexQuote }[] = [];
      await Promise.all(
        cfg.cex.map(async (id) => {
          const list = (this.listings.get(id) ?? []).filter((l) => dex.has(`${l.chain}:${addrKey(l.chain, l.address)}`));
          if (list.length === 0) return;
          let quotes;
          try {
            quotes = await fetchQuotes(id, list.map((l) => l.symbol));
          } catch (e) {
            const s = this.state.status.sources[id] ?? { ok: false };
            this.state.status.sources[id] = { ...s, ok: false, error: `tickers: ${(e as Error).message ?? e}` };
            return;
          }
          for (const listing of list) {
            const cexQuote = quotes.get(listing.symbol);
            const dexQuote = dex.get(`${listing.chain}:${addrKey(listing.chain, listing.address)}`)!;
            if (!cexQuote || cexQuote.quoteVolume < cfg.minCexVolumeUsd || dexQuote.liquidityUsd < cfg.minDexLiquidityUsd) continue;
            for (const opp of evaluate({ listing, cex: cexQuote, dex: dexQuote, cfg })) {
              if (opp.profitPct >= cfg.minProfitPct && opp.profitPct <= cfg.maxProfitPct) {
                prelim.push({ listing, opp, cexQuote, dexQuote });
              }
            }
          }
        }),
      );

      // Уточнюємо найкращих кандидатів по стакану CEX
      prelim.sort((a, b) => b.opp.profitPct - a.opp.profitPct);
      const results: Opportunity[] = [];
      for (const c of prelim.slice(0, MAX_BOOK_CHECKS)) {
        try {
          const book = await fetchBook(c.listing.cex, c.listing.symbol);
          const exact = evaluate({ listing: c.listing, cex: c.cexQuote, dex: c.dexQuote, book, cfg }).find(
            (o) => o.direction === c.opp.direction,
          );
          if (exact && exact.profitPct >= cfg.minProfitPct && exact.profitPct <= cfg.maxProfitPct) results.push(exact);
        } catch {
          results.push(c.opp); // стакан недоступний — лишаємо оцінку за найкращою ціною
        }
      }
      results.sort((a, b) => b.profitPct - a.profitPct);
      this.state.opportunities = results;
      await this.emitSignals(results);
    } finally {
      this.state.status.lastScanAt = Date.now();
      this.state.status.scanMs = Date.now() - t0;
      this.running = false;
    }
  }

  private async emitSignals(opps: Opportunity[]): Promise<void> {
    const now = Date.now();
    const cooldown = this.cfg.signalCooldownMin * 60_000;
    let changed = false;
    for (const o of opps) {
      const prev = this.lastSent.get(o.id);
      if (prev && now - prev.at < cooldown && o.profitPct < prev.profitPct * 1.5) continue;
      const signal: Signal = { at: now, opportunity: o, sent: false };
      if (telegramConfigured()) {
        try {
          await sendTelegram(formatSignal(o));
          signal.sent = true;
        } catch (e) {
          signal.error = String((e as Error).message ?? e);
        }
      }
      this.lastSent.set(o.id, { at: now, profitPct: o.profitPct });
      this.state.signals.unshift(signal);
      changed = true;
    }
    if (changed) {
      this.state.signals = this.state.signals.slice(0, MAX_SIGNALS);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SIGNALS_FILE, JSON.stringify(this.state.signals));
    }
  }
}
