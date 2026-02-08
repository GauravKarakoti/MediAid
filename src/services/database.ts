import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { pgTable, serial, text, integer, timestamp, bigint, boolean } from 'drizzle-orm/pg-core'; // Added date
import dotenv from 'dotenv';

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);

export const users = pgTable('users', {
  telegramId: bigint('telegram_id', { mode: 'number' }).primaryKey(),
  timezone: text('timezone').default('Asia/Kolkata'), // Default to IST
});

export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  dosage: text('dosage').notNull(),
  schedule: text('schedule').notNull(),
  frequency: integer('frequency').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  reminderEnabled: boolean('reminder_enabled').default(true),
  endDate: timestamp('end_date'),
  snoozedUntil: timestamp('snoozed_until'),
  // [NEW] Store custom notes and snooze settings
  notes: text('notes'), 
  allowSnooze: boolean('allow_snooze').default(true),
});

export const adherenceLogs = pgTable('adherence_logs', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  medicationId: integer('medication_id').references(() => medications.id),
  status: text('status').notNull(),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const caregivers = pgTable('caregivers', {
  id: serial('id').primaryKey(),
  patientTelegramId: bigint('patient_id', { mode: 'number' }).unique().notNull(),
  caregiverTelegramId: bigint('caregiver_id', { mode: 'number' }).notNull(),
});

// --- [NEW] Feature 6: Health Measurements ---
export const healthLogs = pgTable('health_logs', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  type: text('type').notNull(), // e.g., 'BP', 'Sugar', 'Weight'
  value: text('value').notNull(), // e.g., '120/80', '140 mg/dL'
  timestamp: timestamp('timestamp').defaultNow(),
});

export const appointments = pgTable('appointments', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  title: text('title').notNull(),
  date: timestamp('date').notNull(),
  reminded: boolean('reminded').default(false),
  // [NEW] Notes for appointments
  notes: text('notes'),
});