import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import cron from 'node-cron';
import { parseMedCommand, transcribeAudio, checkDosageSafety, analyzePrescription } from './services/groq-client.js';
import * as db from './services/database.js';
import { eq, and, ilike, sql, isNull, lt, gte, desc, isNotNull, lte, inArray, notInArray } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import express from 'express';

// --- TIMEZONE CONFIGURATION ---
// Ensure the process uses IST for Date operations where possible, 
// though we will use explicit string formatting for critical checks.
process.env.TZ = 'Asia/Kolkata'; 

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bot = new Telegraf(process.env.BOT_TOKEN!);
const app = express();
const port = process.env.PORT || 3000;

// Temporary storage
const pendingConfirmations = new Map<number, any>();
const pendingAdditions = new Map<number, any>();

app.get('/', (req, res) => {
  res.send('MediAid Bot is running!');
});

// --- HELPER FUNCTIONS ---

function parseFrequency(freq: any): number {
    if (typeof freq === 'number') return freq;
    if (!freq) return 1;
    const s = freq.toString().toLowerCase();
    if (s.includes('daily') || s.includes('every day')) return 1;
    if (s.includes('other day') || s.includes('alternate')) return 2;
    if (s.includes('weekly')) return 7;
    const match = s.match(/(\d+)/);
    return match ? parseInt(match[0]) : 1;
}

function inferTimeFromMedName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('sleep') || lower.includes('night') || lower.includes('bed') || lower.includes('ambien') || lower.includes('melatonin')) return "22:00";
    if (lower.includes('morning') || lower.includes('thyroid') || lower.includes('vitamin')) return "08:00";
    if (lower.includes('lunch') || lower.includes('afternoon')) return "13:00";
    if (lower.includes('dinner') || lower.includes('evening')) return "19:00";
    return "09:00"; // Final fallback
}

function parseTime(t: string | null | undefined, medName: string = ""): string {
    // If the LLM successfully inferred a time (e.g. "22:00"), trust it.
    if (t && t.match(/^\d{1,2}:\d{2}$/)) {
        return t.padStart(5, '0');
    }
    // Fallback logic if LLM failed (though prompt is now stronger)
    if (!t) return "09:00"; 
    
    return inferTimeFromMedName(medName);
}

// Get current time string in IST (HH:MM)
function getISTTime(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false, 
        timeZone: 'Asia/Kolkata' 
    });
}

// ------------------------------------------

async function handleUserIntent(ctx: Context, text: string) {
  const senderId = ctx.from?.id;
  if (!senderId) return;

  let userId = senderId;
  const patientLink = await db.db.select().from(db.caregivers).where(eq(db.caregivers.caregiverTelegramId, senderId)).limit(1);
  if (patientLink.length > 0) {
     userId = patientLink[0]!.patientTelegramId;
     await ctx.reply(`(Acting on behalf of patient ID: ${userId})`);
  }

  try {
    const parsed = await parseMedCommand(text);

    switch (parsed.intent) {
      case 'add_medication': {
        const medicationName = parsed.medicationName || 'Unknown Medication';
        
        const existing = await db.db.select().from(db.medications)
          .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, medicationName)))
          .limit(1);

        if (existing.length > 0) {
          return await ctx.reply(`⚠️ You already have <b>${medicationName}</b> in your schedule.`, { parse_mode: 'HTML' });
        }

        if (parsed.dosage) {
            const safety = await checkDosageSafety(medicationName, parsed.dosage);
            if (!safety.safe) {
                pendingAdditions.set(userId, parsed);
                return await ctx.reply(
                    `🚫 <b>SAFETY WARNING</b>\n${safety.warning}\n\nDo you still want to add this?`,
                    { 
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            Markup.button.callback("✅ Yes, Add It", "confirm_unsafe_add"),
                            Markup.button.callback("❌ No, Cancel", "cancel_unsafe_add")
                        ]) 
                    }
                );
            }
        }
        await addMedicationToDb(ctx, userId, parsed);
        break;
      }

      case 'sos': {
        const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, userId)).limit(1);
        if (link.length > 0) {
            await bot.telegram.sendMessage(link[0]!.caregiverTelegramId, `🚨 <b>SOS ALERT</b>\nPatient ${userId} needs help immediately!`, { parse_mode: 'HTML' });
            await ctx.reply("🚨 <b>SOS sent to your caretaker!</b>", { parse_mode: 'HTML' });
        } else {
            await ctx.reply("⚠️ No caretaker set up.");
        }
        break;
      }

      case 'log_health': {
        if (parsed.healthType && parsed.healthValue) {
            await db.db.insert(db.healthLogs).values({
                telegramId: userId,
                type: parsed.healthType,
                value: parsed.healthValue
            });
            await ctx.reply(`✅ Logged <b>${parsed.healthType}</b>: ${parsed.healthValue}`, { parse_mode: 'HTML' });
        } else {
            await ctx.reply("Please specify the value (e.g., 'BP is 120/80')");
        }
        break;
      }

      case 'add_appointment': {
        if (parsed.appointmentTitle) {
            let dateObj: Date;

            // Handle cases where only time is provided (e.g., "7:14pm")
            if (parsed.appointmentDate && parsed.appointmentDate.match(/^\d{1,2}:\d{2}/)) {
                const now = new Date();
                // Create a date string for Today + Time
                const timeStr = parsed.appointmentDate; // Expecting HH:MM or similar
                const dateTimeStr = `${now.toDateString()} ${timeStr}`;
                dateObj = new Date(dateTimeStr);
                
                // If that time has passed today, assume tomorrow
                if (dateObj < now) {
                    dateObj.setDate(dateObj.getDate() + 1);
                }
            } else if (parsed.appointmentDate) {
                dateObj = new Date(parsed.appointmentDate);
            } else {
                // Fallback if no date/time found
                return await ctx.reply("Please specify a date or time for the appointment.");
            }

            if (isNaN(dateObj.getTime())) {
                return await ctx.reply("I understood the appointment title, but the date/time format was unclear.");
            }

            await db.db.insert(db.appointments).values({
                telegramId: userId,
                title: parsed.appointmentTitle,
                date: dateObj
            });
            await ctx.reply(`🗓️ Appointment set: <b>${parsed.appointmentTitle}</b> on ${dateObj.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })}`, { parse_mode: 'HTML' });
        } else {
            await ctx.reply("I need a title for the appointment (e.g., 'Dentist at 5pm').");
        }
        break;
      }

      case 'update_appointment': {        
        if (!parsed.appointmentTitle) return await ctx.reply("Which appointment do you want to update?");

        const updateData: any = {};
        if (parsed.appointmentDate) updateData.date = new Date(parsed.appointmentDate);
        // If user provided a new title, use it, otherwise keep old
        // This logic depends heavily on how the LLM parses "Change X to Y". 
        
        // Simple implementation: Update based on fuzzy title match
        const updatedAppt = await db.db.update(db.appointments)
            .set(updateData)
            .where(and(eq(db.appointments.telegramId, userId), ilike(db.appointments.title, `%${parsed.appointmentTitle}%`)))
            .returning();

        if (updatedAppt.length > 0) await ctx.reply(`✅ Updated appointment: <b>${updatedAppt[0]!.title}</b>`, { parse_mode: 'HTML' });
        else await ctx.reply(`⚠️ Couldn't find an appointment matching "${parsed.appointmentTitle}".`);
        break;
      }

      case 'remove_appointment': {
          if (!parsed.appointmentTitle) return await ctx.reply("Which appointment should I cancel?");

          const deletedAppt = await db.db.delete(db.appointments)
              .where(and(eq(db.appointments.telegramId, userId), ilike(db.appointments.title, `%${parsed.appointmentTitle}%`)))
              .returning();

          if (deletedAppt.length > 0) await ctx.reply(`🗑️ Cancelled appointment: <b>${deletedAppt[0]!.title}</b>`, { parse_mode: 'HTML' });
          else await ctx.reply(`⚠️ Couldn't find an appointment matching "${parsed.appointmentTitle}".`);
          break;
      }

      case 'update_medication': {
        if (!parsed.medicationName) return await ctx.reply("Please specify the medication name.");

        const updateData: any = {};
        if (parsed.dosage) updateData.dosage = parsed.dosage;
        if (parsed.time) updateData.schedule = parseTime(parsed.time);
        if (parsed.frequencyDays) updateData.frequency = parsed.frequencyDays;

        const updated = await db.db.update(db.medications)
          .set(updateData)
          .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)))
          .returning();

        if (updated.length > 0) await ctx.reply(`Hz Updated <b>${parsed.medicationName}</b> successfully.`, { parse_mode: 'HTML' });
        else await ctx.reply(`⚠️ Couldn't find "${parsed.medicationName}".`);
        break;
      }
      
      case 'remove_medication':
        if (parsed.medicationName) {
            const medskq = await db.db.select().from(db.medications)
                .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)));

            if (medskq.length > 0) {
                const medIds = medskq.map(m => m.id);
                await db.db.delete(db.adherenceLogs).where(inArray(db.adherenceLogs.medicationId, medIds));
                await db.db.delete(db.medications).where(inArray(db.medications.id, medIds));
                await ctx.reply(`🗑️ Removed <b>${parsed.medicationName}</b>.`, { parse_mode: 'HTML' });
            } else {
                await ctx.reply(`⚠️ Could not find "${parsed.medicationName}".`);
            }
        }
        break;

      case 'log_intake':
        let medId: number | null = null;
        if (parsed.medicationName) {
            const existing = await db.db.select().from(db.medications)
                .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)))
                .limit(1);
            if (existing.length > 0) medId = existing[0]!.id;
        }
        await db.db.insert(db.adherenceLogs).values({ telegramId: userId, status: 'taken', medicationId: medId });
        await ctx.reply(`✅ Logged intake: <b>${parsed.medicationName || 'Medicine'}</b>`, { parse_mode: 'HTML' });
        break;

      case 'query_health':
        const logs = await db.db.select().from(db.healthLogs)
            .where(eq(db.healthLogs.telegramId, userId))
            .orderBy(desc(db.healthLogs.timestamp))
            .limit(5);
        
        if (logs.length === 0) await ctx.reply("No health logs found.");
        else {
            const msg = logs.map(l => `❤️ <b>${l.type}</b>: ${l.value} <i>(${l.timestamp?.toLocaleDateString()})</i>`).join('\n');
            await ctx.reply(`🏥 <b>Recent Health Logs</b>\n\n${msg}`, { parse_mode: 'HTML' });
        }
        break;

      case 'query_schedule':
        const meds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
        const appts = await db.db.select().from(db.appointments)
            .where(and(eq(db.appointments.telegramId, userId), gte(db.appointments.date, new Date())))
            .orderBy(db.appointments.date);

        let msg = "";
        if (meds.length > 0) {
          msg += "💊 <b>Medication Schedule</b>\n";
          msg += meds.map(m => {
              const freq = m.frequency === 1 ? "Daily" : `Every ${m.frequency} days`;
              
              // --- NEW LOGIC: REMAINING TIME ---
              let remainingText = "";
              if (m.endDate) {
                  const now = new Date();
                  const diffTime = m.endDate.getTime() - now.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  
                  if (diffDays > 0) {
                      remainingText = ` | ⏳ ${diffDays} days left`;
                  } else {
                      remainingText = ` | ⚠️ Course ended`;
                  }
              }
              // ---------------------------------

              return `• <b>${m.name}</b> (${m.dosage})\n  🕒 ${m.schedule} | 🔄 ${freq}${remainingText}`;
          }).join('\n\n');
        } else {
            msg += "💊 No medications scheduled.\n";
        }

        if (appts.length > 0) {
            msg += "\n\n🗓️ <b>Upcoming Appointments</b>\n";
            msg += appts.map(a => `• <b>${a.title}</b>\n  🕒 ${a.date.toLocaleDateString()} at ${a.date.toLocaleTimeString()}`).join('\n');
        }

        await ctx.reply(msg, { parse_mode: 'HTML' });
        break;

      case 'query_appointments':
        const myAppts = await db.db.select().from(db.appointments)
            .where(and(eq(db.appointments.telegramId, userId), gte(db.appointments.date, new Date())))
            .orderBy(db.appointments.date);
            
        if (myAppts.length === 0) await ctx.reply("No upcoming appointments.");
        else {
            const list = myAppts.map(a => `• <b>${a.title}</b> on ${a.date.toLocaleDateString()}`).join('\n');
            await ctx.reply(`🗓️ <b>Upcoming Appointments</b>\n\n${list}`, { parse_mode: 'HTML' });
        }
        break;

      // NEW FEATURE: Query Missed Meds
      case 'query_missed':
        const currentISTTime = getISTTime();
        const todayMeds = await db.db.select().from(db.medications)
            .where(and(
                eq(db.medications.telegramId, userId),
                lte(db.medications.schedule, currentISTTime) // Scheduled before now
            ));

        // Get logs for TODAY only
        const todayLogs = await db.db.execute(sql`
            SELECT medication_id FROM adherence_logs 
            WHERE telegram_id = ${userId} 
            AND status = 'taken' 
            AND DATE(timestamp AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE
        `);
        
        const takenIds = todayLogs.rows.map((r: any) => r.medication_id);
        const missedMedsList = todayMeds.filter(m => !takenIds.includes(m.id));

        if (missedMedsList.length === 0) {
            await ctx.reply("✅ <b>Good job!</b> You haven't missed any medications so far today.", { parse_mode: 'HTML' });
        } else {
            const missedText = missedMedsList.map(m => `• <b>${m.name}</b> (Scheduled: ${m.schedule})`).join('\n');
            await ctx.reply(`⚠️ <b>Missed Medications Today:</b>\n\n${missedText}`, { parse_mode: 'HTML' });
        }
        break;
      
      case 'general_conversation':
        if (parsed.response) await ctx.reply(parsed.response);
        else await ctx.reply("How can I help with your meds today?");
        break;

      default:
        await ctx.reply("I didn't quite catch that. Try saying 'Add Aspirin at 9am'.");
    }
  } catch (error) {
    console.error(error);
    await ctx.reply("Something went wrong. Please try again.");
  }
}

async function addMedicationToDb(ctx: Context, userId: number, parsed: any) {
    let endDate = null;
    if (parsed.durationDays) {
        const d = new Date();
        d.setDate(d.getDate() + parsed.durationDays);
        endDate = d;
    }
    const freq = parseFrequency(parsed.frequencyDays);
    const time = parseTime(parsed.time, parsed.medicationName || "");

    await db.db.insert(db.medications).values({
        telegramId: userId,
        name: parsed.medicationName || 'Unknown',
        dosage: parsed.dosage || 'As prescribed',
        schedule: time,
        frequency: freq,
        endDate: endDate
    });
    
    await ctx.reply(`✅ Added <b>${parsed.medicationName}</b>\n🕒 Time: ${time}\n🔄 Freq: ${freq === 1 ? 'Daily' : 'Every ' + freq + ' days'}`, { parse_mode: 'HTML' });
}

// --- Safety Confirmation Actions ---

bot.action("confirm_unsafe_add", async (ctx) => {
    const userId = ctx.from!.id;
    // Handle caretaker masquerading
    let targetId = userId;
    const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.caregiverTelegramId, userId)).limit(1);
    if(link.length > 0) targetId = link[0]!.patientTelegramId;

    const parsed = pendingAdditions.get(targetId);
    
    if (parsed) {
        await addMedicationToDb(ctx, targetId, parsed);
        pendingAdditions.delete(targetId);
        await ctx.editMessageText(`✅ Warning acknowledged. Medication added.`);
    } else {
        await ctx.editMessageText("⚠️ Session expired. Please try adding the medication again.");
    }
});

bot.action("cancel_unsafe_add", async (ctx) => {
    const userId = ctx.from!.id;
    let targetId = userId;
    const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.caregiverTelegramId, userId)).limit(1);
    if(link.length > 0) targetId = link[0]!.patientTelegramId;

    pendingAdditions.delete(targetId);
    await ctx.editMessageText("❌ Medication addition cancelled.");
});

// --- Image Handling ---

bot.on(message('photo'), async (ctx) => {
    const photo = ctx.message.photo.pop();
    if (!photo) return;
    
    await ctx.reply("🔍 Scanning prescription... please wait.");
    
    try {
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        const analysis = await analyzePrescription(buffer);

        if (!analysis.isLegit) {
            return await ctx.reply("⚠️ This does not look like a valid prescription. Please upload a clear photo.");
        }

        let confirmMsg = "I found the following details. Is this correct?\n";
        // Clean up the display message with parsed values so user sees what will actually be saved
        analysis.medications.forEach((m: any, i: number) => {
            const time = parseTime(m.time);
            confirmMsg += `\n${i+1}. ${m.name} - ${m.dosage} at ${time}`;
        });

        pendingConfirmations.set(ctx.from.id, analysis.medications);

        await ctx.reply(confirmMsg, Markup.inlineKeyboard([
            Markup.button.callback("✅ Yes, Add All", "confirm_prescription"),
            Markup.button.callback("❌ No, Cancel", "cancel_prescription")
        ]));

    } catch (e) {
        console.error(e);
        await ctx.reply("Error processing image.");
    }
});

// --- FIX APPLIED HERE: SANITIZING DATA BEFORE DB INSERT ---
bot.action("confirm_prescription", async (ctx) => {
    const meds = pendingConfirmations.get(ctx.from.id);
    if (meds) {
        for (const m of meds) {
            // Convert "Daily" -> 1, "Morning" -> "09:00"
            const freq = parseFrequency(m.frequency);
            const time = parseTime(m.time);

            await db.db.insert(db.medications).values({
                telegramId: ctx.from.id,
                name: m.name,
                dosage: m.dosage,
                schedule: time,
                frequency: freq
            });
        }
        pendingConfirmations.delete(ctx.from.id);
        await ctx.editMessageText("✅ All medications added to your schedule.");
    } else {
        await ctx.editMessageText("⚠️ Session expired. Please upload again.");
    }
});

bot.action("cancel_prescription", async (ctx) => {
    pendingConfirmations.delete(ctx.from.id);
    await ctx.editMessageText("❌ Prescription scan cancelled.");
});

// --- Caretaker Setup ---

bot.command('setcaretaker', (ctx) => {
  ctx.reply("To add a caretaker, please click the button below and select them from your chat list:",
    Markup.keyboard([
      Markup.button.userRequest("👤 Select Caretaker", 1)
    ]).resize().oneTime()
  );
});

bot.command('becomecaretaker', (ctx) => {
    ctx.reply("To become a caretaker, please share the **Patient's Contact**:", 
        Markup.keyboard([
            Markup.button.userRequest("👤 Share Patient Contact", 2) // ID 2 for differentiation
        ]).resize().oneTime()
    );
});

bot.on('message', async (ctx, next) => {
    const msg = ctx.message as any;
    
    // Check if this is the "Become Caretaker" flow (request_id 2)
    if (msg.user_shared && msg.user_shared.request_id === 2) {
        const caretakerId = ctx.from.id;
        const patientId = msg.user_shared.user_id;

        // Send request to Patient
        try {
            await bot.telegram.sendMessage(patientId, 
                `👤 User ${ctx.from.first_name} wants to be your Caretaker.\nDo you accept?`,
                Markup.inlineKeyboard([
                    Markup.button.callback("✅ Accept", `accept_care_${caretakerId}`),
                    Markup.button.callback("❌ Deny", `deny_care`)
                ])
            );
            await ctx.reply("✅ Request sent to patient. Waiting for approval.");
        } catch (e) {
            await ctx.reply("⚠️ Could not reach patient. They must start this bot first.");
        }
        return;
    }
    return next();
});

// --- Standard Inputs ---

bot.start((ctx) => {
  ctx.reply(`👵 Welcome to MediAid.\nTry saying 'Add 5mg Lisinopril at 8 AM' or 'I took my aspirin'.`, 
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
    ctx.reply("Sorry, I couldn't process that voice message.");
  } finally {
    if (fs.existsSync(ogaPath)) fs.unlinkSync(ogaPath);
    if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
  }
});

// --- CRON JOBS ---

// 1. Weekly Report (Sunday 9 AM)
cron.schedule('0 9 * * 0', async () => {
    console.log("Generating Weekly Reports...");
    
    // Get date 7 days ago
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Fetch all active patients
    const patients = await db.db.selectDistinct({ id: db.medications.telegramId }).from(db.medications);

    for (const p of patients) {
        const userId = p.id;

        // A. Adherence Stats
        const logs = await db.db.select()
            .from(db.adherenceLogs)
            .where(and(
                eq(db.adherenceLogs.telegramId, userId),
                gte(db.adherenceLogs.timestamp, weekAgo)
            ));

        const taken = logs.filter(l => l.status === 'taken').length;
        const missed = logs.filter(l => l.status === 'missed').length;
        const total = taken + missed;
        const percentage = total > 0 ? Math.round((taken / total) * 100) : 0;

        // B. Health Logs
        const health = await db.db.select()
            .from(db.healthLogs)
            .where(and(
                eq(db.healthLogs.telegramId, userId),
                gte(db.healthLogs.timestamp, weekAgo)
            ))
            .orderBy(desc(db.healthLogs.timestamp));

        let healthMsg = "";
        if (health.length > 0) {
            healthMsg = "\n\n🏥 **Health Vitals (Last 7 Days):**\n" + 
                health.map(h => `• ${h.type}: ${h.value} (${h.timestamp?.toLocaleDateString()})`).join('\n');
        }

        const report = `📊 **Weekly Health Report**\n\n` +
            `💊 **Medication Adherence:**\n` +
            `• Taken: ${taken}\n• Missed: ${missed}\n• Score: ${percentage}%` +
            healthMsg;

        // Send to Patient
        try {
            await bot.telegram.sendMessage(userId, report);
        } catch (e) { console.error(`Failed to send report to patient ${userId}`); }

        // Send to Caretaker
        const caretakerLink = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, userId)).limit(1);
        if (caretakerLink.length > 0) {
            try {
                await bot.telegram.sendMessage(
                    caretakerLink[0]!.caregiverTelegramId, 
                    `📑 **Patient Report (ID: ${userId})**\n${report}`
                );
            } catch (e) { console.error(`Failed to send report to caretaker`); }
        }
    }
});

cron.schedule('* * * * *', async () => {
    const now = new Date();
    // Force IST time string
    const currentTime = now.toLocaleTimeString('en-GB', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false, 
        timeZone: 'Asia/Kolkata' 
    });

    // 1. Regular Schedule Check
    const dueMeds = await db.db.select().from(db.medications).where(eq(db.medications.schedule, currentTime));
    
    // 2. Snooze Check (Simple comparison assumes server time for snoozing, which is okay for relative delays)
    const snoozedMeds = await db.db.select().from(db.medications)
        .where(and(isNotNull(db.medications.snoozedUntil), lte(db.medications.snoozedUntil, now)));

    const allDue = [...dueMeds, ...snoozedMeds];

    for (const med of allDue) {
        if (med.snoozedUntil) {
            await db.db.update(db.medications).set({ snoozedUntil: null }).where(eq(db.medications.id, med.id));
        }
        
        await bot.telegram.sendMessage(
            med.telegramId, 
            `⏰ <b>It's time for your medication!</b>\n\nTake: <b>${med.name}</b> (${med.dosage})`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Taken", `taken_${med.id}`)],
                    [Markup.button.callback("❌ Skip", `missed_${med.id}`)],
                    [Markup.button.callback("💤 Snooze 10m", `snooze_${med.id}`)]
                ])
            }
        );
    }
});

// 3. Appointment Reminders (Hourly)
cron.schedule('0 * * * *', async () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const upcoming = await db.db.select().from(db.appointments)
        .where(and(
            lt(db.appointments.date, tomorrow),
            gte(db.appointments.date, now),
            eq(db.appointments.reminded, false)
        ));

    for (const appt of upcoming) {
        await bot.telegram.sendMessage(appt.telegramId, `mn🗓️ REMINDER: Appointment '${appt.title}' is coming up on ${appt.date}`);
        await db.db.update(db.appointments).set({ reminded: true }).where(eq(db.appointments.id, appt.id));
    }
});

// 4. Daily Cleanup (Midnight)
cron.schedule('59 23 * * *', async () => {
    const missedMeds = await db.db.select({
        id: db.medications.id,
        telegramId: db.medications.telegramId,
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
            medicationId: m.id,
            status: 'missed'
        });
    }

    await db.db.delete(db.medications).where(lt(db.medications.endDate, new Date()));
});

// --- Action Listeners ---

bot.action(/taken_(.+)/, async (ctx) => {
    const medId = parseInt(ctx.match[1]!);
    await db.db.insert(db.adherenceLogs).values({ telegramId: ctx.from!.id, medicationId: medId, status: 'taken' });
    await ctx.answerCbQuery();
    
    // Feature 7: Show SOS button after taking medicine
    await ctx.editMessageText(`✅ Intake logged.`, 
        Markup.inlineKeyboard([
            Markup.button.callback("🆘 Send SOS (Call Caretaker)", "sos_trigger")
        ])
    );
});

bot.action("sos_trigger", async (ctx) => {
    // Re-use existing SOS logic
    await handleUserIntent(ctx, "sos"); 
});

bot.action(/missed_(.+)/, async (ctx) => {
  const medId = parseInt(ctx.match[1]!);
  const patientId = ctx.from!.id;
  const med = await db.db.select().from(db.medications).where(eq(db.medications.id, medId)).limit(1);
  const medName = med[0]?.name || "Unknown";

  await db.db.insert(db.adherenceLogs).values({ telegramId: patientId, medicationId: medId, status: 'missed' });

  const link = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId)).limit(1);
  if (link.length > 0) {
    await bot.telegram.sendMessage(link[0]!.caregiverTelegramId, `⚠️ ALERT: Patient missed ${medName}.`);
  }
  await ctx.editMessageText("⚠️ Missed logged. Caretaker notified.");
});

bot.action(/snooze_(.+)/, async (ctx) => {
    const medId = parseInt(ctx.match[1] as string);
    const snoozeTime = new Date(Date.now() + 10 * 60 * 1000); // 10 mins from now

    await db.db.update(db.medications)
        .set({ snoozedUntil: snoozeTime })
        .where(eq(db.medications.id, medId));

    await ctx.answerCbQuery("Snoozed 10m");
    await ctx.editMessageText("💤 Snoozed. I'll remind you in 10 minutes.");
});

bot.action(/accept_care_(.+)/, async (ctx) => {
    const caretakerId = parseInt(ctx.match[1]!);
    const patientId = ctx.from.id;

    await db.db.insert(db.caregivers)
        .values({ patientTelegramId: patientId, caregiverTelegramId: caretakerId })
        .onConflictDoUpdate({ target: db.caregivers.patientTelegramId, set: { caregiverTelegramId: caretakerId } });

    await ctx.editMessageText("✅ Caretaker accepted!");
    await bot.telegram.sendMessage(caretakerId, "✅ You are now the caretaker.");
});

bot.launch();
console.log("🚀 MediAid Bot is running...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

app.listen(port, () => console.log(`Web server on port ${port}`));