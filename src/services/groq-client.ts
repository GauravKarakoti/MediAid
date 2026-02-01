import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Export the groq instance so it can be used in bot.ts
export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  intent: 'add_medication' | 'log_intake' | 'query_schedule' | 'unknown';
  medicationName?: string;
  dosage?: string;
  time?: string;
  parsedMessage?: string;
}

const systemPrompt = `
You are MediAid, a voice aide for elderly medication adherence.
Parse transcripts into JSON.
Modes:
1. "log_intake": User took medicine (e.g., "I took my blue pill").
2. "add_medication": New regimen (e.g., "Take 5mg of Lisinopril daily").
3. "query_schedule": Asking what to take.
Return: { "success": bool, "intent": string, "medicationName": string, "dosage": string, "time": "HH:MM", "parsedMessage": string }
`;

/**
 * Transcribes an audio file using Groq Whisper
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: "whisper-large-v3",
    response_format: "text",
  });
  return transcription as unknown as string;
}

export async function parseMedCommand(userInput: string): Promise<MedCommand> {
  const completion = await groq.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userInput }],
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0]?.message.content || '{}');
}