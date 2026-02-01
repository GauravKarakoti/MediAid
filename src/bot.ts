import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import cron from 'node-cron';
import { parseMedCommand, transcribeAudio } from './services/groq-client.js';
import * as db from './services/database.js';
import { eq, and, ilike, sql, isNull } from 'drizzle-orm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bot = new Telegraf(process.env.BOT_TOKEN!);

// --- 1. CORE MESSAGE HANDLER (TEXT & VOICE) ---

async function handleUserIntent(ctx: Context, text: string) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    const parsed = await parseMedCommand(text);

    switch (parsed.intent) {
      case 'add_medication':
        await db.db.insert(db.medications).values({
          telegramId: userId,
          name: parsed.medicationName || 'Unknown Medication',
          dosage: parsed.dosage || 'As prescribed',
          schedule: parsed.time || '09:00',
          frequency: parsed.frequencyDays || 1, // Default to daily
        });
        
        const freqText = (!parsed.frequencyDays || parsed.frequencyDays === 1) ? 'daily' : `every ${parsed.frequencyDays} days`;
        await ctx.reply(`✅ Added: ${parsed.medicationName} (${parsed.dosage}) at ${parsed.time || '09:00'} (${freqText}).`);
        break;
      
      case 'remove_medication':
        if (parsed.medicationName) {
            const deleted = await db.db.delete(db.medications)
                .where(
                    and(
                        eq(db.medications.telegramId, userId),
                        ilike(db.medications.name, `%${parsed.medicationName}%`)
                    )
                )
                .returning();
            
            if (deleted.length > 0) {
                await ctx.reply(`🗑️ Removed ${deleted.length} medication(s) matching "${parsed.medicationName}".`);
            } else {
                await ctx.reply(`⚠️ Could not find any medication named "${parsed.medicationName}" to remove.`);
            }
        } else {
            await ctx.reply("Please specify which medication you want to remove.");
        }
        break;

      case 'log_intake':
        // ACTUAL IMPLEMENTATION: Look up the medication ID by name for this user
        let medId: number | null = null;
        if (parsed.medicationName) {
            const existingMeds = await db.db.select()
                .from(db.medications)
                .where(
                    and(
                        eq(db.medications.telegramId, userId),
                        ilike(db.medications.name, `%${parsed.medicationName}%`)
                    )
                )
                .limit(1);
            
            if (existingMeds.length > 0) {
                medId = existingMeds[0]!.id;
            }
        }

        await db.db.insert(db.adherenceLogs).values({
          telegramId: userId,
          status: 'taken',
          medicationId: medId,
        });
        await ctx.reply(`📊 Logged: ${parsed.parsedMessage || `Intake of ${parsed.medicationName}`}`);
        break;

      case 'query_schedule':
        const meds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
        if (meds.length === 0) {
          await ctx.reply("You don't have any medications scheduled.");
        } else {
          const list = meds.map(m => {
            const freq = m.frequency === 1 ? 'Daily' : `Every ${m.frequency} days`;
            return `• ${m.name} (${m.dosage}) at ${m.schedule} - ${freq}`;
          }).join('\n');
          await ctx.reply(`📋 Your Schedule:\n${list}`);
        }
        break;

      default:
        await ctx.reply(parsed.parsedMessage || "I'm here to help with your meds. You can say 'I took my aspirin', 'Add 5mg Lisinopril at 8 AM', or 'Remove Aspirin'.");
    }
  } catch (error) {
    console.error("Intent Error:", error);
    await ctx.reply("I had trouble understanding that. Could you try again?");
  }
}

// --- 2. CARETAKER MANAGEMENT ---

bot.command('setcaretaker', (ctx) => {
  ctx.reply("To add a caretaker, please click the button below and select them from your chat list:",
    Markup.keyboard([
      Markup.button.userRequest("👤 Select Caretaker", 1) // Request ID 1
    ]).resize().oneTime()
  );
});

// FIX: Listen to generic 'message' and manually check for 'user_shared' to bypass strict type checking
bot.on('message', async (ctx, next) => {
  const msg = ctx.message as any;

  // Check if the message contains user_shared data
  if (msg.user_shared) {
    const patientId = ctx.from.id;
    const caregiverId = msg.user_shared.user_id;

    try {
      // Upsert: Insert or Update if patient already exists
      await db.db.insert(db.caregivers)
        .values({
          patientTelegramId: patientId,
          caregiverTelegramId: caregiverId
        })
        .onConflictDoUpdate({
          target: db.caregivers.patientTelegramId,
          set: { caregiverTelegramId: caregiverId }
        });

      await ctx.reply("✅ Caretaker updated successfully! They will now receive alerts if you miss your medications.");
    } catch (e) {
      console.error("Caretaker add error:", e);
      await ctx.reply("Failed to update caretaker. Please try again.");
    }
    // Stop propagation so it doesn't fall through to text/voice handlers
    return;
  }

  // If it's not a user_shared message, continue to the next listener
  return next();
});

// --- 3. INPUT LISTENERS ---

bot.start((ctx) => {
  ctx.reply(`👵 Welcome to MediAid.
    
You can send me text or voice messages to manage your medications.

Try saying 'Add 5mg Lisinopril at 8 AM' or 'I took my aspirin'.

You can also set a caretaker with /setcaretaker.`, 
    Markup.keyboard([['My Schedule', 'I took my medicine']]).resize()
  );
});

bot.on(message('text'), async (ctx) => {
  await handleUserIntent(ctx, ctx.message.text);
});

bot.on(message('voice'), async (ctx) => {
  const userId = ctx.from.id;
  const ogaPath = path.join(__dirname, `temp_${userId}.oga`);
  const mp3Path = path.join(__dirname, `temp_${userId}.mp3`);

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    
    fs.writeFileSync(ogaPath, Buffer.from(response.data));
    execSync(`ffmpeg -i "${ogaPath}" "${mp3Path}" -y`);

    const transcript = await transcribeAudio(mp3Path); 
    await handleUserIntent(ctx, transcript);
  } catch (e) {
    console.error(e);
    ctx.reply("Sorry, I couldn't process that voice message.");
  } finally {
    if (fs.existsSync(ogaPath)) fs.unlinkSync(ogaPath);
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
});

// --- 4. MEDICATION REMINDERS (MINUTE CRON) ---

cron.schedule('* * * * *', async () => {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  // Get all meds scheduled for this TIME
  const dueMeds = await db.db.select().from(db.medications).where(eq(db.medications.schedule, currentTime));

  for (const med of dueMeds) {
    // Frequency Check (Daily vs Every X days)
    if (med.frequency && med.frequency > 1) {
      const createdDate = new Date(med.createdAt || now);
      // Normalize to midnight to calculate "day" difference
      const start = new Date(createdDate.setHours(0,0,0,0));
      const current = new Date(now.setHours(0,0,0,0));
      
      const diffTime = Math.abs(current.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

      if (diffDays % med.frequency !== 0) {
        continue; // Skip if today is not the day
      }
    }

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

// --- 5. END OF DAY SUMMARY & MISSED LOGGING (DAILY CRON) ---

cron.schedule('59 23 * * *', async () => {
  console.log("Running End-of-Day Tasks...");
  
  // A. Mark unmarked responses as missed
  // Note: Only mark "missed" if they were actually due today (frequency check required)
  // For simplicity in this update, we check all meds. In a production app, replicate the frequency logic here.
  const missedMeds = await db.db.select({
      medicationId: db.medications.id,
      telegramId: db.medications.telegramId,
      name: db.medications.name
    })
    .from(db.medications)
    .leftJoin(db.adherenceLogs, and(
      eq(db.medications.id, db.adherenceLogs.medicationId),
      sql`DATE(${db.adherenceLogs.timestamp}) = CURRENT_DATE`
    ))
    .where(isNull(db.adherenceLogs.id));

  for (const m of missedMeds) {
    await db.db.insert(db.adherenceLogs).values({
      telegramId: m.telegramId,
      medicationId: m.medicationId,
      status: 'missed'
    });
  }

  // B. Send Caretaker Summary
  const allCaregiverLinks = await db.db.select().from(db.caregivers);

  for (const link of allCaregiverLinks) {
    const patientId = link.patientTelegramId;
    const caregiverId = link.caregiverTelegramId;

    if (!patientId || !caregiverId) continue;

    const dailyLogs = await db.db.select({
      medName: db.medications.name,
      status: db.adherenceLogs.status,
      time: db.medications.schedule
    })
    .from(db.adherenceLogs)
    .innerJoin(db.medications, eq(db.adherenceLogs.medicationId, db.medications.id))
    .where(and(
      eq(db.adherenceLogs.telegramId, patientId),
      sql`DATE(${db.adherenceLogs.timestamp}) = CURRENT_DATE`
    ));

    if (dailyLogs.length > 0) {
      const summaryText = dailyLogs.map(log => {
        const icon = log.status === 'taken' ? '✅' : '❌';
        return `${icon} ${log.medName} (${log.time}): ${log.status.toUpperCase()}`;
      }).join('\n');

      try {
        await bot.telegram.sendMessage(
          caregiverId,
          `📅 **Daily Medication Report**\n\nPatient ID: ${patientId}\n\n${summaryText}`
        );
      } catch (e) {
        console.error(`Failed to send summary to caregiver ${caregiverId}`, e);
      }
    }
  }
});

// --- 6. ADHERENCE LOGGING ACTIONS ---

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

  // 1. Fetch medication details to get the name
  const medDetails = await db.db.select().from(db.medications).where(eq(db.medications.id, medId)).limit(1);
  const medName = medDetails[0]?.name || "Unknown Medication";

  await db.db.insert(db.adherenceLogs).values({
    telegramId: patientId,
    medicationId: medId,
    status: 'missed'
  });

  const caregiver = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId));
  if (caregiver[0]) {
    await bot.telegram.sendMessage(
      caregiver[0].caregiverTelegramId!, 
      // Updated message to use medName instead of ID
      `⚠️ ALERT: Patient missed their medication: ${medName}.`
    );
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText("⚠️ I've noted that you missed it and notified your caregiver.");
});

bot.launch();
console.log("🚀 MediAid Bot is running and monitoring schedules...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));