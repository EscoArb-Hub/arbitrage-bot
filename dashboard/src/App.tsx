import { useEffect, useState } from 'react';
import { CEX_IDS, CEX_NAME, CHAIN_NAME, CHAINS, type Config, type Opportunity, type State } from './types.ts';

type Tab = 'live' | 'signals' | 'settings' | 'status';

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const price = (n: number) => (n >= 1 ? n.toFixed(4) : n.toPrecision(4));
const time = (t?: number) => (t ? new Date(t).toLocaleTimeString('uk-UA') : '—');

export default function App() {
  const [tab, setTab] = useState<Tab>('live');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as State;
        if (alive) {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (alive) setError('Сканер не відповідає. Запустіть його командою npm run dev.');
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Арбітраж DEX ↔ CEX</h1>
        <div className="meta">
          Останнє сканування: {time(state?.status.lastScanAt)}
          {state?.status.scanMs !== undefined && ` · ${(state.status.scanMs / 1000).toFixed(1)} с`}
          {' · '}Telegram: {state?.status.telegram ? '✅' : '⚠️ не налаштований'}
        </div>
      </header>
      <nav>
        {(
          [
            ['live', `Зв'язки${state ? ` (${state.opportunities.length})` : ''}`],
            ['signals', 'Історія сигналів'],
            ['settings', 'Налаштування'],
            ['status', 'Статус джерел'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {error && <div className="error">{error}</div>}
      <main>
        {tab === 'live' && state && <OppTable rows={state.opportunities} empty="Поки що немає зв'язок, що проходять фільтри." />}
        {tab === 'signals' && state && (
          <OppTable
            rows={state.signals.map((s) => s.opportunity)}
            times={state.signals.map((s) => s.at)}
            sent={state.signals.map((s) => (s.sent ? '✅' : s.error ? `❌ ${s.error}` : '—'))}
            empty="Сигналів ще не було."
          />
        )}
        {tab === 'settings' && <Settings />}
        {tab === 'status' && state && <Status state={state} />}
      </main>
    </div>
  );
}

function OppTable({ rows, times, sent, empty }: { rows: Opportunity[]; times?: number[]; sent?: string[]; empty: string }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {times && <th>Час</th>}
            <th>Токен</th>
            <th>Купити</th>
            <th>Продати</th>
            <th className="num">Спред</th>
            <th className="num">Прибуток</th>
            <th className="num">Ліквідність DEX</th>
            <th>Переказ</th>
            <th>Посилання</th>
            {sent && <th>Telegram</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => {
            const dex = `${o.dexId} · ${CHAIN_NAME[o.chain]}`;
            const cex = CEX_NAME[o.cex];
            const buyDex = o.direction === 'DEX_TO_CEX';
            return (
              <tr key={o.id + (times?.[i] ?? '')}>
                {times && <td>{new Date(times[i]).toLocaleString('uk-UA')}</td>}
                <td>
                  <b>{o.base}</b>
                </td>
                <td>
                  {buyDex ? dex : cex}
                  <div className="sub">${price(buyDex ? o.dexPrice : o.cexPrice)}</div>
                </td>
                <td>
                  {buyDex ? cex : dex}
                  <div className="sub">${price(buyDex ? o.cexPrice : o.dexPrice)}</div>
                </td>
                <td className="num">{o.rawSpreadPct.toFixed(2)}%</td>
                <td className="num profit">
                  +{o.profitPct.toFixed(2)}%<div className="sub">{`≈ $${o.profitUsd.toFixed(2)} на ${usd(o.tradeSizeUsd)}`}</div>
                </td>
                <td className="num">{usd(o.dexLiquidityUsd)}</td>
                <td>
                  {buyDex ? 'депозит' : 'вивід'} {o.transferOk ? '✅' : '⚠️'}
                  {!o.depthChecked && <div className="sub">без стакану</div>}
                </td>
                <td>
                  <a href={o.pairUrl} target="_blank" rel="noreferrer">
                    DEX
                  </a>
                </td>
                {sent && <td className="sub">{sent[i]}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Settings() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tokensText, setTokensText] = useState('');

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c: Config) => {
        setCfg(c);
        setTokensText(c.manualTokens.map((t) => `${t.symbol} ${t.chain} ${t.address}`).join('\n'));
      })
      .catch(() => setMsg('Не вдалося завантажити налаштування.'));
  }, []);

  if (!cfg) return <p className="empty">{msg ?? 'Завантаження…'}</p>;

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const num = (k: keyof Config, label: string, hint?: string) => (
    <label className="field">
      <span>{label}</span>
      <input type="number" step="any" value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value) as never)} />
      {hint && <small>{hint}</small>}
    </label>
  );

  const save = async () => {
    const manualTokens = tokensText
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter((p) => p.length === 3)
      .map(([symbol, chain, address]) => ({ symbol: symbol.toUpperCase(), chain: chain.toLowerCase() as Config['chains'][number], address }));
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...cfg, manualTokens }),
    });
    setMsg(res.ok ? 'Збережено. Сканер перезапускає пошук.' : 'Помилка збереження.');
    if (res.ok) setCfg(await res.json());
  };

  const testTelegram = async () => {
    const res = await fetch('/api/test-telegram', { method: 'POST' });
    const body = await res.json();
    setMsg(res.ok ? 'Тестове повідомлення надіслано в Telegram.' : `Telegram: ${body.error}`);
  };

  return (
    <div className="settings">
      <section>
        <h3>Біржі</h3>
        <div className="chips">
          {CEX_IDS.map((c) => (
            <label key={c} className="chip">
              <input type="checkbox" checked={cfg.cex.includes(c)} onChange={() => set('cex', toggle(cfg.cex, c))} />
              {CEX_NAME[c]}
            </label>
          ))}
        </div>
        <h3>Мережі DEX</h3>
        <div className="chips">
          {CHAINS.map((c) => (
            <label key={c} className="chip">
              <input type="checkbox" checked={cfg.chains.includes(c)} onChange={() => set('chains', toggle(cfg.chains, c))} />
              {CHAIN_NAME[c]}
            </label>
          ))}
        </div>
      </section>
      <section className="grid">
        {num('tradeSizeUsd', 'Обсяг угоди, $', 'на нього рахується прибуток і прослизання')}
        {num('minProfitPct', 'Мінімальний прибуток, %')}
        {num('maxProfitPct', 'Максимальний прибуток, %', 'вище — швидше за все помилка даних')}
        {num('minDexLiquidityUsd', 'Мін. ліквідність DEX, $')}
        {num('minCexVolumeUsd', 'Мін. обсяг CEX за 24 год, $')}
        {num('cexTakerFeePct', 'Комісія CEX, %')}
        {num('dexFeePct', 'Комісія DEX, %')}
        {num('scanIntervalSec', 'Інтервал сканування, с')}
        {num('signalCooldownMin', 'Пауза між повторними сигналами, хв')}
      </section>
      <section>
        <h3>Газ за транзакцію, $</h3>
        <div className="grid">
          {CHAINS.map((c) => (
            <label key={c} className="field">
              <span>{CHAIN_NAME[c]}</span>
              <input
                type="number"
                step="any"
                value={cfg.gasUsd[c]}
                onChange={(e) => set('gasUsd', { ...cfg.gasUsd, [c]: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
        <label className="chip">
          <input type="checkbox" checked={cfg.requireTransferCheck} onChange={(e) => set('requireTransferCheck', e.target.checked)} />
          Показувати лише зв'язки з підтвердженим депозитом/виводом
        </label>
      </section>
      <section>
        <h3>Токени вручну</h3>
        <small>Один на рядок: СИМВОЛ мережа адреса. Наприклад: PEPE bsc 0x… Мережі: bsc, arbitrum, base, solana.</small>
        <textarea rows={5} value={tokensText} onChange={(e) => setTokensText(e.target.value)} />
      </section>
      <div className="actions">
        <button className="primary" onClick={save}>
          Зберегти
        </button>
        <button onClick={testTelegram}>Тест Telegram</button>
        {msg && <span className="msg">{msg}</span>}
      </div>
    </div>
  );
}

function Status({ state }: { state: State }) {
  const entries = Object.entries(state.status.sources).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Джерело</th>
            <th>Стан</th>
            <th className="num">Токенів</th>
            <th>API-ключ</th>
            <th>Оновлено</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, s]) => (
            <tr key={id}>
              <td>{id.startsWith('dex:') ? `DEX · ${CHAIN_NAME[id.slice(4) as keyof typeof CHAIN_NAME]}` : CEX_NAME[id as keyof typeof CEX_NAME] ?? id}</td>
              <td>{s.ok ? '✅' : `❌ ${s.error ?? ''}`}</td>
              <td className="num">{s.listings ?? '—'}</td>
              <td>{id.startsWith('dex:') ? '—' : s.hasKeys ? '✅' : 'немає'}</td>
              <td>{time(s.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub">
        Без API-ключа (лише на читання) деякі біржі не повідомляють статус депозиту/виводу і адреси контрактів, тому знаходять менше токенів.
      </p>
    </div>
  );
}
