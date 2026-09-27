-- Custom SQL migration file, put your code below! --
-- ADR-0045: 마스터 경로 `레벨.그룹.필드` → `폼키.필드키`
--
-- 구조: 사전 점검(DO 블록 3개 — 하나라도 걸리면 RAISE EXCEPTION 으로 마이그레이션 전체가 롤백된다) → UPDATE.
-- 사전 점검이 실패하면: 메시지의 코드 · 소유자를 보고 사람이 원본을 확인해 그 행을 손으로 고친 뒤 다시 적용한다.
-- 자동으로 덮어쓰지 않는다 — 어느 값이 맞는지 SQL 이 정할 수 없기 때문이다.
--
-- [1] entity_values 혼재 상태: 같은 소유자에 옛 경로와 새 경로가 함께 있으면 UPDATE 중간에 유니크 인덱스
--     (entity_values_slot) 에 걸려 멈춘다. 롤링 배포 · 수동 보정으로 생기는 상태이므로 먼저 0건을 강제한다.
-- [2] entity_values 미지의 옛 키: 세 토막(점 2개 이상) 경로 중 아래 8개 매핑에 없는 것 — 옮길 곳을 모른다.
-- [3] discriminators 리터럴 안전성: 식을 따옴표로 쪼개면 홀수 번째 조각이 식, 짝수 번째가 문자열 리터럴 안이다.
--     리터럴 안에 옛 경로 모양이 든 행은 값이 경로처럼 보이는 것이므로 사람이 봐야 한다.
--     `\'` 이스케이프가 있으면 조각 나누기가 어긋나므로, 백슬래시 · 따옴표 · 옛 경로가 모두 있는 행도 사람에게 넘긴다.
--     이 점검을 지나면 어떤 리터럴에도 옛 경로가 없으므로 아래 regexp_replace 가 리터럴을 건드릴 수 없다.
--
-- 구분자 식은 낱말 경계를 건 regexp_replace 로 바꾼다 — 옛 경로가 식 안에서 낱말로 서 있을 때만 (`plan.waiver.applies`).
--   `\m` = 낱말 시작 (PostgreSQL ARE): `myplan.waiver.x` 같은 다른 식별자의 꼬리는 건드리지 않는다.
--   `\M` = 낱말 끝: `coverage.claim_name_extra` 는 건드리지 않는다.
-- 두 번 돌려도 같다(멱등): 바꾼 뒤의 경로는 어느 패턴에도 다시 걸리지 않고, 사전 점검도 새 상태에서 0건이다.
DO $$
DECLARE hit text;
BEGIN
  SELECT string_agg(o.owner_kind || ':' || o.owner_id || ' ' || m.old_path || ' ↔ ' || m.new_path, ', ')
    INTO hit
    FROM (VALUES
      ('plan.waiver.applies',        'waiver.applies'),
      ('plan.waiver.reasons',        'waiver.reasons'),
      ('plan.no_surrender.type',     'no_surrender.type'),
      ('plan.conversion.converts',   'conversion.converts'),
      ('plan.business_type.applies', 'business_type.applies'),
      ('coverage.claim_name',        'coverage_basic.claim_name'),
      ('benefit.pay.exempt',         'pay.exempt'),
      ('benefit.pay.rate',           'pay.rate')
    ) AS m(old_path, new_path)
    JOIN "entity_values" o ON o.field_path = m.old_path
    JOIN "entity_values" n ON n.owner_kind = o.owner_kind AND n.owner_id = o.owner_id AND n.field_path = m.new_path;
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0006: entity_values 혼재 상태 — 같은 소유자에 옛 경로와 새 경로가 함께 있다. 사람이 보존 값을 정해 한쪽을 지운 뒤 다시 적용한다: %', hit;
  END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE hit text;
BEGIN
  SELECT string_agg(DISTINCT field_path, ', ') INTO hit
    FROM "entity_values"
   WHERE field_path LIKE '%.%.%'
     AND field_path NOT IN ('plan.waiver.applies', 'plan.waiver.reasons', 'plan.no_surrender.type', 'plan.conversion.converts',
                            'plan.business_type.applies', 'coverage.claim_name', 'benefit.pay.exempt', 'benefit.pay.rate');
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0006: entity_values 미지의 옛 키 — 매핑에 없는 세 토막 field_path 가 있다. 옮길 곳을 정해 손으로 고친 뒤 다시 적용한다: %', hit;
  END IF;
END $$;--> statement-breakpoint
DO $$
DECLARE hit text;
BEGIN
  SELECT string_agg(DISTINCT d.code, ', ') INTO hit
    FROM "discriminators" d
    CROSS JOIN LATERAL regexp_split_to_table(d.expression, '''') WITH ORDINALITY AS s(seg, n)
   WHERE d.expression LIKE '%''%'
     AND (n % 2 = 0 OR strpos(d.expression, '\') > 0)
     AND (seg LIKE '%plan.waiver.%' OR seg LIKE '%plan.no_surrender.%' OR seg LIKE '%plan.conversion.%'
          OR seg LIKE '%plan.business_type.%' OR seg LIKE '%coverage.claim_name%' OR seg LIKE '%benefit.pay.%');
  IF hit IS NOT NULL THEN
    RAISE EXCEPTION '0006: discriminators 리터럴 안에 옛 경로 모양이 있다(또는 이스케이프가 섞여 가를 수 없다). 사람이 식을 확인해 고친 뒤 다시 적용한다: %', hit;
  END IF;
END $$;--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'waiver.applies'            WHERE "field_path" = 'plan.waiver.applies';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'waiver.reasons'            WHERE "field_path" = 'plan.waiver.reasons';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'no_surrender.type'         WHERE "field_path" = 'plan.no_surrender.type';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'conversion.converts'       WHERE "field_path" = 'plan.conversion.converts';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'business_type.applies'     WHERE "field_path" = 'plan.business_type.applies';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'coverage_basic.claim_name' WHERE "field_path" = 'coverage.claim_name';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'pay.exempt'                WHERE "field_path" = 'benefit.pay.exempt';--> statement-breakpoint
UPDATE "entity_values" SET "field_path" = 'pay.rate'                  WHERE "field_path" = 'benefit.pay.rate';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mplan\.waiver\.', 'waiver.', 'g')                          WHERE "expression" ~ '\mplan\.waiver\.';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mplan\.no_surrender\.', 'no_surrender.', 'g')              WHERE "expression" ~ '\mplan\.no_surrender\.';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mplan\.conversion\.', 'conversion.', 'g')                  WHERE "expression" ~ '\mplan\.conversion\.';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mplan\.business_type\.', 'business_type.', 'g')            WHERE "expression" ~ '\mplan\.business_type\.';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mcoverage\.claim_name\M', 'coverage_basic.claim_name', 'g') WHERE "expression" ~ '\mcoverage\.claim_name\M';--> statement-breakpoint
UPDATE "discriminators" SET "expression" = regexp_replace("expression", '\mbenefit\.pay\.', 'pay.', 'g')                            WHERE "expression" ~ '\mbenefit\.pay\.';
