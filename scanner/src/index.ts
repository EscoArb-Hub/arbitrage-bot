import { loadConfig } from './config.ts';
import { Scanner } from './scanner.ts';
import { startServer } from './server.ts';
import { telegramConfigured } from './telegram.ts';

const cfg = loadConfig();
const scanner = new Scanner(cfg);
const port = Number(process.env.PORT ?? 8787);

let scanTimer: NodeJS.Timeout | undefined;
let universeTimer: NodeJS.Timeout | undefined;

async function scanOnce(): Promise<void> {
  try {
    await scanner.scan();
    const s = scanner.state;
    console.log(`[scan] ${s.opportunities.length} зв'язок за ${s.status.scanMs} мс`);
  } catch (e) {
    console.error('[scan] помилка:', e);
  }
}

async function refreshUniverse(): Promise<void> {
  console.log('[universe] оновлюю список токенів і статус депозиту/виводу…');
  await scanner.refreshUniverse();
  for (const [id, s] of Object.entries(scanner.state.status.sources)) {
    if (id.startsWith('dex:')) continue;
    console.log(`  ${id}: ${s.ok ? `${s.listings} токенів у потрібних мережах${s.hasKeys ? '' : ' (без API-ключа)'}` : `помилка: ${s.error}`}`);
  }
}

function schedule(): void {
  clearInterval(scanTimer);
  clearInterval(universeTimer);
  scanTimer = setInterval(scanOnce, scanner.cfg.scanIntervalSec * 1000);
  universeTimer = setInterval(refreshUniverse, scanner.cfg.universeRefreshMin * 60_000);
}

startServer(scanner, port, async () => {
  schedule();
  await refreshUniverse();
  await scanOnce();
});

if (!telegramConfigured()) console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID не задані — сигнали будуть лише в панелі.');

await refreshUniverse();
await scanOnce();
schedule();
