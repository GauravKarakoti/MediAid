import express from 'express';
import { bot as telegramBot } from './telegram/bot.js';
import { startWhatsAppBot } from './whatsapp/bot.js';
import { initCrons } from './scheduler.js';

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('MediAid Unified Service is running!');
});

async function main() {
  app.listen(port, () => console.log(`🌍 Web server running on port ${port}`));

  await telegramBot.launch();
  console.log('🚀 Telegram Bot started');

  startWhatsAppBot();

  initCrons();
}

main().catch(console.error);

process.once('SIGINT', () => telegramBot.stop('SIGINT'));
process.once('SIGTERM', () => telegramBot.stop('SIGTERM'));