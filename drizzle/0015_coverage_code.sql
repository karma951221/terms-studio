-- 담보코드 COV000001 — 시스템 채번 · 불변 · 유일 (기능/담보 §3.1, 2026-09-27).
-- 기존 담보는 만든 순서(created_at, 동률이면 id)대로 COV000001 부터 채운다. 6자리를 넘는 순번은 자르지 않고 그대로 늘린다.
-- 채번 순번(code_sequences kind 'coverage')은 채운 개수 + 1 에서 이어 간다 — 이미 행이 있으면 더 큰 쪽을 남긴다.
ALTER TABLE "coverages" ADD COLUMN "code" text;--> statement-breakpoint
UPDATE "coverages" AS c SET "code" = 'COV' || CASE WHEN s.n < 1000000 THEN lpad(s.n::text, 6, '0') ELSE s.n::text END
  FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "coverages") AS s
  WHERE c."id" = s."id";--> statement-breakpoint
INSERT INTO "code_sequences" ("kind", "scope", "next")
  SELECT 'coverage', '', count(*) + 1 FROM "coverages"
  ON CONFLICT ("kind", "scope") DO UPDATE SET "next" = greatest("code_sequences"."next", excluded."next");--> statement-breakpoint
ALTER TABLE "coverages" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "coverages" ADD CONSTRAINT "coverages_code_unique" UNIQUE("code");
