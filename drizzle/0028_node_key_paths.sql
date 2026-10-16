-- 담보약관 문면의 노드 한정자 `@<노드id>` → 노드 키 경로 (ADR-0087 결정 3 · 11).
-- 담보 노드 id 가 저장된 곳은 담보약관 문서 트리 안의 식 문자열뿐이다(조건 · 슬롯 · 거름). 문서의 담보(owner_id)의 노드만 바꾼다 —
-- uuid 는 전역 유일이라 글자 바꾸기가 다른 자리를 건드리지 않는다. 이미 끊어진 옛 id(지운 노드)는 남기고, 식 언어가 「노드 키 경로가 아닙니다」로 드러낸다.
-- 문서 판은 바뀐 문서마다 정확히 1 만 올린다(열린 편집본이 옛 판으로 저장되지 않게 — ADR-0074).
DO $$
DECLARE d record; r record; t text; n text;
BEGIN
  FOR d IN SELECT "id", "owner_id", "tree"::text AS txt FROM "documents" WHERE "kind" = 'special' LOOP
    t := d.txt;
    FOR r IN
      SELECT s."id"::text AS node, s."key" AS path FROM "sub_coverages" s WHERE s."coverage_id" = d."owner_id"
      UNION ALL
      SELECT b."id"::text, s."key" || '.' || b."key"
        FROM "sub_coverages" s JOIN "benefits" b ON b."sub_coverage_id" = s."id" WHERE s."coverage_id" = d."owner_id"
    LOOP
      t := replace(t, '@' || r.node, '@' || r.path);
    END LOOP;
    IF t <> d.txt THEN
      UPDATE "documents" SET "tree" = t::jsonb, "version" = "version" + 1 WHERE "id" = d."id";
    END IF;
  END LOOP;
END $$;
