-- 열거형 유저 정의 필드 (ADR-0078 결정 2 · 기능/열거형 §3.1, 2026-09-30).
--
-- enums.fields = 필드 정의 배열 `[{ key: "F01", label, type: "string" | "boolean", order }]`, enum_values.fields = 필드 코드 → 값.
-- 옛 행은 기본값(필드 없음 · 전부 미입력)을 받는다 — 데이터 이관은 없다. 필드 코드 순번은 code_sequences kind 'enumField' · scope = enum 코드.
ALTER TABLE "enum_values" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "enums" ADD COLUMN "fields" jsonb DEFAULT '[]'::jsonb NOT NULL;