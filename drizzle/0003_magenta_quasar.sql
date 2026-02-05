CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"title" text NOT NULL,
	"date" timestamp NOT NULL,
	"reminded" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "medications" ADD COLUMN "end_date" timestamp;