CREATE TABLE "product_hidden_articles" (
	"product_id" uuid NOT NULL,
	"article_id" text NOT NULL,
	"hidden_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_by" uuid,
	CONSTRAINT "product_hidden_articles_product_id_article_id_pk" PRIMARY KEY("product_id","article_id")
);
--> statement-breakpoint
ALTER TABLE "product_hidden_articles" ADD CONSTRAINT "product_hidden_articles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;