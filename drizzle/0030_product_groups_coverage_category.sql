-- 특약 그룹 재편 (ADR-0090, 2026-10-17) — 담보의 옛 「특약 그룹」 칸(special_group · 열거형 E0008)을 없애고 담보분류(category — 열거형 E0009 값 코드)를 더한다.
-- 상품의 그룹 목록(product_groups — 기본 그룹 = 담보분류 값 · 사용자 그룹 = 이름)과 사용자 그룹 소속(product_group_coverages — 상품 × 담보 하나)을 만든다.
-- 옛 값은 옮기지 않는다 — 시드가 만든 것이었다. 기존 DB 는 다시 시드한다(담보분류는 미입력으로 남아 조립 notEntered 로 드러난다).
CREATE TABLE "product_group_coverages" (
	"product_id" uuid NOT NULL,
	"coverage_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "product_group_coverages_product_id_coverage_id_pk" PRIMARY KEY("product_id","coverage_id")
);
--> statement-breakpoint
CREATE TABLE "product_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"kind" text NOT NULL,
	"category_code" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "product_group_coverages" ADD CONSTRAINT "product_group_coverages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_group_coverages" ADD CONSTRAINT "product_group_coverages_group_id_product_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_groups_category" ON "product_groups" USING btree ("product_id","category_code");--> statement-breakpoint
ALTER TABLE "coverages" DROP COLUMN IF EXISTS "special_group";--> statement-breakpoint
ALTER TABLE "coverages" ADD COLUMN "category" text;