import { MessageCircle, Image as ImageIcon, Clock } from "lucide-react"

const steps = [
  {
    number: "01",
    icon: MessageCircle,
    title: "Start the Bot",
    description:
      'Open Telegram and search for @Medi_Aid_Bot. Tap "Start" to begin your health journey in seconds.',
  },
  {
    number: "02",
    icon: ImageIcon,
    title: "Send a Voice Note or Photo",
    description:
      "Record a voice message about your symptoms or snap a photo of your prescription. MediAid handles the rest.",
  },
  {
    number: "03",
    icon: Clock,
    title: "Get Reminders & Reports",
    description:
      "Receive automated medication reminders, health reports, and alerts. Your caretakers stay informed too.",
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-background py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
            How It Works
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Up and running in 3 simple steps
          </h2>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
            No installations, no complicated setups. Just open Telegram and
            start chatting.
          </p>
        </div>

        <div className="relative">
          {/* Connector line for desktop */}
          <div
            className="absolute left-1/2 top-16 hidden h-px w-[calc(66%)] -translate-x-1/2 bg-border lg:block"
            aria-hidden="true"
          />

          <div className="grid gap-12 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, idx) => (
              <div key={step.number} className="relative flex flex-col items-center text-center">
                {/* Mobile connector */}
                {idx < steps.length - 1 && (
                  <div
                    className="absolute left-1/2 top-full h-12 w-px -translate-x-1/2 bg-border lg:hidden"
                    aria-hidden="true"
                  />
                )}

                <div className="relative z-10 mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-primary bg-card text-primary shadow-sm">
                  <step.icon className="h-7 w-7" aria-hidden="true" />
                </div>

                <span className="mb-2 text-xs font-bold uppercase tracking-widest text-primary/60">
                  Step {step.number}
                </span>
                <h3 className="mb-3 text-xl font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
