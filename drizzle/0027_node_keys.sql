-- 노드 키 (ADR-0087 결정 2 · 11) — 기존 담보는 지금 형제 순서(order, 동률이면 이름 · id)대로 키를 채운다.
-- 세부보장 01 · 02 …(두 자리, 99 를 넘으면 그대로 늘린다), 급부 1 · 2 …(그 세부보장 안). 스냅샷 노드는 마스터 노드의 키를 옮긴다.
-- 주의: 마스터를 잃은 스냅샷 노드(한 번도 동기화되지 않은 옛 행)는 형제 순서로 채우므로, 살아 있는 형제 노드의 키와 같은 키를 받을 수 있다
-- (스냅샷 노드엔 형제 키 유일 색인이 없다). 다음 구조 동기화가 그 행을 지운다 — 이미 적용된 이행이라 동작은 바꾸지 않고 이 주석만 더한다.
ALTER TABLE "sub_coverages" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "sub_coverages" AS s SET "key" = CASE WHEN r.n < 100 THEN lpad(r.n::text, 2, '0') ELSE r.n::text END
  FROM (SELECT "id", row_number() OVER (PARTITION BY "coverage_id" ORDER BY "order", "name", "id") AS n FROM "sub_coverages") AS r
  WHERE s."id" = r."id";--> statement-breakpoint
ALTER TABLE "sub_coverages" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "benefits" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "benefits" AS b SET "key" = r.n::text
  FROM (SELECT "id", row_number() OVER (PARTITION BY "sub_coverage_id" ORDER BY "order", "name", "id") AS n FROM "benefits") AS r
  WHERE b."id" = r."id";--> statement-breakpoint
ALTER TABLE "benefits" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_coverage_nodes" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "product_coverage_nodes" AS p SET "key" = s."key" FROM "sub_coverages" AS s WHERE p."kind" = 'sub' AND p."master_node_id" = s."id";--> statement-breakpoint
UPDATE "product_coverage_nodes" AS p SET "key" = b."key" FROM "benefits" AS b WHERE p."kind" = 'benefit' AND p."master_node_id" = b."id";--> statement-breakpoint
-- 마스터를 잃은 스냅샷 노드(다음 동기화가 지운다)는 형제 순서로 채워 NOT NULL 을 지킨다
UPDATE "product_coverage_nodes" AS p SET "key" = CASE WHEN p."kind" = 'sub' AND r.n < 100 THEN lpad(r.n::text, 2, '0') ELSE r.n::text END
  FROM (SELECT "id", row_number() OVER (PARTITION BY "product_coverage_id", "kind", "parent_id" ORDER BY "order", "id") AS n FROM "product_coverage_nodes") AS r
  WHERE p."id" = r."id" AND p."key" IS NULL;--> statement-breakpoint
ALTER TABLE "product_coverage_nodes" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sub_coverages_sibling_key" ON "sub_coverages" USING btree ("coverage_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "benefits_sibling_key" ON "benefits" USING btree ("sub_coverage_id","key");
