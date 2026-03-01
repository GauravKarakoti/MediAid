import Link from "next/link"
import { Button } from "@/components/ui/button"
import { TelegramIcon } from "@/components/icons"

const footerLinks = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Contact", href: "mailto:hello@mediaid.health" },
]

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <div className="flex flex-col items-center gap-4 md:items-start">
            <Link href="/" className="flex items-center gap-2" aria-label="MediAid home">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-4 w-4 text-primary-foreground"
                  aria-hidden="true"
                >
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14h-2v-2h2v2zm0-4h-2V7h2v5zm4 4h-2v-2h2v2zm0-4h-2V7h2v5z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <span className="text-lg font-bold text-foreground">MediAid</span>
            </Link>
            <p className="max-w-xs text-center text-sm text-muted-foreground md:text-left">
              A voice-enabled health assistant built for elderly users and their
              caretakers.
            </p>
          </div>

          <nav className="flex items-center gap-6" aria-label="Footer navigation">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Button
            asChild
            size="sm"
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <a
              href="https://t.me/MediAidBot"
              target="_blank"
              rel="noopener noreferrer"
            >
              <TelegramIcon className="h-4 w-4" />
              Try MediAid Now
            </a>
          </Button>
        </div>

        <div className="mt-10 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          <p>
            {"© "}{new Date().getFullYear()}{" MediAid. All rights reserved. Built with care for better health."}
          </p>
        </div>
      </div>
    </footer>
  )
}
