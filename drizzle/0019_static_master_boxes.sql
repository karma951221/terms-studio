-- 정적 마스터 박스 (최종 결정 9 · 기능/박스 §3.1, 2026-09-30).
--
-- 박스 = 코드(BX000001, code_sequences kind 'box') · 이름(유일) · 제목 · 줄(글 배열). 안에 참조 · 슬롯을 두지 않는다.
-- 새 테이블이라 이관은 없다 — 박스 공용조항(clauses.mode = 'box')은 그대로 공존하고, 옮기는 것은 다음 단계(시드 재생성)다.
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"lines" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "boxes_code_unique" UNIQUE("code"),
	CONSTRAINT "boxes_name_unique" UNIQUE("name")
);
