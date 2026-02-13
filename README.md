# MediAid 🏥
MediAid is a voice-enabled personal health assistant for Telegram, designed to help elderly users manage their medication adherence, appointments, and health vitals. It utilizes advanced AI models via **Groq** for voice transcription, natural language understanding, and image analysis (prescriptions and lab reports).

---

## 🌟 Key Features
### 💊 Medication Management:

- Add, update, and remove medications using natural language (e.g., "*Add 5mg Aspirin daily at 9 AM*").
- **Safety Checks**: Automatically checks if a dosage is generally safe using AI before adding it.
- **Smart Reminders**: Interactive reminders with "Taken", "Skip", and "Snooze" options.
- **Adherence Tracking**: Logs taken/missed doses and generates weekly reports.

### 🗣️ Voice & Text Support:

- Send voice notes to the bot; they are transcribed using **Whisper-large-v3** and processed automatically.
- Supports informal conversation and health queries.

### 👁️ AI Vision Scanning:

- **Prescriptions**: Upload a photo of a prescription to automatically extract and schedule medications using **Llama-4-Scout**.
- **Lab Reports**: Upload a lab report for an AI-generated summary of key biomarkers and their interpretations.

### 👥 Caretaker System:

- Link patients with caretakers.
- **SOS Alerts**: Patients can say "Help" or "SOS" to immediately notify their caretaker.
- **Missed Dose Alerts**: Caretakers are notified if the patient misses a scheduled medication.

### 🗓️ Appointment & Health Logging:

- Schedule and manage doctor appointments.
- Log health vitals (e.g., "*My BP is 120/80*") and view history.

---

## 🛠️ Tech Stack
- **Runtime**: Node.js (TypeScript)
- **Framework**: Telegraf (Telegram Bot API)
- **Database**: PostgreSQL (via Neon Serverless) with Drizzle ORM.
- **AI/LLM Provider**: Groq Cloud
    - *LLM*: `llama-3.3-70b-versatile` (Command parsing, safety checks)
    - *Vision*: `meta-llama/llama-4-scout-17b-16e-instruct` (Image analysis)
    - *Audio*: `whisper-large-v3` (Transcription)
- **External Tools**: FFmpeg (for voice message processing).

---

## 📋 Prerequisites
Before running the project, ensure you have the following installed:
- **Node.js** (v20+ recommended)
- **FFmpeg**: Required for converting Telegram voice messages (`.oga`) to `.mp3`.
    - *Linux*: `sudo apt install ffmpeg`
    - *Mac*: `brew install ffmpeg`
    - *Windows*: Download and add to system PATH.

---

## 🚀 Installation
#### 1. Clone the repository:
```bash
git clone https://github.com/yourusername/mediaid.git
cd mediaid
```

#### 2. Install dependencies:
```bash
npm install
```

#### 3. Environment Configuration:
Create a `.env` file in the root directory based on `.env.example`:
```bash
cp .env.example .env
```

#### 4. Database Setup:
Push the database schema to your Neon/Postgres instance:
```bash
npm run db:push
```
*Alternatively, for migrations*: `npm run db:migrate`

---

## 🏃 Usage
#### Development
Run the bot in watch mode (auto-restart on changes):
```bash
npm run dev
```

#### Production
Build and start the bot:
```bash
npm run build
npm start
```

#### 🤖 Bot Commands
Once the bot is running, you can use these commands in Telegram:

| Command | Description |
| ------- | ----------- |
| /start | Initialize the bot and receive instructions. |
| /help | Show the help menu with examples. |
| /setcaretaker | Button flow to select a user as your caretaker. |
| /becomecaretaker | Button flow to request managing a patient. |
| /timezone [Region/City] | "Set your timezone (e.g., /timezone Asia/Kolkata)." |
| /schedule | View your upcoming medication routine. |
| /appointments | List upcoming doctor visits. |

---

## 📂 Project Structure
- `src/bot.ts`: Main entry point. Handles Telegram updates, commands, cron jobs (reminders/reports), and interaction logic.
- `src/services/groq-client.ts`: Interfaces with the Groq API for LLM completion, vision analysis, and audio transcription.
- `src/services/database.ts`: Database connection and schema definitions (inferred).
- `drizzle/`: Database migration and snapshot files.
- `assets/`: Static assets like alarm sounds.