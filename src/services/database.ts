import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { pgTable, serial, text, integer, timestamp, bigint, boolean } from 'drizzle-orm/pg-core';
import dotenv from 'dotenv';

dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);

// Medications table: Stores the regimen for each user
export const medications = pgTable('medications', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  dosage: text('dosage').notNull(),
  schedule: text('schedule').notNull(), // e.g., "08:00, 20:00"
  frequency: integer('frequency').default(1), // Interval in days (1 = daily, 2 = every other day)
  createdAt: timestamp('created_at').defaultNow(), // Used to calculate frequency offsets
  reminderEnabled: boolean('reminder_enabled').default(true),
});

// Adherence logs: Tracks when meds were taken or missed
export const adherenceLogs = pgTable('adherence_logs', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
  medicationId: integer('medication_id').references(() => medications.id),
  status: text('status').notNull(), // "taken" | "missed"
  timestamp: timestamp('timestamp').defaultNow(),
});

// Caregivers: Links a patient to a caregiver for alerts
export const caregivers = pgTable('caregivers', {
  id: serial('id').primaryKey(),
  patientTelegramId: bigint('patient_id', { mode: 'number' }).unique().notNull(), // Unique ensures one caregiver per patient
  caregiverTelegramId: bigint('caregiver_id', { mode: 'number' }).notNull(),
});