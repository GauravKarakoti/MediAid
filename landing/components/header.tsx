"use client"

import { useState } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TelegramIcon } from "@/components/icons"
import { ThemeToggle } from "@/components/theme-toggle"
import Image from "next/image"

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Testimonials", href: "#testimonials" },
]

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8 py-4">
        <Link href="/" className="flex items-center gap-2" aria-label="MediAid home">
          <Image 
            src="/icon.png" 
            alt="MediAid Logo" 
            width={36} 
            height={36} 
            className="rounded-lg"
            priority
          />
          <span className="text-xl font-bold tracking-tight text-foreground">
            MediAid
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main navigation">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <ThemeToggle />
          <Button asChild size="sm" className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
            <a href="https://t.me/Medi_Aid_Bot" target="_blank" rel="noopener noreferrer">
              <TelegramIcon className="h-4 w-4" />
              Start Chatting
            </a>
          </Button>
        </div>

        <button
          className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-background px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-4" aria-label="Mobile navigation">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <div className="flex items-center gap-3 mt-2">
              <ThemeToggle />
              <Button asChild size="sm" className="flex-1 gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
                <a href="https://t.me/Medi_Aid_Bot" target="_blank" rel="noopener noreferrer">
                  <TelegramIcon className="h-4 w-4" />
                  Start Chatting
                </a>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
