-- 동적표 정의 (기능/동적표 §3.1, 2026-10-17).
--
-- 동적표 = 코드(DT000001, code_sequences kind 'dynTable') · 이름 · 인자(값 인자만) · 열 기준 · 구분 칸 머리글 · 열 머리글 템플릿 네 벌 · 셀 템플릿.
-- 템플릿은 인라인 노드 jsonb (함수조항 본문과 같은 결). 새 테이블이라 이관은 없다 — 시드는 다음 단계.
CREATE TABLE "dyn_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"params" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"column_basis" text NOT NULL,
	"row_header" text NOT NULL,
	"headers" jsonb NOT NULL,
	"cell" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "dyn_tables_code_unique" UNIQUE("code")
);
