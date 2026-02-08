CREATE TABLE "users" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata'
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "allow_snooze" boolean DEFAULT true;