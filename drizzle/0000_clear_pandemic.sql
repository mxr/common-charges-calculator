CREATE TABLE "otp_gate" (
	"email" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_send" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "otp_send_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
