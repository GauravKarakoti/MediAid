import { Markup } from 'telegraf';
import * as db from '../services/database.js';
import {
  parseMedCommand,
  checkDosageSafety,
  getHealthAwareResponse,
} from '../services/groq-client.js';
import {
  eq,
  and,
  ilike,
  sql,
  gte,
  lte,
  desc,
  inArray,
} from 'drizzle-orm';

export type Platform = 'telegram' | 'whatsapp';

export type ReplyFn = (text: string, options?: any) => Promise<any>;

export interface IntentContext {
  userId: number;
  platform: Platform;
  reply: ReplyFn;
  sendSOS?: (patientId: number) => Promise<void>;
  getPendingUnsafe?: (userId: number) => any | undefined;
  setPendingUnsafe?: (userId: number, parsed: any) => void;
  clearPendingUnsafe?: (userId: number) => void;
  getPendingPrescription?: (userId: number) => any | undefined;
  setPendingPrescription?: (userId: number, meds: any[]) => void;
  clearPendingPrescription?: (userId: number) => void;
}

export function parseFrequency(freq: any): number {
  if (typeof freq === 'number') return freq;
  if (!freq) return 1;
  const s = freq.toString().toLowerCase();
  if (s.includes('daily') || s.includes('every day')) return 1;
  if (s.includes('other day') || s.includes('alternate')) return 2;
  if (s.includes('weekly')) return 7;
  const match = s.match(/(\d+)/);
  return match ? parseInt(match[0], 10) : 1;
}

export function inferTimeFromMedName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('sleep') || lower.includes('night') || lower.includes('bed') || lower.includes('ambien') || lower.includes('melatonin')) return '22:00';
  if (lower.includes('morning') || lower.includes('thyroid') || lower.includes('vitamin')) return '08:00';
  if (lower.includes('lunch') || lower.includes('afternoon')) return '13:00';
  if (lower.includes('dinner') || lower.includes('evening')) return '19:00';
  return '09:00';
}

export function parseTime(t: string | null | undefined, medName = ''): string {
  if (!t) return inferTimeFromMedName(medName);

  const timeMatch = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1] as string, 10);
    const minutes = timeMatch[2];
    const ampm = timeMatch[3]?.toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, '0')}:${minutes}`;
  }

  return inferTimeFromMedName(medName);
}

export function getISTTime(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  });
}

export async function sendAlarmSetupInstructions(reply: ReplyFn) {
  const instruction =
    `🔔 Custom Alarm Setup\n\n` +
    `1. Download the audio file above.\n` +
    `2. Set it as your notification tone.\n` +
    `3. Keep notifications on for this bot.\n\n` +
    `This helps you hear reminders even on vibrate.`;

  await reply(instruction);
}

export async function addMedicationToDb(
  userId: number,
  parsed: any,
  reply: ReplyFn
) {
  let endDate: Date | null = null;
  if (parsed.durationDays) {
    const d = new Date();
    d.setDate(d.getDate() + parsed.durationDays);
    endDate = d;
  }

  const freq = parseFrequency(parsed.frequencyDays);
  const time = parseTime(parsed.time, parsed.medicationName || '');

  await db.db.insert(db.medications).values({
    telegramId: userId,
    name: parsed.medicationName || 'Unknown',
    dosage: parsed.dosage || 'As prescribed',
    schedule: time,
    frequency: freq,
    endDate,
    notes: parsed.notes || null,
    allowSnooze: parsed.allowSnooze ?? true,
  });

  let confirmMsg = `✅ Added <b>${parsed.medicationName}</b> at ${time}.`;
  if (parsed.notes) confirmMsg += `\n📝 Note: ${parsed.notes}`;
  await reply(confirmMsg, { parse_mode: 'HTML' });
}

async function resolveCaretakerUserId(userId: number): Promise<number> {
  const patientLink = await db.db
    .select()
    .from(db.caregivers)
    .where(eq(db.caregivers.caregiverTelegramId, userId))
    .limit(1);

  return patientLink.length > 0 ? patientLink[0]!.patientTelegramId : userId;
}

export async function handleUserIntent(ctx: IntentContext, text: string, command?: any) {
  const userId = await resolveCaretakerUserId(ctx.userId);

  try {
    const parsed = command || (await parseMedCommand(text));

    switch (parsed.intent) {
      case 'add_medication': {
        const medicationName = parsed.medicationName || 'Unknown Medication';

        const existing = await db.db
          .select()
          .from(db.medications)
          .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, medicationName)))
          .limit(1);

        if (existing.length > 0) {
          return await ctx.reply(`⚠️ You already have <b>${medicationName}</b> in your schedule.`, {
            parse_mode: 'HTML',
          });
        }

        if (parsed.dosage) {
          const safety = await checkDosageSafety(medicationName, parsed.dosage);
          if (!safety.safe) {
            if (ctx.platform === 'telegram') {
              ctx.setPendingUnsafe?.(userId, parsed);
              return await ctx.reply(
                `🚫 <b>SAFETY WARNING</b>\n${safety.warning}\n\nDo you still want to add this?`,
                {
                  parse_mode: 'HTML',
                  ...Markup.inlineKeyboard([
                    Markup.button.callback('✅ Yes, Add It', 'confirm_unsafe_add'),
                    Markup.button.callback('❌ No, Cancel', 'cancel_unsafe_add'),
                  ]),
                }
              );
            }

            ctx.setPendingUnsafe?.(userId, parsed);
            return await ctx.reply(
              `🚫 SAFETY WARNING\n${safety.warning}\n\nReply YES to add anyway or CANCEL to stop.`
            );
          }
        }

        await addMedicationToDb(userId, parsed, ctx.reply);
        break;
      }

      case 'sos': {
        const link = await db.db
          .select()
          .from(db.caregivers)
          .where(eq(db.caregivers.patientTelegramId, userId))
          .limit(1);

        if (link.length > 0) {
          await ctx.sendSOS?.(userId);
          await ctx.reply('🚨 SOS sent to your caretaker!');
        } else {
          await ctx.reply('⚠️ No caretaker set up.');
        }
        break;
      }

      case 'log_health': {
        if (parsed.healthType && parsed.healthValue) {
          await db.db.insert(db.healthLogs).values({
            telegramId: userId,
            type: parsed.healthType,
            value: parsed.healthValue,
          });
          await ctx.reply(`✅ Logged <b>${parsed.healthType}</b>: ${parsed.healthValue}`, {
            parse_mode: 'HTML',
          });
        } else {
          await ctx.reply("Please specify the value, e.g. 'BP is 120/80'");
        }
        break;
      }

      case 'add_appointment': {
        if (!parsed.appointmentTitle) {
          await ctx.reply("I need a title for the appointment, e.g. 'Dentist at 5pm'.");
          break;
        }

        const now = new Date();
        const dateStr = parsed.appointmentDate || '';
        let dateObj: Date;

        if (dateStr.match(/^\d{1,2}:\d{2}/) || /am|pm/i.test(dateStr)) {
          const datePart = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          dateObj = new Date(`${datePart} ${dateStr} GMT+0530`);
          if (dateObj < now) dateObj.setDate(dateObj.getDate() + 1);
        } else if (dateStr.includes(' ') || dateStr.includes('T')) {
          const tzSafeStr = /[Z+-]/.test(dateStr) ? dateStr : `${dateStr} GMT+0530`;
          dateObj = new Date(tzSafeStr);
        } else if (dateStr) {
          dateObj = new Date(`${dateStr} 00:00:00 GMT+0530`);
        } else {
          await ctx.reply('Please specify a date or time for the appointment.');
          break;
        }

        if (isNaN(dateObj.getTime())) {
          await ctx.reply('I understood the appointment title, but the date/time format was unclear.');
          break;
        }

        await db.db.insert(db.appointments).values({
          telegramId: userId,
          title: parsed.appointmentTitle,
          date: dateObj,
        });

        await ctx.reply(
          `🗓️ Appointment set: <b>${parsed.appointmentTitle}</b> on ${dateObj.toLocaleString('en-GB', {
            timeZone: 'Asia/Kolkata',
          })}`,
          { parse_mode: 'HTML' }
        );
        break;
      }

      case 'update_appointment': {
        if (!parsed.appointmentTitle) {
          await ctx.reply('Which appointment do you want to update?');
          break;
        }

        const updateData: any = {};
        if (parsed.appointmentDate) updateData.date = new Date(parsed.appointmentDate);

        if (Object.keys(updateData).length === 0) {
          await ctx.reply('I understood the appointment, but I did not get complete update details.');
          break;
        }

        const updatedAppt = await db.db
          .update(db.appointments)
          .set(updateData)
          .where(and(eq(db.appointments.telegramId, userId), ilike(db.appointments.title, `%${parsed.appointmentTitle}%`)))
          .returning();

        if (updatedAppt.length > 0) {
          await ctx.reply(`✅ Updated appointment: <b>${updatedAppt[0]!.title}</b>`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(`⚠️ Couldn't find an appointment matching "${parsed.appointmentTitle}".`);
        }
        break;
      }

      case 'remove_appointment': {
        if (!parsed.appointmentTitle) {
          await ctx.reply('Which appointment should I cancel?');
          break;
        }

        const deletedAppt = await db.db
          .delete(db.appointments)
          .where(and(eq(db.appointments.telegramId, userId), ilike(db.appointments.title, `%${parsed.appointmentTitle}%`)))
          .returning();

        if (deletedAppt.length > 0) {
          await ctx.reply(`🗑️ Cancelled appointment: <b>${deletedAppt[0]!.title}</b>`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(`⚠️ Couldn't find an appointment matching "${parsed.appointmentTitle}".`);
        }
        break;
      }

      case 'update_medication': {
        if (!parsed.medicationName) {
          await ctx.reply('Please specify the medication name.');
          break;
        }

        const updateData: any = {};
        if (parsed.dosage) updateData.dosage = parsed.dosage;
        if (parsed.time) updateData.schedule = parseTime(parsed.time);
        if (parsed.frequencyDays) updateData.frequency = parsed.frequencyDays;

        const updated = await db.db
          .update(db.medications)
          .set(updateData)
          .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)))
          .returning();

        if (updated.length > 0) {
          await ctx.reply(`Updated <b>${parsed.medicationName}</b> successfully.`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(`⚠️ Couldn't find "${parsed.medicationName}".`);
        }
        break;
      }

      case 'remove_medication': {
        if (!parsed.medicationName) break;

        const meds = await db.db
          .select()
          .from(db.medications)
          .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)));

        if (meds.length > 0) {
          const medIds = meds.map((m) => m.id);
          await db.db.delete(db.adherenceLogs).where(inArray(db.adherenceLogs.medicationId, medIds));
          await db.db.delete(db.medications).where(inArray(db.medications.id, medIds));
          await ctx.reply(`🗑️ Removed <b>${parsed.medicationName}</b>.`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(`⚠️ Could not find "${parsed.medicationName}".`);
        }
        break;
      }

      case 'log_intake': {
        let medId: number | null = null;
        let loggedName = parsed.medicationName || 'Medicine';

        if (parsed.medicationName) {
          let existing = await db.db
            .select()
            .from(db.medications)
            .where(and(eq(db.medications.telegramId, userId), ilike(db.medications.name, `%${parsed.medicationName}%`)))
            .limit(1);

          if (existing.length === 0) {
            const allMeds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
            const match = allMeds.find((m) => parsed.medicationName!.toLowerCase().includes(m.name.toLowerCase()));
            if (match) existing = [match];
          }

          if (existing.length > 0) {
            medId = existing[0]!.id;
            loggedName = existing[0]!.name;
          }
        }

        await db.db.insert(db.adherenceLogs).values({
          telegramId: userId,
          status: 'taken',
          medicationId: medId,
        });

        if (medId) {
          await ctx.reply(`✅ Logged intake: <b>${loggedName}</b>`, { parse_mode: 'HTML' });
        } else {
          await ctx.reply(
            `✅ Logged intake for <b>${parsed.medicationName}</b>, but I could not match it to your schedule.`,
            { parse_mode: 'HTML' }
          );
        }
        break;
      }

      case 'query_health': {
        const logs = await db.db
          .select()
          .from(db.healthLogs)
          .where(eq(db.healthLogs.telegramId, userId))
          .orderBy(desc(db.healthLogs.timestamp))
          .limit(5);

        if (logs.length === 0) {
          await ctx.reply('No health logs found.');
        } else {
          const msg = logs
            .map((l) => `❤️ <b>${l.type}</b>: ${l.value} <i>(${l.timestamp?.toLocaleDateString()})</i>`)
            .join('\n');
          await ctx.reply(`🏥 <b>Recent Health Logs</b>\n\n${msg}`, { parse_mode: 'HTML' });
        }
        break;
      }

      case 'query_schedule': {
        const meds = await db.db.select().from(db.medications).where(eq(db.medications.telegramId, userId));
        const appts = await db.db
          .select()
          .from(db.appointments)
          .where(and(eq(db.appointments.telegramId, userId), gte(db.appointments.date, new Date())))
          .orderBy(db.appointments.date);

        let msg = '';

        if (meds.length > 0) {
          msg += '💊 <b>Medication Schedule</b>\n';
          msg += meds
            .map((m) => {
              const freq = m.frequency === 1 ? 'Daily' : `Every ${m.frequency} days`;
              let remainingText = '';

              if (m.endDate) {
                const now = new Date();
                const diffTime = m.endDate.getTime() - now.getTime();
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                remainingText = diffDays > 0 ? ` | ⏳ ${diffDays} days left` : ` | ⚠️ Course ended`;
              }

              return `• <b>${m.name}</b> (${m.dosage})\n  🕒 ${m.schedule} | 🔄 ${freq}${remainingText}`;
            })
            .join('\n\n');
        } else {
          msg += '💊 No medications scheduled.\n';
        }

        if (appts.length > 0) {
          msg += '\n\n🗓️ <b>Upcoming Appointments</b>\n';
          msg += appts
            .map((a) => `• <b>${a.title}</b>\n  🕒 ${a.date.toLocaleDateString()} at ${a.date.toLocaleTimeString()}`)
            .join('\n');
        }

        await ctx.reply(msg, { parse_mode: 'HTML' });
        break;
      }

      case 'query_appointments': {
        const myAppts = await db.db
          .select()
          .from(db.appointments)
          .where(and(eq(db.appointments.telegramId, userId), gte(db.appointments.date, new Date())))
          .orderBy(db.appointments.date);

        if (myAppts.length === 0) {
          await ctx.reply('No upcoming appointments.');
        } else {
          const list = myAppts
            .map((a) => `• <b>${a.title}</b> on ${a.date.toLocaleDateString()} ${a.date.toLocaleTimeString()}`)
            .join('\n');
          await ctx.reply(`🗓️ <b>Upcoming Appointments</b>\n\n${list}`, { parse_mode: 'HTML' });
        }
        break;
      }

      case 'query_missed': {
        const currentISTTime = getISTTime();

        const todayMeds = await db.db
          .select()
          .from(db.medications)
          .where(and(eq(db.medications.telegramId, userId), lte(db.medications.schedule, currentISTTime)));

        const todayLogs = await db.db.execute(sql`
          SELECT medication_id FROM adherence_logs
          WHERE telegram_id = ${userId}
          AND status = 'taken'
          AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata')
        `);

        const takenIds = todayLogs.rows.map((r: any) => r.medication_id);
        const missedMedsList = todayMeds.filter((m) => !takenIds.includes(m.id));

        if (missedMedsList.length === 0) {
          await ctx.reply("✅ <b>Good job!</b> You haven't missed any medications so far today.", {
            parse_mode: 'HTML',
          });
        } else {
          const missedText = missedMedsList.map((m) => `• <b>${m.name}</b> (Scheduled: ${m.schedule})`).join('\n');
          await ctx.reply(`⚠️ <b>Missed Medications Today:</b>\n\n${missedText}`, { parse_mode: 'HTML' });
        }
        break;
      }

      case 'general_conversation': {
        if (parsed.response) {
          await ctx.reply(parsed.response);
        } else {
          await ctx.reply('How can I help with your meds today?');
        }
        break;
      }

      default:
        await ctx.reply("I didn't quite catch that. Try saying 'Add Aspirin at 9am'.");
    }
  } catch (error) {
    console.error(error);
    await ctx.reply('Something went wrong. Please try again.');
  }
}

export async function getHealthAwareReply(text: string, userId: number) {
  const logs = await db.db.select().from(db.healthLogs).where(eq(db.healthLogs.telegramId, userId)).limit(5);
  const healthContext = logs.map((l) => `${l.type}: ${l.value}`).join(', ');
  return getHealthAwareResponse(text, healthContext);
}