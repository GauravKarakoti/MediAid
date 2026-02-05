import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  intent: 'add_medication' | 'log_intake' | 'query_schedule' | 'remove_medication' | 'update_medication' | 'general_conversation' | 'log_health' | 'add_appointment' | 'sos' | 'query_health' | 'unknown';
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
4. "query_schedule": Asking what to take OR what appointments are coming up.
5. "update_medication": Change an existing medication's details.
6. "general_conversation": The user is engaging in normal conversation. Generate a friendly "response".
7. "log_health": "BP is 120/80" -> { intent: "log_health", healthType: "BP", healthValue: "120/80" }
8. "add_appointment": "Doctor on Feb 20 at 2pm" -> { intent: "add_appointment", appointmentTitle: "Doctor", appointmentDate: "ISO_DATE_STRING" }
9. "sos": "Help me", "Call caretaker" -> { intent: "sos" }
10. "query_health": "Show my health logs", "What was my last BP?" -> { intent: "query_health" }

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

export async function analyzePrescription(imageBuffer: Buffer): Promise<any> {
    const completion = await groq.chat.completions.create({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: `Analyze this prescription image. 
                    1. STRICTLY Check if it is a legit prescription. If not, set isLegit: false.
                    2. Extract medications: name, dosage, frequency (as number of days), duration (in days).
                    3. TIME INFERENCE: If specific time is NOT provided, infer the best time based on the medicine (e.g., Sedatives -> 22:00, Diuretics -> 08:00, General -> 09:00).
                    
                    Return JSON: { 
                        isLegit: boolean, 
                        warning: string,
                        medications: [{
                            name: string, 
                            dosage: string, 
                            time: "HH:MM", 
                            frequency: number, 
                            durationDays: number 
                        }] 
                    }` },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}` } }
                ]
            }
        ],
        response_format: { type: "json_object" },
    });
    return JSON.parse(completion.choices[0]?.message.content || '{}');
}