import Image from "next/image"
import { Button } from "@/components/ui/button"
import { TelegramIcon } from "@/components/icons"
import { Shield, Heart } from "lucide-react"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      <div className="absolute inset-0 -z-10 opacity-30">
        <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-7xl flex-col items-center gap-12 px-4 sm:px-6 lg:px-8 pb-20 pt-15 lg:flex-row lg:gap-16 lg:pb-28">
        <div className="flex flex-1 flex-col items-center text-center lg:items-start lg:text-left">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm text-muted-foreground">
            <Shield className="h-4 w-4 text-primary" />
            <span>Trusted by caretakers everywhere</span>
          </div>

          <h1 className="max-w-xl text-balance text-4xl font-bold leading-tight tracking-tight text-foreground md:text-5xl lg:text-6xl">
            Your AI Health Assistant on Telegram
          </h1>

          <p className="mt-6 max-w-lg text-pretty text-lg leading-relaxed text-muted-foreground">
            Manage medications, appointments, and vitals effortlessly through
            text and voice messages. Built with care for elderly users and the
            people who look after them.
          </p>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <Button
              asChild
              size="lg"
              className="gap-2.5 bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
            >
              <a
                href="https://t.me/Medi_Aid_Bot"
                target="_blank"
                rel="noopener noreferrer"
              >
                <TelegramIcon className="h-5 w-5" />
                Start Chatting on Telegram
              </a>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="gap-2 border-border px-8 text-base text-foreground hover:bg-secondary"
            >
              <a href="#how-it-works">See How It Works</a>
            </Button>
          </div>

          <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-accent" />
              <span>Free to use</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <span>No app to install</span>
            <div className="h-4 w-px bg-border" />
            <span>Works on Telegram</span>
          </div>
        </div>

        <div className="relative flex-1">
          <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
            <Image
              src="/images/hero-elderly.jpg"
              alt="Elderly person comfortably using MediAid on their phone in a bright living room"
              width={500}
              height={500}
              className="h-auto w-full object-cover"
              priority
            />
            <div className="absolute bottom-4 left-4 right-4 rounded-xl border border-border/50 bg-card/90 p-4 backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Heart className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Medication Reminder
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {"Time for your Metformin 500mg. Reply 'taken', 'skip', or 'snooze'."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
