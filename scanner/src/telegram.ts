import type { Opportunity } from './engine.ts';
import { tradeUrl } from './cex.ts';
import { EXPLORER } from './chains.ts';

const CHAIN_NAME = { bsc: 'BSC', arbitrum: 'Arbitrum', base: 'Base', solana: 'Solana' } as const;
const CEX_NAME = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX', gate: 'Gate', mexc: 'MEXC' } as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtPrice(p: number): string {
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(4);
}

export function formatSignal(o: Opportunity): string {
  const dex = `${o.dexId} (${CHAIN_NAME[o.chain]})`;
  const cex = CEX_NAME[o.cex];
  const [buy, sell] = o.direction === 'DEX_TO_CEX' ? [dex, cex] : [cex, dex];
  const [buyPrice, sellPrice] = o.direction === 'DEX_TO_CEX' ? [o.dexPrice, o.cexPrice] : [o.cexPrice, o.dexPrice];
  const transfer = o.direction === 'DEX_TO_CEX' ? `депозит на ${cex}` : `вивід з ${cex}`;
  const transferState = o.transferOk === true ? '✅ відкритий' : '⚠️ статус невідомий';
  const lines = [
    `<b>💰 ${esc(o.base)}</b>  +${o.profitPct.toFixed(2)}% (≈ $${o.profitUsd.toFixed(2)} на $${o.tradeSizeUsd})`,
    ``,
    `🟢 Купити: <b>${esc(buy)}</b> по $${fmtPrice(buyPrice)}`,
    `🔴 Продати: <b>${esc(sell)}</b> по $${fmtPrice(sellPrice)}`,
    `↔️ Спред: ${o.rawSpreadPct.toFixed(2)}% · ${transfer}: ${transferState}`,
    o.withdrawFee !== undefined && o.direction === 'CEX_TO_DEX' ? `💸 Комісія виводу: ${o.withdrawFee} ${esc(o.base)}` : '',
    `💧 Ліквідність DEX: $${Math.round(o.dexLiquidityUsd).toLocaleString('en-US')} · обсяг CEX 24г: $${Math.round(o.cexVolumeUsd).toLocaleString('en-US')}`,
    o.depthChecked ? '' : `⚠️ Розраховано лише за найкращою ціною, без стакану`,
    ``,
    `<a href="${o.pairUrl}">DEX</a> · <a href="${tradeUrl(o.cex, o.base)}">${cex}</a> · <a href="${EXPLORER[o.chain]}${o.address}">Контракт</a>`,
    `<code>${esc(o.address)}</code>`,
  ];
  return lines.filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== '')).join('\n');
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram: HTTP ${res.status} ${await res.text()}`);
}
