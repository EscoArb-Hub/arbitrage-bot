// Діагностика Telegram: npm run check:telegram
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(import.meta.dirname, '..', '..', '.env');
const ok = (s: string) => console.log('✅ ' + s);
const bad = (s: string) => console.log('❌ ' + s);

console.log('\nПеревірка Telegram\n');

if (!fs.existsSync(envPath)) {
  bad(`Файл .env не знайдено тут: ${envPath}`);
  const dir = path.dirname(envPath);
  const similar = fs.readdirSync(dir).filter((f) => f.toLowerCase().startsWith('.env'));
  if (similar.length) console.log(`   Знайдено схожі файли: ${similar.join(', ')}. Перейменуйте потрібний на ".env".`);
  process.exit(1);
}
ok(`Файл .env знайдено`);

const token = (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
const chatId = (process.env.TELEGRAM_CHAT_ID ?? '').trim();

if (!token) {
  bad('TELEGRAM_BOT_TOKEN порожній. Перевірте, що рядок виглядає так: TELEGRAM_BOT_TOKEN=123456:ABC... і що файл збережено (Ctrl+S).');
  process.exit(1);
}
if (!/^\d+:[\w-]{30,}$/.test(token)) bad(`Токен має дивний формат (довжина ${token.length}). Має бути "цифри:літери", без лапок і пробілів.`);
else ok(`Токен задано (${token.slice(0, 6)}…)`);

if (!chatId) {
  bad('TELEGRAM_CHAT_ID порожній. Дізнайтеся його через @userinfobot.');
  process.exit(1);
}
if (!/^-?\d+$/.test(chatId)) bad(`Chat id має бути числом, а зараз: "${chatId}"`);
else ok(`Chat id задано (${chatId})`);

const api = `https://api.telegram.org/bot${token}`;
try {
  const me = await (await fetch(`${api}/getMe`)).json();
  if (!me.ok) {
    bad(`Telegram не прийняв токен: ${me.description}. Скопіюйте токен з @BotFather ще раз.`);
    process.exit(1);
  }
  ok(`Токен правильний, бот: @${me.result.username}`);

  const sent = await (
    await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Арбітражний бот підключений. Сигнали приходитимуть сюди.' }),
    })
  ).json();
  if (!sent.ok) {
    bad(`Не вдалося надіслати повідомлення: ${sent.description}`);
    if (/chat not found|bot can't initiate|blocked/i.test(sent.description)) {
      if (chatId === token.split(':')[0]) console.log('   Ви вказали id самого бота (цифри з токена). Потрібен ВАШ id.');
      // Шукаємо chat id у повідомленнях, які бот отримав
      const upd = await (await fetch(`${api}/getUpdates`)).json();
      const chats = new Map<number, string>();
      for (const u of upd.result ?? []) {
        const c = u.message?.chat;
        if (c) chats.set(c.id, c.username ? `@${c.username}` : [c.first_name, c.last_name].filter(Boolean).join(' '));
      }
      if (chats.size) {
        console.log('   Бот бачить повідомлення з таких чатів. Ваш chat id, швидше за все:');
        for (const [id, name] of chats) console.log(`     TELEGRAM_CHAT_ID=${id}   (${name})`);
        console.log('   Вставте цей рядок у .env, збережіть і запустіть перевірку ще раз.');
      } else {
        console.log(`   Відкрийте https://t.me/${me.result.username}, натисніть Start і надішліть боту будь-яке повідомлення.`);
        console.log('   Потім запустіть цю перевірку ще раз: вона сама покаже ваш правильний chat id.');
      }
    }
    process.exit(1);
  }
  ok(`Повідомлення надіслано! Перевірте чат з @${me.result.username}`);
} catch (e) {
  bad(`Немає з'єднання з api.telegram.org: ${(e as Error).message}`);
  console.log('   Можливо, Telegram заблоковано у вашій мережі або антивірус/VPN блокує з\'єднання.');
  process.exit(1);
}
