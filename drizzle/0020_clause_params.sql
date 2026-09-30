-- 함수조항 인자 (최종 결정 2 · 기능/함수조항 §3.7, 2026-09-30).
--
-- clauses.params = 인자 선언 배열 `[{ name, type, default? }]` — 본문은 `arg.<이름>` 으로 읽는다. 옛 행은 빈 목록(인자 0개 = 고정 문장)을 받는다.
-- 사용처의 인자 연결은 문서 트리(jsonb)의 함수조항 참조 노드 `bindings` 에 산다 — 스키마 변경 없음.
ALTER TABLE "clauses" ADD COLUMN "params" jsonb DEFAULT '[]'::jsonb NOT NULL;