ALTER TABLE "medications" ADD COLUMN "frequency" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "created_at" timestamp DEFAULT now();