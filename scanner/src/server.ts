import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { mergeConfig, saveConfig } from './config.ts';
import type { Scanner } from './scanner.ts';
import { sendTelegram, telegramConfigured } from './telegram.ts';

export function startServer(scanner: Scanner, port: number, onConfigChange: () => void): void {
  const app = express();
  app.use(express.json());

  app.get('/api/state', (_req, res) => {
    res.json({ ...scanner.state, status: { ...scanner.state.status, telegram: telegramConfigured() }, signals: scanner.state.signals.slice(0, 200) });
  });

  app.get('/api/config', (_req, res) => res.json(scanner.cfg));

  app.put('/api/config', (req, res) => {
    scanner.cfg = mergeConfig(scanner.cfg, req.body ?? {});
    saveConfig(scanner.cfg);
    onConfigChange();
    res.json(scanner.cfg);
  });

  app.post('/api/test-telegram', async (_req, res) => {
    if (!telegramConfigured()) return void res.status(400).json({ error: 'Не задано TELEGRAM_BOT_TOKEN або TELEGRAM_CHAT_ID у файлі .env' });
    try {
      await sendTelegram('✅ Арбітражний бот підключений. Сигнали приходитимуть сюди.');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String((e as Error).message ?? e) });
    }
  });

  // Зібрана React-панель (npm start)
  const dist = path.resolve(import.meta.dirname, '..', '..', 'dashboard', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.listen(port, () => console.log(`[api] http://localhost:${port}`));
}
