import fs from 'node:fs';
import path from 'node:path';

export const CHAINS = ['bsc', 'arbitrum', 'base', 'solana'] as const;
export type Chain = (typeof CHAINS)[number];

export const CEX_IDS = ['binance', 'bybit', 'okx', 'gate', 'mexc'] as const;
export type CexId = (typeof CEX_IDS)[number];

/** Токен, доданий вручну (на випадок, коли біржа не віддає адресу контракту). */
export interface ManualToken {
  symbol: string; // напр. "PEPE"
  chain: Chain;
  address: string;
}

export interface Config {
  /** Які CEX сканувати */
  cex: CexId[];
  /** Які мережі DEX сканувати */
  chains: Chain[];
  /** Обсяг угоди в USD, на який рахуємо прибуток */
  tradeSizeUsd: number;
  /** Мінімальний чистий прибуток у %, щоб надіслати сигнал */
  minProfitPct: number;
  /** Вище цього % вважаємо, що це помилка даних (інший токен з тим самим тікером тощо) */
  maxProfitPct: number;
  /** Мінімальна ліквідність пулу на DEX, USD */
  minDexLiquidityUsd: number;
  /** Мінімальний обсяг торгів за 24 год на CEX, USD */
  minCexVolumeUsd: number;
  /** Комісія тейкера на CEX, % */
  cexTakerFeePct: number;
  /** Комісія свопу на DEX, % */
  dexFeePct: number;
  /** Орієнтовна вартість однієї транзакції в мережі, USD */
  gasUsd: Record<Chain, number>;
  /** Пропускати зв'язки, де статус депозиту/виводу невідомий */
  requireTransferCheck: boolean;
  /** Як часто оновлювати ціни, секунд */
  scanIntervalSec: number;
  /** Як часто оновлювати список токенів і статус депозиту/виводу, хвилин */
  universeRefreshMin: number;
  /** Не повторювати сигнал по тій самій зв'язці частіше, ніж раз на N хвилин */
  signalCooldownMin: number;
  manualTokens: ManualToken[];
}

export const DEFAULT_CONFIG: Config = {
  cex: [...CEX_IDS],
  chains: [...CHAINS],
  tradeSizeUsd: 500,
  minProfitPct: 1.5,
  maxProfitPct: 50,
  minDexLiquidityUsd: 50_000,
  minCexVolumeUsd: 100_000,
  cexTakerFeePct: 0.1,
  dexFeePct: 0.3,
  gasUsd: { bsc: 0.15, arbitrum: 0.15, base: 0.1, solana: 0.02 },
  requireTransferCheck: true,
  scanIntervalSec: 30,
  universeRefreshMin: 30,
  signalCooldownMin: 15,
  manualTokens: [],
};

export const DATA_DIR = path.resolve(import.meta.dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/** Накладає часткові зміни на конфіг, відкидаючи невідомі біржі/мережі. */
export function mergeConfig(base: Config, patch: Partial<Config>): Config {
  const next: Config = { ...base, ...patch, gasUsd: { ...base.gasUsd, ...(patch.gasUsd ?? {}) } };
  next.cex = (next.cex ?? []).filter((c): c is CexId => (CEX_IDS as readonly string[]).includes(c));
  next.chains = (next.chains ?? []).filter((c): c is Chain => (CHAINS as readonly string[]).includes(c));
  next.manualTokens = (next.manualTokens ?? []).filter(
    (t) => t && typeof t.symbol === 'string' && typeof t.address === 'string' && (CHAINS as readonly string[]).includes(t.chain),
  );
  return next;
}
