import { Star, Quote } from "lucide-react"

export function TestimonialSection() {
  return (
    <section id="testimonials" className="bg-card py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
            Testimonials
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight text-foreground md:text-4xl">
            Trusted by families
          </h2>
        </div>

        <div className="mx-auto max-w-2xl">
          <article className="relative rounded-2xl border border-border bg-background p-8 shadow-sm md:p-12">
            <Quote
              className="absolute right-8 top-8 h-12 w-12 text-primary/10"
              aria-hidden="true"
            />

            <div className="mb-6 flex gap-1" aria-label="5 out of 5 stars">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className="h-5 w-5 fill-primary text-primary"
                  aria-hidden="true"
                />
              ))}
            </div>

            <blockquote className="mb-8 text-lg leading-relaxed text-foreground md:text-xl">
              {'"MediAid has given me real peace of mind. I live two hours away from my mother, and now I get instant alerts if she misses a dose. She loves sending voice notes — it\'s so much easier for her than typing. I can\'t imagine managing her care without it."'}
            </blockquote>

            <div className="flex items-center gap-4">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary"
                aria-hidden="true"
              >
                A
              </div>
              <div>
                <p className="font-semibold text-foreground">Anita Sharma</p>
                <p className="text-sm text-muted-foreground">
                  Caretaker for her mother, 78
                </p>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
