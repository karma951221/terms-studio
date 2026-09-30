/**
 * 입력 마스터 타입 — 값의 체계 1층 (ADR-0037 · 기능/마스터 §3.1).
 *
 * 마스터 = **폼 › 필드**, 전부 코드가 정본이다. 유저가 정의하지 않는다 — 더하고 바꾸는 것은 배포 + 마이그레이션.
 * 폼은 레벨 **하나**를 갖고 필드는 폼을 따른다. 같은 폼을 두 레벨에 걸지 않는다 (필요하면 폼을 둘 만든다).
 * 폼 하나 = 마스터 화면의 폴더 하나 = 모델링 화면의 카드 하나.
 *
 * 필드 코드(참조 경로 · 값 좌표 · 오류 메시지 · 칩): `폼키.필드키` — 예) `waiver.applies` · `pay.rate`.
 * 폼키가 전역 유일이라 코드도 전역 유일이다. 레벨은 코드에 안 들어간다.
 *
 * 값 자리 = **노드 × 마스터 필드**. 그 레벨에 서는 폼의 필드 전부가 모든 노드에 항상 있다 (부착 · 노출여부 없음).
 * 선택(`optional`)은 마스터 코드가 정한다 — 폼 단위(감액 · 면책)와 필드 단위(면책여부 · 지급률).
 * 미입력 상태로 태어나고 기본값은 프리필뿐이다 (ADR-0004).
 */
import type { AttachLevel, Code, FieldType, Value, ValueSlot } from "../types";

/** 마스터 필드 하나. 키는 폼 안에서 유일 · 불변. */
export interface MasterField {
  key: Code;
  label: string;
  type: FieldType;
  /** 기본값 — 폼 프리필 전용 (ADR-0004). 저장소로 자동 유입되지 않는다. */
  defaultValue?: Value;
  description?: string;
  /** 단위 — 숫자 필드의 입력칸 뒤 · 읽기 값 뒤에 붙는다 (「2.5 %」). 저장 값에는 들어가지 않는다. */
  unit?: string;
  /**
   * 조건부 필드 — 같은 폼의 `field` 가 `equals` 일 때만 자리가 있다 (「고지유형 = 간편심사면 간편심사구분」).
   * 조건이 맞지 않으면 칸을 그리지 않고 · 미입력으로 세지 않고 · 저장 때 값을 지운다 (`isFieldShown`).
   */
  visibleWhen?: FieldCondition;
  /** list<enum> 만 — 같은 폼의 `field` 가 `equals` 면 하나만 고른다(라디오). 여럿이면 체크박스. */
  singleWhen?: FieldCondition;
  /** 시스템 소유 필드 — 유저 정의 폼이 들어오면 삭제 · 타입 변경 금지의 근거 (ADR-0065 §3). */
  system?: true;
  /**
   * 기본 숨김 — 값이 기본값 그대로면 입력 화면·읽기 모드에서 칸을 감추고, 편집 중엔 「{라벨} 바꾸기」 링크로 편다.
   * 숨겨도 값은 프리필 규칙대로 저장에 실린다. 기본값과 다른 값이면 숨기지 않는다 (기능/담보 §3.4 · 2026-09-27).
   */
  hiddenByDefault?: true;
  /**
   * 선택 필드 — 값이 없으면 **자리를 보이지 않는다**. 읽기 모드는 값이 있을 때만, 편집 중엔 폼 아래 「⊕ {라벨}」로 더하고
   * ⊖ 로 뺀다(값을 지운다). 안 더한 선택 필드는 미입력으로 세지 않는다 (`countedSlotsOf`).
   * 여는 폼(`MasterForm.optional`)의 필드 단위판이다 — 정하는 것은 마스터 코드다, 유저가 붙이지 않는다 (기능/마스터 §3.4 · 2026-09-27).
   */
  optional?: true;
}

/** 같은 폼 안 다른 필드의 값 조건 — 필드 키 · 비교 값(열거형이면 값 코드). */
export interface FieldCondition {
  field: Code;
  equals: Value;
}

/** 폼 — 입력 묶음. 키는 전역 유일 · 불변. 레벨 하나. */
export interface MasterForm {
  key: Code;
  label: string;
  level: AttachLevel;
  description?: string;
  /** 화면 순서는 선언 순서다. */
  fields: readonly MasterField[];
  /**
   * 여는 폼 — 노드에 이 폼의 값 행이 하나도 없으면 **자리 자체가 없다**(missing): `exist` 는 false,
   * 완결성은 세지 않고, 집계 없이 직접 읽으면 notAttached. 값 행이 하나라도 있으면 나머지 필드는 보통 자리다.
   * 「감액 표를 열지 않음 = 감액 없음」(기능/담보 §3.4 · ADR-0065 §4)의 구현.
   */
  optional?: true;
  /** 시스템 소유 폼 — 키 · 레벨 · 시스템 필드 잠금의 근거 (ADR-0065 §3). */
  system?: true;
  /**
   * 폼 교차 규칙 — 한 필드의 타입만으로는 안 보이는 필드 사이의 뜻(「적용여부 = 예면 사유 1개 이상」).
   * 값 쓰기가 **최종 상태**(저장된 값 + 이번 제출)로 부르고, 어기면 저장 거부다 (`formRuleIssues`).
   */
  rules?: readonly FormRule[];
}

/** 폼 안 필드 키로 값 자리를 읽는다 — 자리를 모르면 undefined (= 미입력). */
export type FormFieldReader = (fieldKey: Code) => ValueSlot | undefined;

/** 폼 교차 규칙 하나. 어기면 `{ field, message }` — field 는 고치러 갈 필드 키. */
export interface FormRule {
  /** 규칙 한 줄 (마스터 화면 · 문서용). */
  description: string;
  check(read: FormFieldReader): { field: Code; message: string } | undefined;
}

/** 마스터 필드 경로 — `폼키.필드키`. 값 자리이자 식의 참조 경로. */
export type MasterPath = string;

/** 경로가 가리키는 자리 — 폼 · 필드 · (폼의) 레벨을 함께 안다. */
export interface MasterFieldRef {
  path: MasterPath;
  form: MasterForm;
  field: MasterField;
  /** = form.level. 호출부가 매번 폼을 타지 않게 복사해 둔다. */
  level: AttachLevel;
}
