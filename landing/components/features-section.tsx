import {
  Mic,
  Bell,
  ScanLine,
  Users,
  AlertTriangle,
  CalendarCheck,
} from "lucide-react"

const features = [
  {
    icon: Mic,
    title: "Voice & Text Support",
    description:
      "Send a voice note and get an instant transcription. MediAid understands both text and voice, making it effortless for everyone.",
  },
  {
    icon: Bell,
    title: "Smart Medication Reminders",
    description:
      "Interactive alerts let you confirm, skip, or snooze doses with a single tap. Never miss an important medication again.",
  },
  {
    icon: ScanLine,
    title: "AI Vision Scanning",
    description:
      "Upload a photo of your prescription or lab report and MediAid automatically extracts and organizes the information for you.",
  },
  {
    icon: Users,
    title: "Caretaker System",
    description:
      "Link patients with their caretakers so they receive real-time alerts for missed doses and health updates.",
  },
  {
    icon: AlertTriangle,
    title: "SOS Alerts",
    description:
      "Trigger instant emergency notifications to caretakers and emergency contacts with a single command.",
  },
  {
    icon: CalendarCheck,
    title: "Appointment Tracking",
    description:
      "Schedule and manage doctor visits with smart reminders so you always arrive prepared and on time.",
  },
]

export function FeaturesSection() {
  return (
    <section id="features" className="bg-card py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
            Features
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Everything you need for peace of mind
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
            MediAid combines voice AI, smart reminders, and a caretaker network
            into one simple Telegram bot.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="group rounded-xl border border-border bg-background p-8 transition-all hover:border-primary/30 hover:shadow-lg"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
