import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  intent: 'add_medication' | 'log_intake' | 'query_schedule' | 'remove_medication' | 'update_medication' | 'general_conversation' | 'log_health' | 'add_appointment' | 'sos' | 'unknown';
  medicationName?: string;
  dosage?: string;
  time?: string;
  frequencyDays?: number;
  durationDays?: number;
  parsedMessage?: string;
  response?: string;
  healthType?: string;
  healthValue?: string;
  appointmentTitle?: string;
  appointmentDate?: string;
}

// MERGED SYSTEM PROMPT: Covers all functionalities
const systemPrompt = `
You are MediAid, a voice aide for elderly medication adherence.
Parse inputs into JSON.
Current Date: ${new Date().toISOString()}

Modes/Intents:
1. "log_intake": User took medicine (e.g., "I took my blue pill").
2. "add_medication": New regimen (e.g., "Take 5mg of Lisinopril every 2 days at 9am").
   - Extract "frequencyDays" as an integer (e.g., "daily" -> 1, "every 2 days" -> 2). Default is 1.
   - Extract "durationDays" if mentioned (e.g., "for 7 days").
3. "remove_medication": User wants to stop a med (e.g., "Stop taking Aspirin").
4. "query_schedule": Asking what to take.
5. "update_medication": Change an existing medication's details.
6. "general_conversation": The user is engaging in normal conversation. Generate a friendly "response".
7. "log_health": "BP is 120/80" -> { intent: "log_health", healthType: "BP", healthValue: "120/80" }
8. "add_appointment": "Doctor on Feb 20 at 2pm" -> { intent: "add_appointment", appointmentTitle: "Doctor", appointmentDate: "ISO_DATE_STRING" }
9. "sos": "Help me", "Call caretaker" -> { intent: "sos" }

Return JSON structure: 
{ 
  "intent": string, 
  "medicationName": string | null, 
  "dosage": string | null, 
  "time": "HH:MM" | null, 
  "frequencyDays": number | null,
  "durationDays": number | null,
  "healthType": string | null,
  "healthValue": string | null,
  "appointmentTitle": string | null,
  "appointmentDate": string | null,
  "parsedMessage": string | null,
  "response": string | null
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

// --- Feature 3: Dosage Safety Check ---
export async function checkDosageSafety(medName: string, dosage: string): Promise<{ safe: boolean; warning?: string }> {
  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: "You are a pharmacist. Check if the dosage is generally safe for a human adult. Return JSON: { safe: boolean, warning: string | null }." },
      { role: "user", content: `Medication: ${medName}, Dosage: ${dosage}` }
    ],
    model: "llama-3.3-70b-versatile",
    response_format: { type: "json_object" },
  });
  return JSON.parse(completion.choices[0]?.message.content || '{"safe":true}');
}

// --- Feature 2, 4, 5: Prescription Scan ---
export async function analyzePrescription(imageBuffer: Buffer): Promise<any> {
    const completion = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "Analyze this image. 1. Is it a valid prescription? 2. Extract medications (name, dosage, frequency). 3. If timings aren't specified, suggest standard timings (e.g., morning/night). Return JSON: { isLegit: boolean, medications: [{name, dosage, time, frequency}], warning: string }" },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }
                ]
            }
        ],
        response_format: { type: "json_object" },
    });
    return JSON.parse(completion.choices[0]?.message.content || '{}');
}