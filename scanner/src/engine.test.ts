import test from 'node:test';
import assert from 'node:assert/strict';
import { ammBuyTokens, ammSellUsd, bookBuyTokens, bookSellUsd, evaluate } from './engine.ts';
import { DEFAULT_CONFIG } from './config.ts';
import type { Listing } from './cex.ts';
import { findContractAddress, normalizeChain } from './chains.ts';

const listing: Listing = {
  cex: 'gate', symbol: 'TKN/USDT', base: 'TKN', chain: 'bsc',
  address: '0x' + '1'.repeat(40), deposit: true, withdraw: true, withdrawFee: 1, source: 'exchange',
};
const dex = { chain: 'bsc' as const, address: listing.address, symbol: 'TKN', priceUsd: 1, liquidityUsd: 1_000_000, dexId: 'pancakeswap', pairUrl: 'https://x' };

test('стакан: купівля і продаж', () => {
  const asks = { levels: [[1, 100], [2, 100]] as [number, number][] };
  assert.equal(bookBuyTokens(asks, 50), 50);
  assert.equal(bookBuyTokens(asks, 200), 150);
  assert.equal(bookBuyTokens(asks, 1000), undefined);
  assert.equal(bookSellUsd(asks, 150), 200);
});

test('AMM: прослизання зростає з обсягом', () => {
  const small = ammBuyTokens(100, 1, 1_000_000, 0);
  const big = ammBuyTokens(100_000, 1, 1_000_000, 0);
  assert.ok(small / 100 > big / 100_000);
  assert.ok(Math.abs(ammSellUsd(100, 1, 1_000_000, 0) - 100) < 0.1);
});

test('DEX→CEX: CEX дорожча на 5% дає прибуток, без спреду — збиток', () => {
  const cfg = { ...DEFAULT_CONFIG, tradeSizeUsd: 500 };
  const win = evaluate({ listing, dex, cfg, cex: { bid: 1.05, ask: 1.051, quoteVolume: 1e6 } }).find((o) => o.direction === 'DEX_TO_CEX')!;
  assert.ok(win.profitPct > 4 && win.profitPct < 5, String(win.profitPct));
  const flat = evaluate({ listing, dex, cfg, cex: { bid: 1, ask: 1.001, quoteVolume: 1e6 } });
  assert.ok(flat.every((o) => o.profitPct < 0));
});

test('закритий депозит прибирає напрямок DEX→CEX; невідомий статус — теж, якщо requireTransferCheck', () => {
  const cex = { bid: 1.05, ask: 1.051, quoteVolume: 1e6 };
  const closed = evaluate({ listing: { ...listing, deposit: false }, dex, cex, cfg: DEFAULT_CONFIG });
  assert.ok(!closed.some((o) => o.direction === 'DEX_TO_CEX'));
  const unknown = evaluate({ listing: { ...listing, deposit: undefined }, dex, cex, cfg: DEFAULT_CONFIG });
  assert.ok(!unknown.some((o) => o.direction === 'DEX_TO_CEX'));
  const allowed = evaluate({ listing: { ...listing, deposit: undefined }, dex, cex, cfg: { ...DEFAULT_CONFIG, requireTransferCheck: false } });
  assert.ok(allowed.some((o) => o.direction === 'DEX_TO_CEX'));
});

test('CEX→DEX враховує комісію виводу', () => {
  const cex = { bid: 0.949, ask: 0.95, quoteVolume: 1e6 };
  const a = evaluate({ listing: { ...listing, withdrawFee: 0 }, dex, cex, cfg: DEFAULT_CONFIG }).find((o) => o.direction === 'CEX_TO_DEX')!;
  const b = evaluate({ listing: { ...listing, withdrawFee: 50 }, dex, cex, cfg: DEFAULT_CONFIG }).find((o) => o.direction === 'CEX_TO_DEX')!;
  assert.ok(a.profitUsd > b.profitUsd + 40);
});

test('назви мереж і адреси контрактів з відповідей бірж', () => {
  assert.equal(normalizeChain('BEP20(BSC)'), 'bsc');
  assert.equal(normalizeChain('Arbitrum One'), 'arbitrum');
  assert.equal(normalizeChain('ARBNOVA'), undefined);
  assert.equal(normalizeChain('SOL'), 'solana');
  assert.equal(normalizeChain('BEP2'), undefined);
  const evm = '0x' + 'a'.repeat(40);
  assert.equal(findContractAddress('bsc', { network: 'BSC', contractAddress: evm }), evm);
  assert.equal(findContractAddress('base', { ctAddr: evm }), evm);
  assert.equal(findContractAddress('bsc', { contractAddress: '' }), undefined);
  const sol = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  assert.equal(findContractAddress('solana', { contract: sol }), sol);
});
