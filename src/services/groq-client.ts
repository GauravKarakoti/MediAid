import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  // Added 'update_medication' and 'general_conversation' intent
  intent: 'add_medication' | 'log_intake' | 'query_schedule' | 'remove_medication' | 'update_medication' | 'general_conversation' | 'unknown';
  medicationName?: string;
  dosage?: string;
  time?: string;
  frequencyDays?: number;
  parsedMessage?: string;
  response?: string; // Field for conversational responses
}

const systemPrompt = `
You are MediAid, a voice aide for elderly medication adherence.
Parse transcripts into JSON.

Modes:
1. "log_intake": User took medicine (e.g., "I took my blue pill").
2. "add_medication": New regimen (e.g., "Take 5mg of Lisinopril every 2 days at 9am").
   - Extract "frequencyDays" as an integer (e.g., "daily" -> 1, "every 2 days" -> 2, "every other day" -> 2). Default is 1.
3. "remove_medication": User wants to stop a med (e.g., "Stop taking Aspirin").
4. "query_schedule": Asking what to take.
5. "update_medication": Change an existing medication's details (e.g., "Change my Aspirin dosage to 10mg" or "Update Lisinopril time to 10 PM").
6. "general_conversation": The user is engaging in normal conversation, asking a general question, or saying hello (e.g., "Hi", "How are you?", "What's the weather?"). 
   - In this case, generate a friendly, helpful, and concise response suitable for an elderly user in the "response" field.

Return: 
{ 
  "success": bool, 
  "intent": string, 
  "medicationName": string, 
  "dosage": string, 
  "time": "HH:MM", 
  "frequencyDays": number,
  "parsedMessage": string,
  "response": string
}
`;

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