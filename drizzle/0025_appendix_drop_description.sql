-- 별표 주석(description) 폐지 (기능/별표 §6.2, 2026-10-10). 쓰인 적 없는 자유 메모 칸 — 실물 시드 21건 모두 빈 값이었다.
-- 다시 살리지 않는다: 값이 있더라도 출력 · 참조 · 검색 어디에도 쓰이지 않았다.
ALTER TABLE "appendices" DROP COLUMN "description";
