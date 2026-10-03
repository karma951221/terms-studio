-- 상품 보통약관의 조 사본 (ADR-0079 · 기능/상품 §3.10, 2026-10-03).
--
-- product_article_copies = 보통약관 탭에서 고친 템플릿 조 하나당 한 행(조 노드 하위 트리 jsonb + 만들 때의 템플릿 조 지문). 행이 없는 조는 템플릿을 따른다.
-- products.general_base_version = 이 상품의 보통약관 설정이 기준으로 삼은 템플릿 판 — 지금 판이 더 크면 「템플릿이 바뀌었습니다」.
-- 기존 상품은 지금 템플릿 판으로 채운다(마이그레이션 직후 경고가 서지 않게). 다시 돌려도 같다.
CREATE TABLE "product_article_copies" (
	"product_id" uuid NOT NULL,
	"article_id" text NOT NULL,
	"article" jsonb NOT NULL,
	"template_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "product_article_copies_product_id_article_id_pk" PRIMARY KEY("product_id","article_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "general_base_version" integer;--> statement-breakpoint
ALTER TABLE "product_article_copies" ADD CONSTRAINT "product_article_copies_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "products" SET "general_base_version" = "documents"."version" FROM "documents" WHERE "documents"."id" = "products"."general_document_id";
