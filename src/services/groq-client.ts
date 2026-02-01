import Groq from "groq-sdk";
import dotenv from 'dotenv';

dotenv.config();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  success: boolean;
  intent: "log_intake" | "add_medication" | "query_schedule" | "unknown";
  medicationName?: string;
  dosage?: string;
  parsedMessage: string;
}

const systemPrompt = `
You are MedAid, a voice aide for elderly medication adherence.
Parse transcripts into JSON.
Modes:
1. "log_intake": User took medicine (e.g., "I took my blue pill").
2. "add_medication": New regimen (e.g., "Take 5mg of Lisinopril daily").
3. "query_schedule": Asking what to take.
Return: { "success": bool, "intent": string, "medicationName": string, "dosage": string, "parsedMessage": string }
`;

export async function parseMedCommand(userInput: string): Promise<MedCommand> {
  const completion = await groq.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userInput }],
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
  });

  return JSON.parse(completion.choices[0]?.message.content || '{}');
}