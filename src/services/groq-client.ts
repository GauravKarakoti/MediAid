import Groq from "groq-sdk";
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  // Added 'query_missed' to the intent list
  intent: 'add_medication' | 'log_intake' | 'query_schedule' | 'remove_medication' | 'update_medication' | 'general_conversation' | 'log_health' | 'add_appointment' | 'sos' | 'query_health' | 'query_appointments' | 'query_missed' | 'unknown';
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

// MERGED SYSTEM PROMPT: Updated with Time Inference and query_missed
const systemPrompt = `
You are MediAid, a voice aide for elderly medication adherence.
Parse inputs into JSON.
Current Date: ${new Date().toISOString()}

Modes/Intents:
1. "log_intake": User took medicine (e.g., "I took my blue pill").
2. "add_medication": New regimen.
   - Extract "frequencyDays" (e.g., "daily" -> 1).
   - **TIME INFERENCE (CRITICAL)**: If the user does NOT provide a time, you MUST infer it from the medication name.
     - Sleep/PM meds (Ambien, melatonin) -> "22:00"
     - Morning meds (Thyroid, Vitamins) -> "09:00"
     - BP/Heart meds -> "09:00"
     - Twice daily -> Set time to the *first* dose (e.g., "09:00").
     - Do NOT return null for time if it can be guessed.
3. "remove_medication": User wants to stop a med.
4. "query_schedule": "schedule", "routine", "what do I take".
5. "update_medication": Change details.
6. "general_conversation": Friendly chat.
7. "log_health": "BP is 120/80".
8. "add_appointment": "Doctor on Feb 20 at 2pm".
9. "sos": "Help me", "Call caretaker".
10. "query_health": "Show my health logs".
11. "query_appointments": "Show my appointments".
12. "query_missed": "What did I miss?", "Did I forget any pills?", "Missed medicines".

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