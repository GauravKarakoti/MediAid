import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import * as db from '../services/database.js';
import {
  parseMedCommand,
  transcribeAudio,
  analyzePrescription,
  analyzeLabReport,
  checkDosageSafety,
} from '../services/groq-client.js';
import { eq } from 'drizzle-orm';
import {
  handleUserIntent,
  addMedicationToDb
} from '../shared/medication-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
});

const pendingAdditions = new Map<number, any>();
const pendingPrescriptions = new Map<number, any>();

const getUserId = (waId: string): number => parseInt(waId.replace('@c.us', ''), 10);

async function upsertUserProfile(userId: number) {
  await db.db
    .insert(db.users)
    .values({ telegramId: userId, platform: 'whatsapp', timezone: 'Asia/Kolkata' })
    .onConflictDoUpdate({
      target: db.users.telegramId,
      set: { platform: 'whatsapp' },
    });
}

waClient.on('qr', (qr) => {
  console.log('📱 Scan this QR code to log into WhatsApp Bot:');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  console.log('✅ WhatsApp MediAid Bot is ready!');
});

waClient.on('message', async (msg) => {
  const userId = getUserId(msg.from);
  await upsertUserProfile(userId);

  const body = (msg.body || '').trim();
  const upper = body.toUpperCase();

  if (upper === 'YES' && pendingAdditions.has(userId)) {
    const parsed = pendingAdditions.get(userId);
    await addMedicationToDb(userId, parsed, (text) => msg.reply(text));
    pendingAdditions.delete(userId);
    await msg.reply('✅ Medication added successfully.');
    return;
  }

  if (upper === 'CANCEL') {
    pendingAdditions.delete(userId);
    pendingPrescriptions.delete(userId);
    await msg.reply('❌ Action cancelled.');
    return;
  }

  const takenMatch = upper.match(/^TAKEN(?:\s+(\d+))?$/);
  if (takenMatch) {
    const medId = takenMatch[1] ? parseInt(takenMatch[1], 10) : null;

    if (medId) {
      await db.db.insert(db.adherenceLogs).values({
        telegramId: userId,
        medicationId: medId,
        status: 'taken',
      });
      await msg.reply('✅ Intake logged.');
      return;
    }

    await msg.reply('Please reply as TAKEN <medication_id> for the reminder you received.');
    return;
  }

  const skipMatch = upper.match(/^SKIP(?:\s+(\d+))?$/);
  if (skipMatch) {
    const medId = skipMatch[1] ? parseInt(skipMatch[1], 10) : null;

    if (medId) {
      await db.db.insert(db.adherenceLogs).values({
        telegramId: userId,
        medicationId: medId,
        status: 'missed',
      });
      await msg.reply('⚠️ Missed logged.');
      return;
    }

    await msg.reply('Please reply as SKIP <medication_id> for the reminder you received.');
    return;
  }

  const snoozeMatch = upper.match(/^SNOOZE(?:\s+(\d+))?$/);
  if (snoozeMatch) {
    const medId = snoozeMatch[1] ? parseInt(snoozeMatch[1], 10) : null;

    if (medId) {
      const snoozeTime = new Date(Date.now() + 10 * 60 * 1000);
      await db.db.update(db.medications).set({ snoozedUntil: snoozeTime }).where(eq(db.medications.id, medId));
      await msg.reply('💤 Snoozed for 10 minutes.');
      return;
    }

    await msg.reply('Please reply as SNOOZE <medication_id> for the reminder you received.');
    return;
  }

  let textToHandle = body;

  if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
    const media = await msg.downloadMedia();
    if (!media) return;

    const ogaPath = path.join(__dirname, `temp_${userId}.oga`);
    const mp3Path = path.join(__dirname, `temp_${userId}.mp3`);

    try {
      fs.writeFileSync(ogaPath, media.data, 'base64');
      execSync(`ffmpeg -i "${ogaPath}" "${mp3Path}" -y`);

      const transcript = await transcribeAudio(mp3Path);
      textToHandle = transcript;
      await msg.reply(`You said: "${transcript}"`);
    } finally {
      if (fs.existsSync(ogaPath)) fs.unlinkSync(ogaPath);
      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
    }
  }

  if (msg.hasMedia && msg.type === 'image') {
    const media = await msg.downloadMedia();
    if (!media) return;

    const buffer = Buffer.from(media.data, 'base64');
    await msg.reply('🔍 Scanning image... please wait.');

    const caption = (msg.body || '').toLowerCase();

    if (caption.includes('lab')) {
      const analysis = await analyzeLabReport(buffer);
      const count = analysis.summary?.key_biomarkers?.length || 0;
      await msg.reply(`📊 Lab Report Analysis\n\nAnalyzed ${count} biomarkers.`);
      return;
    }

    const analysis = await analyzePrescription(buffer);
    if (!analysis.isLegit) {
      await msg.reply('⚠️ This does not look like a valid prescription.');
      return;
    }

    pendingPrescriptions.set(userId, analysis.medications);
    await msg.reply('Detected Prescription. Reply YES to add all medications, or CANCEL.');
    return;
  }

  if (!textToHandle) return;

  const parsed = await parseMedCommand(textToHandle);

  if (parsed.intent === 'add_medication') {
    const medicationName = parsed.medicationName || 'Unknown Medication';

    const existing = await db.db
      .select()
      .from(db.medications)
      .where(eq(db.medications.telegramId, userId))
      .limit(50);

    if (existing.some((m) => m.name.toLowerCase() === medicationName.toLowerCase())) {
      await msg.reply(`⚠️ You already have ${medicationName} in your schedule.`);
      return;
    }

    if (parsed.dosage) {
      const safety = await checkDosageSafety(medicationName, parsed.dosage);
      if (!safety.safe) {
        pendingAdditions.set(userId, parsed);
        await msg.reply(`🚫 SAFETY WARNING\n${safety.warning}\n\nReply YES to add anyway or CANCEL to stop.`);
        return;
      }
    }

    await addMedicationToDb(userId, parsed, (text) => msg.reply(text));
    return;
  }

  if (parsed.intent === 'query_schedule') {
    const meds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
    if (meds.length === 0) {
      await msg.reply('💊 No medications scheduled.');
      return;
    }

    const list = meds.map((m) => `• ${m.name} at ${m.schedule}`).join('\n');
    await msg.reply(`💊 Your Schedule\n${list}`);
    return;
  }

  if (parsed.intent === 'general_conversation') {
    await msg.reply(parsed.response || 'How can I help with your meds today?');
    return;
  }

  await handleUserIntent(
    {
      userId,
      platform: 'whatsapp',
      reply: (text) => msg.reply(text),
      sendSOS: async (patientId) => {
        const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId)).limit(1);
        if (link.length > 0) {
          await waClient.sendMessage(
            `${link[0]!.caregiverTelegramId}@c.us`,
            `🚨 SOS ALERT\nPatient ${patientId} needs help immediately!`
          );
        }
      },
      setPendingUnsafe: (id, parsedData) => pendingAdditions.set(id, parsedData),
      getPendingUnsafe: (id) => pendingAdditions.get(id),
      clearPendingUnsafe: (id) => pendingAdditions.delete(id),
      setPendingPrescription: (id, meds) => pendingPrescriptions.set(id, meds),
      getPendingPrescription: (id) => pendingPrescriptions.get(id),
      clearPendingPrescription: (id) => pendingPrescriptions.delete(id),
    },
    textToHandle,
    parsed
  );
});

export const startWhatsAppBot = () => waClient.initialize();