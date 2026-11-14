export type Chain = 'bsc' | 'arbitrum' | 'base' | 'solana';
export type CexId = 'binance' | 'bybit' | 'okx' | 'gate' | 'mexc';

export const CHAINS: Chain[] = ['bsc', 'arbitrum', 'base', 'solana'];
export const CEX_IDS: CexId[] = ['binance', 'bybit', 'okx', 'gate', 'mexc'];
export const CHAIN_NAME: Record<Chain, string> = { bsc: 'BSC', arbitrum: 'Arbitrum', base: 'Base', solana: 'Solana' };
export const CEX_NAME: Record<CexId, string> = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', gate: 'Gate', mexc: 'MEXC' };

export interface Opportunity {
  id: string;
  direction: 'DEX_TO_CEX' | 'CEX_TO_DEX';
  base: string;
  cex: CexId;
  chain: Chain;
  address: string;
  dexId: string;
  dexPrice: number;
  cexPrice: number;
  rawSpreadPct: number;
  tradeSizeUsd: number;
  profitUsd: number;
  profitPct: number;
  dexLiquidityUsd: number;
  cexVolumeUsd: number;
  transferOk?: boolean;
  withdrawFee?: number;
  depthChecked: boolean;
  pairUrl: string;
  updatedAt: number;
}

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

export interface State {
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

export interface ManualToken {
  symbol: string;
  chain: Chain;
  address: string;
}

export interface Config {
  cex: CexId[];
  chains: Chain[];
  tradeSizeUsd: number;
  minProfitPct: number;
  maxProfitPct: number;
  minDexLiquidityUsd: number;
  minCexVolumeUsd: number;
  cexTakerFeePct: number;
  dexFeePct: number;
  gasUsd: Record<Chain, number>;
  requireTransferCheck: boolean;
  scanIntervalSec: number;
  universeRefreshMin: number;
  signalCooldownMin: number;
  manualTokens: ManualToken[];
}
