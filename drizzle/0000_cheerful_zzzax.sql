CREATE TABLE "adherence_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"medication_id" integer,
	"status" text NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "caregivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" bigint,
	"caregiver_id" bigint,
	CONSTRAINT "caregivers_patient_id_unique" UNIQUE("patient_id")
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"name" text NOT NULL,
	"dosage" text NOT NULL,
	"schedule" text NOT NULL,
	"reminder_enabled" boolean DEFAULT true
);
--> statement-breakpoint
ALTER TABLE "adherence_logs" ADD CONSTRAINT "adherence_logs_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE no action ON UPDATE no action;