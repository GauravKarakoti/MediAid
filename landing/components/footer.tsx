import Link from "next/link"
import { Button } from "@/components/ui/button"
import { TelegramIcon } from "@/components/icons"
import Image from "next/image"

export function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          <div className="flex flex-col items-center gap-4 md:items-start">
            <Link href="/" className="flex items-center gap-2" aria-label="MediAid home">
              <Image 
                src="/icon.png" 
                alt="MediAid Logo" 
                width={32} 
                height={32} 
                className="rounded-lg"
              />
              <span className="text-lg font-bold text-foreground">MediAid</span>
            </Link>
            <p className="max-w-xs text-center text-sm text-muted-foreground md:text-left">
              A voice-enabled health assistant built for elderly users and their
              caretakers.
            </p>
          </div>

          <Button
            asChild
            size="sm"
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <a
              href="https://t.me/Medi_Aid_Bot"
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
