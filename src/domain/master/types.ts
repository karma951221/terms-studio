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
 * 값 자리 = **노드 × 마스터 필드**. 그 레벨에 서는 폼의 필드 전부가 모든 노드에 항상 있다 (부착 · 노출여부 · 선택 필드 없음).
 * 미입력 상태로 태어나고 기본값은 프리필뿐이다 (ADR-0004).
 */
import type { AttachLevel, Code, FieldType, Value } from "../types";

/** 마스터 필드 하나. 키는 폼 안에서 유일 · 불변. */
export interface MasterField {
  key: Code;
  label: string;
  type: FieldType;
  /** 기본값 — 폼 프리필 전용 (ADR-0004). 저장소로 자동 유입되지 않는다. */
  defaultValue?: Value;
  description?: string;
  /** 시스템 소유 필드 — 유저 정의 폼이 들어오면 삭제 · 타입 변경 금지의 근거 (ADR-0065 §3). */
  system?: true;
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
