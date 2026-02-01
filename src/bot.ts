import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseMedCommand } from './services/groq-client.js';
import * as db from './services/database.js';
import { eq } from 'drizzle-orm';

const bot = new Telegraf(process.env.BOT_TOKEN!);

bot.start((ctx) => {
  ctx.reply("👵 Welcome to MedAssist. I'll help you remember your medicine. You can talk to me or use buttons.");
});

// Handle Voice Messages (Core feature for elderly users)
bot.on(message('voice'), async (ctx) => {
  const userId = ctx.from.id;
  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
    
    // Save and Convert OGA to MP3 (Requires ffmpeg)
    const ogaPath = path.join(__dirname, `temp_${userId}.oga`);
    const mp3Path = path.join(__dirname, `temp_${userId}.mp3`);
    fs.writeFileSync(ogaPath, Buffer.from(response.data));
    execSync(`ffmpeg -i ${ogaPath} ${mp3Path} -y`);

    // 1. Transcribe & Parse
    // (Assuming transcribeAudio is implemented similarly to SwapSmith's)
    const transcript = "I just took my 10mg Lisinopril"; // Placeholder for actual transcription
    const parsed = await parseMedCommand(transcript);

    if (parsed.intent === 'log_intake') {
      // 2. Database Logging
      await db.db.insert(db.adherenceLogs).values({
        telegramId: userId,
        status: 'taken',
        medicationId: 1 // Logic to match name to ID needed here
      });
      ctx.reply(`✅ ${parsed.parsedMessage}`);
    }
    
    fs.unlinkSync(ogaPath); fs.unlinkSync(mp3Path);
  } catch (e) {
    ctx.reply("I'm sorry, I couldn't understand that. Could you repeat it?");
  }
});

// Caregiver notification on missed dose (Example trigger)
bot.action('missed_dose', async (ctx) => {
  const patientId = ctx.from.id;
  const caregiver = await db.db.select().from(db.caregivers).where(eq(db.caregivers.patientTelegramId, patientId));
  
  if (caregiver[0]) {
    bot.telegram.sendMessage(caregiver[0].caregiverTelegramId, `⚠️ ALERT: Patient ${ctx.from.first_name} has missed a dose!`);
  }
  ctx.reply("I've notified your caregiver.");
});

bot.launch();