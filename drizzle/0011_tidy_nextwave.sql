CREATE TABLE "product_previews" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"generated_by" uuid,
	"input_stamp" text NOT NULL,
	"grade" text NOT NULL,
	"booklet" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_previews" ADD CONSTRAINT "product_previews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;