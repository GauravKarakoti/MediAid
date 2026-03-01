import { Button } from "@/components/ui/button"
import { TelegramIcon } from "@/components/icons"

export function CtaSection() {
  return (
    <section className="bg-background py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-16 text-center md:px-16 md:py-20">
          <div className="absolute inset-0 -z-0 opacity-10">
            <div className="absolute -left-10 -top-10 h-64 w-64 rounded-full bg-card blur-3xl" />
            <div className="absolute -bottom-10 -right-10 h-64 w-64 rounded-full bg-card blur-3xl" />
          </div>

          <div className="relative z-10">
            <h2 className="mx-auto max-w-lg text-balance text-3xl font-bold text-primary-foreground md:text-4xl">
              Start managing your health today
            </h2>
            <p className="mx-auto mt-4 max-w-md text-pretty text-lg leading-relaxed text-primary-foreground/80">
              Join thousands of families who trust MediAid for medication
              management, health tracking, and peace of mind.
            </p>

            <Button
              asChild
              size="lg"
              className="mt-8 gap-2.5 bg-background px-8 text-base font-semibold text-foreground shadow-lg hover:bg-background/90"
            >
              <a
                href="https://t.me/MediAidBot"
                target="_blank"
                rel="noopener noreferrer"
              >
                <TelegramIcon className="h-5 w-5" />
                Try MediAid Now
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
