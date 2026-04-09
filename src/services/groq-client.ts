import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface MedCommand {
  intent:
    | 'add_medication'
    | 'log_intake'
    | 'query_schedule'
    | 'remove_medication'
    | 'update_medication'
    | 'general_conversation'
    | 'log_health'
    | 'add_appointment'
    | 'sos'
    | 'query_health'
    | 'query_appointments'
    | 'query_missed'
    | 'update_appointment'
    | 'remove_appointment'
    | 'unknown';

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
  oldAppointmentTitle?: string;
  appointmentDate?: string;
  notes?: string;
  allowSnooze?: boolean;
}

const systemPrompt = `
You are MediAid, a voice aide for elderly medication adherence.
Parse user input into JSON only.
Current Date: ${new Date().toISOString()}

Rules:
- If the user gives a medication but no time, infer a reasonable time.
- Sleep/PM meds (Ambien, melatonin) -> "22:00"
- Morning meds (thyroid, vitamins, BP/heart meds) -> "09:00"
- Twice daily -> use the first dose time, usually "09:00"
- Do not return null for time if it can be inferred.
- "notes" should capture extra instructions like "after breakfast".
- "allowSnooze" should be false only if the user explicitly says no snooze.

Intents:
1. add_medication
2. log_intake
3. query_schedule
4. remove_medication
5. update_medication
6. general_conversation
7. log_health
8. add_appointment
   - appointmentDate should be strict: "YYYY-MM-DD HH:mm"
   - if time is missing, default to "09:00"
9. sos
10. query_health
11. query_appointments
12. query_missed
13. update_appointment
14. remove_appointment

Return JSON:
{
  "intent": string,
  "medicationName": string | null,
  "dosage": string | null,
  "time": "HH:MM" | null,
  "notes": string | null,
  "allowSnooze": boolean | null,
  "frequencyDays": number | null,
  "durationDays": number | null,
  "healthType": string | null,
  "healthValue": string | null,
  "appointmentTitle": string | null,
  "oldAppointmentTitle": string | null,
  "appointmentDate": string | null,
  "parsedMessage": string | null,
  "response": string | null
}
`;

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function analyzeLabReport(imageBuffer: Buffer): Promise<any> {
  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              "Analyze this lab report. Identify key biomarkers, their values, and explain them. Return the analysis in valid JSON with a 'summary' field.",
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
            },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  return safeJsonParse(completion.choices[0]?.message.content || '{}', {});
}

export async function getHealthAwareResponse(userInput: string, healthContext: string): Promise<string> {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content: `You are MediAid, a personalized health assistant.

Guidelines:
1. Always fulfill the user's specific request.
2. Use the user's health profile as context and safety constraints.
3. If a suggestion conflicts with a logged vital, include a clear medical disclaimer.

User Health Profile: ${healthContext}`,
      },
      { role: 'user', content: userInput },
    ],
    model: 'llama-3.3-70b-versatile',
  });

  return completion.choices[0]?.message.content || "I'm here to help.";
}

export async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'text',
  });

  return transcription as unknown as string;
}

export async function parseMedCommand(userInput: string): Promise<MedCommand> {
  const completion = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
  });

  const parsed = safeJsonParse<MedCommand>(completion.choices[0]?.message.content || '{}', {
    intent: 'unknown',
  } as MedCommand);

  return {
    intent: parsed.intent || 'unknown',
    medicationName: parsed.medicationName ?? '',
    dosage: parsed.dosage ?? '',
    time: parsed.time ?? '',
    frequencyDays: parsed.frequencyDays ?? 1,
    durationDays: parsed.durationDays ?? 365,
    parsedMessage: parsed.parsedMessage ?? '',
    response: parsed.response ?? '',
    healthType: parsed.healthType ?? '',
    healthValue: parsed.healthValue ?? '',
    appointmentTitle: parsed.appointmentTitle ?? '',
    oldAppointmentTitle: parsed.oldAppointmentTitle ?? '',
    appointmentDate: parsed.appointmentDate ?? '',
    notes: parsed.notes ?? '',
    allowSnooze: parsed.allowSnooze ?? true,
  };
}

export async function checkDosageSafety(
  medName: string,
  dosage: string
): Promise<{ safe: boolean; warning?: string }> {
  const completion = await groq.chat.completions.create({
    messages: [
      {
        role: 'system',
        content:
          'You are a pharmacist. Check if the dosage is generally safe for a human adult. Return JSON: { safe: boolean, warning: string | null }.',
      },
      { role: 'user', content: `Medication: ${medName}, Dosage: ${dosage}` },
    ],
    model: 'llama-3.3-70b-versatile',
    response_format: { type: 'json_object' },
  });

  return safeJsonParse(completion.choices[0]?.message.content || '{"safe":true}', { safe: true });
}

export async function analyzePrescription(imageBuffer: Buffer): Promise<any> {
  const completion = await groq.chat.completions.create({
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this prescription image.

1. Strictly check if it is a legitimate prescription. If not, set isLegit: false.
2. Extract medications: name, dosage, frequency (number of days), duration (days).
3. If time is not present, infer a sensible time from the medicine type.
4. Include notes only if visible in the prescription.

Return JSON:
{
  "isLegit": boolean,
  "warning": string,
  "medications": [
    {
      "name": string,
      "dosage": string,
      "time": "HH:MM",
      "frequency": number,
      "durationDays": number,
      "notes": string | null,
      "allowSnooze": boolean | null
    }
  ]
}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`,
            },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  });

  return safeJsonParse(completion.choices[0]?.message.content || '{}', {});
}