import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import * as db from '../services/database.js';
import {
  parseMedCommand,
  transcribeAudio,
  analyzePrescription,
  analyzeLabReport,
  getHealthAwareResponse,
} from '../services/groq-client.js';
import {
  handleUserIntent,
  sendAlarmSetupInstructions,
  addMedicationToDb,
  parseTime,
} from '../shared/medication-core.js';
import { eq } from 'drizzle-orm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const bot = new Telegraf(process.env.BOT_TOKEN!);

const pendingConfirmations = new Map<number, any>();
const pendingAdditions = new Map<number, any>();
const photoCache = new Map<string, string>();

async function upsertUserProfile(userId: number) {
  await db.db
    .insert(db.users)
    .values({ telegramId: userId, platform: 'telegram', timezone: 'Asia/Kolkata' })
    .onConflictDoUpdate({
      target: db.users.telegramId,
      set: { platform: 'telegram' },
    });
}

bot.help(async (ctx) => {
  const helpMessage = `
MediAid Help

Medications
• Add: "Add 5mg Aspirin daily at 9 AM"
• Log Intake: "I took my Aspirin"
• Remove: "Stop my Aspirin medication"
• Check Schedule: "My Schedule"
• Missed Meds: "Did I forget any pills today?"

Appointments
• Set: "Dentist appointment on Feb 20 at 2 PM"
• Update: "Change my dentist appointment to 4 PM"
• Cancel: "Cancel my doctor visit"
• View: "Show my appointments"

Health
• Log Vitals: "My BP is 120/80"
• View History: "Show my health logs"

Prescription Scan
• Send a photo of your prescription

Caretaker
• /setcaretaker
• /becomecaretaker

Emergency
• Say "Help me" or "SOS"
  `;
  await ctx.reply(helpMessage);
  await sendAlarmSetupInstructions((text, options) => ctx.reply(text, options));
});

bot.start(async (ctx) => {
  await upsertUserProfile(ctx.from.id);
  await ctx.reply(
    `👵 Welcome to MediAid.\nTry saying 'Add 5mg Lisinopril at 8 AM' or 'I took my medicine'.\n\nType /help at any time to see everything I can do.`,
    Markup.keyboard([['My Schedule', 'I took my medicine']]).resize()
  );
  await sendAlarmSetupInstructions((text, options) => ctx.reply(text, options));
});

bot.command('timezone', async (ctx) => {
  await upsertUserProfile(ctx.from.id);

  const raw = ctx.message?.text || '';
  const tz = raw.split(' ').slice(1).join(' ').trim();
  if (!tz) return ctx.reply('Usage: /timezone Asia/Kolkata');

  await db.db
    .insert(db.users)
    .values({ telegramId: ctx.from.id, platform: 'telegram', timezone: tz })
    .onConflictDoUpdate({
      target: db.users.telegramId,
      set: { platform: 'telegram', timezone: tz },
    });

  await ctx.reply(`✅ Timezone updated to ${tz}`);
});

bot.command('setcaretaker', (ctx) => {
  ctx.reply(
    'To add a caretaker, please click the button below and select them from your chat list:',
    Markup.keyboard([[Markup.button.userRequest('👤 Select Caretaker', 1)]]).resize().oneTime()
  );
});

bot.command('becomecaretaker', (ctx) => {
  ctx.reply(
    "To become a caretaker, please share the Patient's Contact:",
    Markup.keyboard([[Markup.button.userRequest('👤 Share Patient Contact', 2)]]).resize().oneTime()
  );
});

bot.on('message', async (ctx, next) => {
  const msg = ctx.message as any;
  await upsertUserProfile(ctx.from.id);

  if (msg.user_shared && msg.user_shared.request_id === 1) {
    const patientId = ctx.from.id;
    const caregiverId = msg.user_shared.user_id;

    try {
      await db.db
        .insert(db.caregivers)
        .values({
          patientTelegramId: patientId,
          caregiverTelegramId: caregiverId,
        })
        .onConflictDoUpdate({
          target: db.caregivers.patientTelegramId,
          set: { caregiverTelegramId: caregiverId },
        });

      await ctx.reply('✅ Caretaker successfully updated!');

      try {
        await bot.telegram.sendMessage(
          caregiverId,
          `ℹ️ You have been assigned as a caretaker for ${ctx.from.first_name || 'a patient'}.`
        );
      } catch {
        await ctx.reply("⚠️ Caretaker saved, but I couldn't notify them. Please ask them to start this bot.");
      }
    } catch (error) {
      console.error('Error setting caretaker:', error);
      await ctx.reply('Failed to set caretaker. Please try again.');
    }
    return;
  }

  if (msg.user_shared && msg.user_shared.request_id === 2) {
    const caretakerId = ctx.from.id;
    const patientId = msg.user_shared.user_id;

    try {
      await bot.telegram.sendMessage(
        patientId,
        `👤 User ${ctx.from.first_name} wants to be your Caretaker.\nDo you accept?`,
        Markup.inlineKeyboard([
          Markup.button.callback('✅ Accept', `accept_care_${caretakerId}`),
          Markup.button.callback('❌ Deny', 'deny_care'),
        ])
      );
      await ctx.reply('✅ Request sent to patient. Waiting for approval.');
    } catch {
      await ctx.reply('⚠️ Could not reach patient. They must start this bot first.');
    }
    return;
  }

  return next();
});

bot.on(message('text'), async (ctx) => {
  const text = ctx.message.text;
  const userId = ctx.from.id;

  await upsertUserProfile(userId);

  const parsed = await parseMedCommand(text);

  const healthKeywords = ['diet', 'eat', 'food', 'allergy', 'workout', 'health'];
  if (parsed.intent === 'general_conversation' && healthKeywords.some((k) => text.toLowerCase().includes(k))) {
    const logs = await db.db.select().from(db.healthLogs).where(eq(db.healthLogs.telegramId, userId)).limit(5);
    const healthContext = logs.map((l) => `${l.type}: ${l.value}`).join(', ');
    const response = await getHealthAwareResponse(text, healthContext);
    return ctx.reply(response);
  }

  await handleUserIntent(
    {
      userId,
      platform: 'telegram',
      reply: (replyText, options) => ctx.reply(replyText, options),
      sendSOS: async (patientId) => {
        const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId)).limit(1);
        if (link.length > 0) {
          await bot.telegram.sendMessage(
            link[0]!.caregiverTelegramId,
            `🚨 <b>SOS ALERT</b>\nPatient ${patientId} needs help immediately!`,
            { parse_mode: 'HTML' }
          );
        }
      },
      setPendingUnsafe: (id, parsedData) => pendingAdditions.set(id, parsedData),
      getPendingUnsafe: (id) => pendingAdditions.get(id),
      clearPendingUnsafe: (id) => pendingAdditions.delete(id),
      setPendingPrescription: (id, meds) => pendingConfirmations.set(id, meds),
      getPendingPrescription: (id) => pendingConfirmations.get(id),
      clearPendingPrescription: (id) => pendingConfirmations.delete(id),
    },
    text,
    parsed
  );
});

bot.on(message('voice'), async (ctx) => {
  const userId = ctx.from.id;
  await upsertUserProfile(userId);

  const ogaPath = path.join(__dirname, `temp_${userId}.oga`);
  const mp3Path = path.join(__dirname, `temp_${userId}.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

    fs.writeFileSync(ogaPath, Buffer.from(response.data));
    execSync(`ffmpeg -i "${ogaPath}" "${mp3Path}" -y`);

    const transcript = await transcribeAudio(mp3Path);
    await handleUserIntent(
      {
        userId,
        platform: 'telegram',
        reply: (replyText, options) => ctx.reply(replyText, options),
        sendSOS: async (patientId) => {
          const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId)).limit(1);
          if (link.length > 0) {
            await bot.telegram.sendMessage(
              link[0]!.caregiverTelegramId,
              `🚨 <b>SOS ALERT</b>\nPatient ${patientId} needs help immediately!`,
              { parse_mode: 'HTML' }
            );
          }
        },
      },
      transcript
    );
  } catch {
    await ctx.reply("Sorry, I couldn't process that voice message.");
  } finally {
    if (fs.existsSync(ogaPath)) fs.unlinkSync(ogaPath);
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
});

bot.on(message('photo'), async (ctx) => {
  const photo = ctx.message.photo.pop();
  if (!photo) return;

  await upsertUserProfile(ctx.from.id);

  photoCache.set(photo.file_unique_id, photo.file_id);

  await ctx.reply(
    'What is this photo?',
    Markup.inlineKeyboard([
      [Markup.button.callback('💊 Prescription', `scan_presc_${photo.file_unique_id}`)],
      [Markup.button.callback('🔬 Lab Report', `scan_lab_${photo.file_unique_id}`)],
    ])
  );
});

bot.action(/scan_presc_(.+)/, async (ctx) => {
  const uniqueId = ctx.match[1];
  const fileId = photoCache.get(uniqueId as string);

  if (!fileId) {
    return await ctx.answerCbQuery('⚠️ Session expired or invalid photo.', { show_alert: true });
  }

  try {
    await ctx.editMessageText('🔍 Scanning prescription... please wait.');

    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    const analysis = await analyzePrescription(buffer);

    if (!analysis.isLegit) {
      return await ctx.reply('⚠️ This does not look like a valid prescription. Please upload a clear photo.');
    }

    let confirmMsg = '<b>Prescription Detected</b>\nIs this correct?\n';
    analysis.medications.forEach((m: any, i: number) => {
      const time = parseTime(m.time);
      confirmMsg += `\n${i + 1}. 💊 ${m.name} - ${m.dosage} at ${time}`;
      if (m.notes) confirmMsg += `\n   📝 <i>Note: ${m.notes}</i>`;
    });

    pendingConfirmations.set(ctx.from!.id, analysis.medications);

    await ctx.reply(confirmMsg, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Yes, Add All', 'confirm_prescription')],
        [Markup.button.callback('❌ No, Cancel', 'cancel_prescription')],
      ]),
    });
  } catch (e) {
    console.error('Prescription Scan Error:', e);
    await ctx.reply('Error processing image. Please ensure the photo is clear.');
  }
});

bot.action(/scan_lab_(.+)/, async (ctx) => {
  const uniqueId = ctx.match[1];
  const fileId = photoCache.get(uniqueId as string);

  if (!fileId) {
    return await ctx.answerCbQuery('⚠️ Session expired.', { show_alert: true });
  }

  try {
    await ctx.editMessageText('🔬 Analyzing lab report... please wait.');

    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

    const analysis = await analyzeLabReport(Buffer.from(response.data));

    if (!analysis.summary?.key_biomarkers || analysis.summary.key_biomarkers.length === 0) {
      return await ctx.reply('⚠️ Could not extract specific biomarkers. Please consult a doctor.');
    }

    let reportText = `📊 Lab Report Analysis\n\n`;

    analysis.summary.key_biomarkers.forEach((b: any) => {
      const isNormal =
        b.interpretation.toLowerCase().includes('normal') ||
        b.interpretation.toLowerCase().includes('within normal limits');
      const statusEmoji = isNormal ? '✅' : '⚠️';

      reportText += `${statusEmoji} ${b.name}\n`;
      reportText += `   Result: ${b.value} ${b.units}\n`;
      reportText += `   Range: ${b.reference_range}\n`;
      reportText += `   ${b.interpretation}\n\n`;
    });

    reportText += `💡 Disclaimer: This is an AI summary. Always verify with your healthcare provider.`;
    await ctx.reply(reportText);
  } catch (e) {
    console.error('Lab Analysis Error:', e);
    await ctx.reply('Failed to analyze the lab report. Please try a clearer image.');
  }
});

bot.action('confirm_prescription', async (ctx) => {
  const meds = pendingConfirmations.get(ctx.from!.id);
  if (!meds) return await ctx.editMessageText('⚠️ Session expired.');

  for (const m of meds) {
    const freq = m.frequency ?? 1;
    const time = parseTime(m.time, m.name);

    await db.db.insert(db.medications).values({
      telegramId: ctx.from!.id,
      name: m.name,
      dosage: m.dosage,
      schedule: time,
      frequency: freq,
      notes: m.notes || null,
      allowSnooze: m.allowSnooze ?? true,
    });
  }

  pendingConfirmations.delete(ctx.from!.id);
  await ctx.editMessageText('✅ All medications added to your schedule.');
});

bot.action('cancel_prescription', async (ctx) => {
  pendingConfirmations.delete(ctx.from!.id);
  await ctx.editMessageText('❌ Prescription scan cancelled.');
});

bot.action('confirm_unsafe_add', async (ctx) => {
  const userId = ctx.from!.id;
  const parsed = pendingAdditions.get(userId);

  if (!parsed) return await ctx.editMessageText('⚠️ Session expired. Please try again.');

  await addMedicationToDb(userId, parsed, (text, options) => ctx.reply(text, options));
  pendingAdditions.delete(userId);
  await ctx.editMessageText('✅ Warning acknowledged. Medication added.');
});

bot.action('cancel_unsafe_add', async (ctx) => {
  pendingAdditions.delete(ctx.from!.id);
  await ctx.editMessageText('❌ Medication addition cancelled.');
});

bot.action(/accept_care_(.+)/, async (ctx) => {
  const caretakerId = parseInt(ctx.match[1]!, 10);
  const patientId = ctx.from!.id;

  await db.db
    .insert(db.caregivers)
    .values({ patientTelegramId: patientId, caregiverTelegramId: caretakerId })
    .onConflictDoUpdate({
      target: db.caregivers.patientTelegramId,
      set: { caregiverTelegramId: caretakerId },
    });

  await ctx.editMessageText('✅ Caretaker accepted!');
  await bot.telegram.sendMessage(caretakerId, '✅ You are now the caretaker.');
});

bot.action('sos_trigger', async (ctx) => {
  const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, ctx.from!.id)).limit(1);
  if (link.length > 0) {
    await bot.telegram.sendMessage(
      link[0]!.caregiverTelegramId,
      `🚨 <b>SOS ALERT</b>\nPatient ${ctx.from!.id} needs help immediately!`,
      { parse_mode: 'HTML' }
    );
  }
  await ctx.answerCbQuery();
});

bot.launch();
bot.telegram.setMyCommands([
  { command: 'help', description: 'Show usage guide' },
  { command: 'setcaretaker', description: 'Setup a caretaker' },
  { command: 'becomecaretaker', description: 'Become a caretaker' },
  { command: 'timezone', description: 'Set your timezone' },
]);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));