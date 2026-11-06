CREATE TABLE "budget_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "budget_invite_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "budget_invite_role_check" CHECK ("budget_invite"."role" in ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "budget_member" (
	"budget_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "budget_member_budget_id_user_id_pk" PRIMARY KEY("budget_id","user_id"),
	CONSTRAINT "budget_member_role_check" CHECK ("budget_member"."role" in ('viewer', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "budget_invite" ADD CONSTRAINT "budget_invite_budget_id_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_member" ADD CONSTRAINT "budget_member_budget_id_budget_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budget"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_invite_budget_id_index" ON "budget_invite" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budget_member_user_id_index" ON "budget_member" USING btree ("user_id");
