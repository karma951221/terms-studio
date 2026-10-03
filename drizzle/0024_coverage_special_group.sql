-- 특약 그룹을 상품에서 담보 마스터로 (ADR-0080 · 기능/담보 §3.1 · 기능/상품 §3.7, 2026-10-04).
--
-- 그룹 목록은 열거형 「특약 그룹」(E0008 — 데이터라 시드가 만든다)이고, 담보마다 그 값 하나를 고른다(coverages.special_group = 값 코드, null = 그룹 없음).
-- 열거형은 데이터라 FK 를 걸지 않는다 — 지운 값의 코드는 남아 「없는 값」 오류가 된다(기능/열거형 §3.2).
-- 상품별 그룹(special_groups · special_group_members)은 없앤다. 옛 행은 시드가 만든 것이라 옮기지 않는다 — 담보의 그룹은 다시 시드하거나 담보 상세에서 고른다.
DROP TABLE "special_group_members" CASCADE;--> statement-breakpoint
DROP TABLE "special_groups" CASCADE;--> statement-breakpoint
ALTER TABLE "coverages" ADD COLUMN "special_group" text;
