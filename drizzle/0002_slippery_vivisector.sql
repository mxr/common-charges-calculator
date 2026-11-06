CREATE TABLE "budget_version" (
	"budget_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"based_on" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"published_by" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_version_budget_id_number_pk" PRIMARY KEY("budget_id","number")
);
--> statement-breakpoint
ALTER TABLE "budget_version" ADD CONSTRAINT "budget_version_budget_id_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("id") ON DELETE cascade ON UPDATE no action;
