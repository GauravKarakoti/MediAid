import cron from 'node-cron';
import * as db from './services/database.js';
import { sql, eq, and, gte, lt, isNull } from 'drizzle-orm';
import { bot as telegramBot } from './telegram/bot.js';
import { waClient } from './whatsapp/bot.js';

async function sendToUser(userId: number, text: string, options?: { parseMode?: 'HTML' | 'Markdown' }) {
  const profile = await db.db.select().from(db.users).where(eq(db.users.telegramId, userId)).limit(1);
  const platform = (profile[0] as any)?.platform || (userId.toString().length >= 12 ? 'whatsapp' : 'telegram');

  if (platform === 'whatsapp') {
    await waClient.sendMessage(`${userId}@c.us`, text);
    return;
  }

  await telegramBot.telegram.sendMessage(
    userId,
    text,
    options?.parseMode ? { parse_mode: options.parseMode } : undefined
  );
}

export function initCrons() {
  console.log('⏰ Initializing unified scheduler...');

  cron.schedule('0 9 * * 0', async () => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const patients = await db.db.selectDistinct({ id: db.medications.telegramId }).from(db.medications);

    for (const p of patients) {
      const userId = p.id;

      const logs = await db.db
        .select()
        .from(db.adherenceLogs)
        .where(and(eq(db.adherenceLogs.telegramId, userId), gte(db.adherenceLogs.timestamp, weekAgo)));

      const taken = logs.filter((l) => l.status === 'taken').length;
      const missed = logs.filter((l) => l.status === 'missed').length;
      const total = taken + missed;
      const percentage = total > 0 ? Math.round((taken / total) * 100) : 0;

      const health = await db.db
        .select()
        .from(db.healthLogs)
        .where(and(eq(db.healthLogs.telegramId, userId), gte(db.healthLogs.timestamp, weekAgo)))
        .orderBy(db.healthLogs.timestamp);

      let healthMsg = '';
      if (health.length > 0) {
        healthMsg = '\n\n🏥 Health Vitals (Last 7 Days):\n' + health.map((h) => `• ${h.type}: ${h.value}`).join('\n');
      }

      const report =
        `📊 Weekly Health Report\n\n` +
        `💊 Medication Adherence:\n` +
        `• Taken: ${taken}\n• Missed: ${missed}\n• Score: ${percentage}%` +
        healthMsg;

      await sendToUser(userId, report);
      const caretakerLink = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, userId)).limit(1);

      if (caretakerLink.length > 0) {
        await sendToUser(caretakerLink[0]!.caregiverTelegramId, `📑 Patient Report (ID: ${userId})\n${report}`);
      }
    }
  });

  cron.schedule('* * * * *', async () => {
    const allMeds = await db.db.select().from(db.medications);
    const now = new Date();

    for (const med of allMeds) {
      const profile = await db.db.select().from(db.users).where(eq(db.users.telegramId, med.telegramId)).limit(1);
      const platform = (profile[0] as any)?.platform || (med.telegramId.toString().length >= 12 ? 'whatsapp' : 'telegram');

      const [schedH, schedM] = med.schedule.split(':').map(Number);
      const schedDate = new Date(now);
      schedDate.setHours(schedH as number, schedM, 0, 0);

      const diffInMinutes = (now.getTime() - schedDate.getTime()) / 60000;
      if (diffInMinutes < 0 || diffInMinutes >= 60) continue;

      const todayLogs = await db.db.execute(sql`
        SELECT id FROM adherence_logs
        WHERE medication_id = ${med.id}
        AND DATE(timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = DATE(NOW() AT TIME ZONE 'Asia/Kolkata')
      `);

      if (todayLogs.rows.length > 0) continue;
      if (med.snoozedUntil && med.snoozedUntil > new Date()) continue;

      const reminderText =
        `⏰ REMINDER\nTake: ${med.name} (${med.dosage})${med.notes ? `\n\n📝 ${med.notes}` : ''}`;

      if (platform === 'whatsapp') {
        await waClient.sendMessage(
          `${med.telegramId}@c.us`,
          `${reminderText}\n\nReply TAKEN ${med.id}, SKIP ${med.id} or SNOOZE ${med.id}.`
        );
      } else {
        const sentMsg = await telegramBot.telegram.sendMessage(med.telegramId, reminderText, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Taken', callback_data: `taken_${med.id}` }],
              [{ text: '❌ Skip', callback_data: `missed_${med.id}` }],
              ...(med.allowSnooze ? [[{ text: '💤 Snooze 10m', callback_data: `snooze_${med.id}` }]] : []),
            ],
          },
        });

        await db.db.update(db.medications).set({ lastReminderMessageId: sentMsg.message_id }).where(eq(db.medications.id, med.id));
      }
    }
  });

  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const lookbackWindow = new Date(now.getTime() - 15 * 60000);
    const lookaheadWindow = new Date(now.getTime() + 24 * 60 * 60000);

    const upcoming = await db.db.select().from(db.appointments).where(
      and(
        lt(db.appointments.date, lookaheadWindow),
        gte(db.appointments.date, lookbackWindow),
        eq(db.appointments.reminded, false)
      )
    );

    for (const appt of upcoming) {
      await sendToUser(
        appt.telegramId,
        `🗓️ REMINDER: Appointment '${appt.title}' is coming up on ${appt.date.toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata',
        })}`
      );

      await db.db.update(db.appointments).set({ reminded: true }).where(eq(db.appointments.id, appt.id));
    }
  });

  cron.schedule('59 23 * * *', async () => {
    const missedMeds = await db.db
      .select({
        id: db.medications.id,
        telegramId: db.medications.telegramId,
      })
      .from(db.medications)
      .leftJoin(
        db.adherenceLogs,
        and(eq(db.medications.id, db.adherenceLogs.medicationId), sql`DATE(${db.adherenceLogs.timestamp}) = CURRENT_DATE`)
      )
      .where(isNull(db.adherenceLogs.id));

    for (const m of missedMeds) {
      await db.db.insert(db.adherenceLogs).values({
        telegramId: m.telegramId,
        medicationId: m.id,
        status: 'missed',
      });
    }

    await db.db.delete(db.medications).where(lt(db.medications.endDate, new Date()));
  });
}