import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import cron from 'node-cron';
import { parseMedCommand } from './services/groq-client.js';
import * as db from './services/database.js';
import { eq } from 'drizzle-orm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bot = new Telegraf(process.env.BOT_TOKEN!);

// --- 1. CORE MESSAGE HANDLER (TEXT & VOICE) ---

/**
 * Processes the user's intent after text is extracted/transcribed.
 */
async function handleUserIntent(ctx: Context, text: string) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const parsed = await parseMedCommand(text);

    switch (parsed.intent) {
      case 'add_medication':
        // Save to database
        await db.db.insert(db.medications).values({
          telegramId: userId,
          name: parsed.medicationName || 'Unknown Medication',
          dosage: parsed.dosage || 'As prescribed',
          schedule: parsed.time || '09:00', // Default if time not parsed
        });
        await ctx.reply(`✅ Added: ${parsed.medicationName} (${parsed.dosage}) at ${parsed.time || '09:00'}.`);
        break;

      case 'log_intake':
        // Log adherence
        await db.db.insert(db.adherenceLogs).values({
          telegramId: userId,
          status: 'taken',
          medicationId: 0, // In a full app, you'd look up the ID by name
        });
        await ctx.reply(`📊 Logged: ${parsed.parsedMessage}`);
        break;

      case 'query_schedule':
        const meds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
        if (meds.length === 0) {
          await ctx.reply("You don't have any medications scheduled.");
        } else {
          const list = meds.map(m => `• ${m.name} (${m.dosage}) at ${m.schedule}`).join('\n');
          await ctx.reply(`📋 Your Schedule:\n${list}`);
        }
        break;

      default:
        await ctx.reply(parsed.parsedMessage || "I'm here to help with your meds. You can say 'I took my aspirin' or 'Add 5mg Lisinopril at 8 AM'.");
    }
  } catch (error) {
    console.error("Intent Error:", error);
    await ctx.reply("I had trouble understanding that. Could you try again?");
  }
}

// --- 2. INPUT LISTENERS ---

bot.start((ctx) => {
  ctx.reply("👵 Welcome to MediAid. You can send me text or voice messages to manage your medications.", 
    Markup.keyboard([['My Schedule', 'I took my medicine']]).resize()
  );
});

// Text messages
bot.on(message('text'), async (ctx) => {
  await handleUserIntent(ctx, ctx.message.text);
});

// Voice messages
bot.on(message('voice'), async (ctx) => {
  const userId = ctx.from.id;
  const ogaPath = path.join(__dirname, `temp_${userId}.oga`);
  const mp3Path = path.join(__dirname, `temp_${userId}.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    
    fs.writeFileSync(ogaPath, Buffer.from(response.data));
    execSync(`ffmpeg -i ${ogaPath} ${mp3Path} -y`);

    // NOTE: In a production app, you would send mp3Path to Groq Whisper or another STT service here.
    const transcript = "Placeholder transcript from STT service"; 
    
    await handleUserIntent(ctx, transcript);
  } catch (e) {
    console.error(e);
    ctx.reply("Sorry, I couldn't process that voice message.");
  } finally {
    if (fs.existsSync(ogaPath)) fs.unlinkSync(ogaPath);
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
});

// --- 3. MEDICATION REMINDERS (CRON) ---

// Checks every minute for medications due now
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const dueMeds = await db.db.select().from(db.medications).where(eq(db.medications.schedule, currentTime));

  for (const med of dueMeds) {
    await bot.telegram.sendMessage(
      med.telegramId, 
      `⏰ REMINDER: It's time to take your ${med.name} (${med.dosage})!`,
      Markup.inlineKeyboard([
        [Markup.button.callback("✅ I've taken it", `taken_${med.id}`)],
        [Markup.button.callback("❌ I'll skip it", `missed_${med.id}`)]
      ])
    );
  }
});

// --- 4. ADHERENCE LOGGING & CAREGIVER NOTIFICATIONS ---

bot.action(/taken_(.+)/, async (ctx) => {
  const medId = parseInt(ctx.match[1]!);
  await db.db.insert(db.adherenceLogs).values({
    telegramId: ctx.from!.id,
    medicationId: medId,
    status: 'taken'
  });
  await ctx.answerCbQuery();
  await ctx.editMessageText("✅ Great job! Intake logged.");
});

bot.action(/missed_(.+)/, async (ctx) => {
  const medId = parseInt(ctx.match[1]!);
  const patientId = ctx.from!.id;

  // Log missed dose
  await db.db.insert(db.adherenceLogs).values({
    telegramId: patientId,
    medicationId: medId,
    status: 'missed'
  });

  // Notify Caregiver
  const caregiver = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId));
  if (caregiver[0]) {
    await bot.telegram.sendMessage(
      caregiver[0].caregiverTelegramId!, 
      `⚠️ ALERT: ${ctx.from?.first_name || 'The patient'} missed their medication (ID: ${medId}).`
    );
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText("⚠️ I've noted that you missed it and notified your caregiver.");
});

// --- 5. INITIALIZATION ---

bot.launch();
console.log("🚀 MediAid Bot is running and monitoring schedules...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));