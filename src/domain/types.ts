/**
 * 도메인 공용 타입 — 2차 구현의 공유 계약.
 *
 * 규칙: 이 파일을 포함한 `src/domain/**` 은 순수 도메인 로직만 담는다.
 * DB(drizzle, pglite, pg)·React·Next 를 import 하지 않는다. (eslint.config.mjs 에서 강제)
 *
 * 여기 있는 것은 여러 모듈이 함께 쓰는 **최소 계약**뿐이다. 모듈 전용 타입은 각 모듈에 둔다.
 * 근거: docs/00_시작/도메인모델.md · docs/기능/구분자/구분자.md · ADR-0004 · ADR-0005 · ADR-0019.
 */

// ───────────────────────────── 식별 ─────────────────────────────

/** 시스템이 자동 채번하는 불변 코드 (ADR-0005). 유저 입력 불가. 저장·참조의 정본. */
export type Code = string;

/** 저장소 행 식별자 (uuid). 코드와 별개 — 코드는 참조용, id 는 저장소용. */
export type Id = string;

/** 조 참조 덩어리의 연결어 — 둘뿐이다 (기능/문면 §3.5). 「,」·자유 입력은 없다. */
export const REFERENCE_CONNECTORS = ["및", "또는"] as const;
export type ReferenceConnector = (typeof REFERENCE_CONNECTORS)[number];
/**
 * 연결어를 아직 안 고른 참조의 표기 자리 (결정 14 — 기본값 없음). 대상이 둘 이상이면 저장 오류라 산출에는 안 나온다 —
 * 편집 중 표기 · 옛 조립 입력의 방어용이다.
 */
export const CONNECTOR_PLACEHOLDER = "〔연결어?〕";
/** 연결어 미선택 저장 오류 문구 — 문서 · 공용조항 본문 검사가 같은 말을 쓴다 (기능/문면 §3.5). */
export const CONNECTOR_REQUIRED_MESSAGE = "조 참조 대상이 둘 이상이면 연결어를 고르세요 (및 · 또는)";
export function isReferenceConnector(value: unknown): value is ReferenceConnector {
  return (REFERENCE_CONNECTORS as readonly unknown[]).includes(value);
}

// ───────────────────────────── 값의 체계 ─────────────────────────────

/** 표 열의 스칼라 타입. period = 개월(정수 · 입력 `3M`/`1Y`) · percent = 0~100 정수. */
export type TableColumnType = "number" | "percent" | "period" | "boolean" | "string";

export interface TableColumn {
  key: Code;
  label: string;
  type: TableColumnType;
}

/** 구조체 필드 타입. 일반 list<T> 는 MVP 제외 — 스칼라 열의 행 목록인 `table` 만 있다 (ADR-0065 §1). */
export type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "date" }
  | { kind: "enum"; enumCode: Code }
  | { kind: "list<enum>"; enumCode: Code }
  | { kind: "table"; columns: readonly TableColumn[] };

export type FieldTypeKind = FieldType["kind"];

/** 스칼라 값. date 는 `YYYY-MM-DD` 문자열. enum 은 enum 값의 코드. */
export type ScalarValue = string | number | boolean;

/** 표 한 행 — 열 키 → 스칼라. */
export type TableRow = Record<string, ScalarValue>;

/** 저장·평가되는 값. list<enum> 은 enum 값 코드 배열, table 은 행 배열. */
export type Value = ScalarValue | string[] | TableRow[];

/** 행 배열인가 (빈 배열은 아니다 — 타입이 갈라 준다). */
export function isTableRows(value: Value): value is TableRow[] {
  return Array.isArray(value) && value.length > 0 && typeof value[0] === "object";
}

/**
 * 값 자리 — null 은 없다. 자리는 「명시 입력된 값」 또는 「미입력」 둘뿐이다 (ADR-0004).
 * 기본값은 여기로 자동 유입되지 않는다 (폼 프리필 전용).
 */
export type ValueSlot =
  | { entered: true; value: Value }
  | { entered: false };

export const NOT_ENTERED: ValueSlot = { entered: false };

export function entered(value: Value): ValueSlot {
  return { entered: true, value };
}

/** 구분자 부착 레벨 5개. 조합 실체(상품담보)에는 정의를 부착하지 않는다. */
export type AttachLevel = "product" | "plan" | "coverage" | "subCoverage" | "benefit";

export const ATTACH_LEVELS: readonly AttachLevel[] = [
  "product",
  "plan",
  "coverage",
  "subCoverage",
  "benefit",
];

/** 부착 레벨의 한글 표시명 (용어사전). */
export const ATTACH_LEVEL_LABEL: Record<AttachLevel, string> = {
  product: "상품",
  plan: "세목",
  coverage: "담보",
  subCoverage: "세부보장",
  benefit: "급부",
};

// ───────────────────────────── dict — 구조 읽기 규칙 (ADR-0070) ─────────────────────────────

/** dict 의 key 규칙 — 구조 key 는 문맥 트리의 자식 노드(id). enum 은 자리만 (ADR-0070 결정 7). */
export type DictKeyRule =
  | { kind: "node"; level: Exclude<AttachLevel, "product"> }
  | { kind: "enum"; enumCode: Code };

/**
 * dict 타입 — 가지. value 는 스칼라 필드 타입 또는 다시 dict. MVP 는 구조 상수가 이 타입으로 적히는 것뿐이다.
 * `FieldType` · `DiscriminatorResultType` 합에는 넣지 않는다 — dict 는 실체가 아니라 읽기 규칙이다 (ADR-0070 결정 1 · 9).
 */
export type DictType = { kind: "dict"; key: DictKeyRule; value: FieldType | DictType };

// ───────────────────────────── 역할·권한 (ADR-0019) ─────────────────────────────

export type Role = "admin" | "editor";

/** 액션을 일으키는 사람. 서비스 계층의 모든 쓰기 액션은 actor 를 첫 인자로 받는다. */
export interface Actor {
  userId: Id;
  role: Role;
}

// ───────────────────────────── 오류 좌표 ─────────────────────────────

/**
 * 오류 좌표 — 조립 오류 패널·완결성 조회·부착 재검사·관계정보 뷰가 공유하는 표기.
 * 문서 종류 → 실체 → 조 → 노드 경로. 모든 항목은 「아는 만큼만」 채운다.
 */
export interface Coordinate {
  /**
   * 문서 종류: 보통약관 / 특별약관(상품담보) / 공용조항 정의 / 담보 마스터 / 상품 /
   * 구분자 정의 — 고치는 자리는 구분자 편집기 (ADR-0049 §4 「원천은 고치면 사라지는 곳」)
   */
  document?: "general" | "special" | "clause" | "coverageMaster" | "product" | "catalog";
  /** 문서를 소유한 실체 — 보통약관 템플릿 id · 상품담보 id · 공용조항 id · 담보 id · 상품 id · 구분자 코드 */
  ownerId?: Id;
  /**
   * 문면 문서 id — 담보약관(`coverageMaster`·`special`)의 오류를 담보 상세가 아니라 그 문서 화면으로 바로 보내기 위한 것.
   * `ownerId` 는 소유 실체(담보 id)라 문서 화면 주소가 되지 못한다 — 문서를 아는 생산자만 채운다.
   */
  documentId?: Id;
  /**
   * 값을 소유한 담보 트리 노드 (담보 · 세부보장 · 급부) — 담보 상세의 그 레벨 탭 · 그 노드 값 폼으로 보내기 위한 것.
   * `nodePath` 는 문면 노드 경로라 뜻이 다르다. 값 소유 노드를 아는 생산자만 채운다.
   */
  node?: { level: "coverage" | "subCoverage" | "benefit"; id: Id };
  /** 사람이 읽을 소유 실체 이름 (상품담보명 등) */
  ownerName?: string;
  /** 상품모델링 좌표에서 상품 아래 선택된 상품담보 등 하위 실체 이름. */
  subjectName?: string;
  /** 0·2+ 모드에서 조 번호가 다시 시작되는 절/보장조항 블록 이름공간. */
  section?: { kind: "general" | "benefit"; label: string };
  /** 조 노드 id */
  articleId?: Id;
  /** 조 명 (계산된 번호는 조립 결과에서만 채운다) */
  articleTitle?: string;
  /** 결과 문서에서 계산된 조 번호. 원천 좌표 표기에는 쓰지 않는다. */
  articleNumber?: number;
  /** 결과 문서에서 계산된 항·호·목 번호 또는 원천에서의 서수. */
  paragraphNumber?: number;
  itemNumber?: number;
  subitemNumber?: number;
  /** 문서 루트에서 해당 노드까지의 노드 id 경로 */
  nodePath?: Id[];
  /** nodePath 마지막 노드의 종류 — 표시 렌더러가 종류를 안정적으로 고를 때 쓴다. */
  nodeKind?: string;
  /** 식 안의 참조 경로 (예: `cov_pay.exempt`) */
  refPath?: string;
}

/** 오류 원인의 종류. 조립·평가·검증이 공통으로 쓴다. */
export type IssueKind =
  | "notEntered" // 미입력 값 참조
  | "unusedAttribute" // 미사용 담보속성 참조
  | "brokenRef" // 깨진 참조 (삭제된 구분자·필드·enum 값·공용조항·조·별표)
  | "articleGone" // 대상 조가 분기로 사라짐
  | "articleHidden" // 상품에서 노출을 끈 보통약관 조를 참조 (기능/상품 §3.6)
  | "optionUnselected" // 공용조항 옵션 미선택
  | "optionInvalid" // 유효 옵션 집합 밖 선택/오버라이드
  | "argUnbound" // 함수조항 인자 연결 누락 — 사용처 연결도 기본 연결도 없음 (최종 결정 2)
  | "noBaseContract" // 기본계약 미지정
  | "noPlan" // 세목 선택지는 있는데 유효 조합이 없다 — 집계 범위가 비어 조건부 조문이 조용히 빠진다
  | "notAttached" // 요구 구분자 미부착 (값 자리 없음)
  | "typeMismatch" // 조건 자리에 boolean 아님 등
  | "unplaced" // 그룹에 배치되지 않은 상품담보
  | "unsupported" // 기획은 확정됐으나 아직 지원하지 않는 조립 모드
  | "unlinkedBaseArticle" // 1개 모드 기본계약 조에 조연결 없음 (warning)
  | "omissionUndecided" // 조연결 자동 판정 보류 — 원문 유지 + 검토 경고 (기능/조립산출 §3.5)
  | "syntax" // 식 문법 오류
  | "structure" // 문면 트리 규칙 위반 (허용 자식 · 인라인 조건 중첩 · 노드 id 중복 · else 위치 등, ADR-0012)
  | "alias"; // 별칭 — 값 하나에 이름 둘, 허용하되 경고 (기능/구분자 §3.2)

export interface Issue {
  kind: IssueKind;
  message: string;
  at: Coordinate;
  /** 결과 완결성을 깨는 오류인지, 수정 권고 경고인지. */
  severity?: "error" | "warning";
  /** 고치러 갈 원천 좌표. `at` 은 조립 결과 자리다. */
  source?: Coordinate;
}

// ───────────────────────────── 결과 ─────────────────────────────

/** 서비스 계층이 돌려주는 거부. 화면 숨김이 아니라 서버 거부의 표현. */
export type Rejection =
  | { reason: "forbidden"; role: Role; action: string } // 역할 거부 (ADR-0019)
  | { reason: "duplicate"; what: string } // 중복 (코드·이름·조합)
  | { reason: "minimumStructure"; what: string } // 최소 구조 위반
  | { reason: "needsConfirmation"; impact: Impact } // 파괴적 액션 — 영향 확인 필요
  | { reason: "invalid"; issues: Issue[] } // 검증 실패
  | { reason: "notFound"; what: string }
  /** 판 충돌 — 편집을 시작한 판과 지금 원본의 판이 다르다 (ADR-0074 결정 4). 잠금은 없다. */
  | { reason: "conflict"; what: string }
  | { reason: "failed"; message: string }; // 건별 실행 실패 — 다중 산출에서 한 건의 예외를 그 건의 거부로 (ADR-0034 결정 7). 검증 거부가 아니다

/** 탑재 상품담보 하나 — 구조 정정이 미치는 상품 (ADR-0075 결정 2). */
export interface MountImpact {
  productId: Id;
  productName: string;
  productCoverageId: Id;
  productCoverageName: string;
  /** 그 상품담보 스냅샷에 입력된 값 행 전체 — 「지금 탑재 상황」 표시용. */
  snapshotValueRows: number;
  /** 삭제될 노드(연쇄 포함)에 해당하는 스냅샷 값 행 — 소실분. 삭제가 없으면 0. */
  snapshotValueRowsLost: number;
}

/** 파괴적 액션의 영향 범위 — 확인 다이얼로그가 보여주는 것. */
export interface Impact {
  /** 소실될 값 행 수 */
  valueRowsLost: number;
  /** 깨질 참조 목록 */
  brokenRefs: Coordinate[];
  /** 함께 삭제될 하위 실체 (이름) */
  cascade: string[];
  /** 탑재 상품담보 — 구조 정정이 미치는 상품 (ADR-0075 결정 2). 담보 구조 계획의 영향에만 실린다. */
  mounts?: MountImpact[];
}

/** 여러 삭제 대상의 영향을 확인 한 번으로 — 저장 한 번에 값 행 여럿을 뺄 때 (점검 2026-09-27 D2). */
export function mergeImpacts(impacts: readonly Impact[]): Impact {
  const mounts = impacts.flatMap((i) => i.mounts ?? []);
  return {
    valueRowsLost: impacts.reduce((n, i) => n + i.valueRowsLost, 0),
    brokenRefs: impacts.flatMap((i) => i.brokenRefs),
    cascade: impacts.flatMap((i) => i.cascade),
    ...(mounts.length > 0 ? { mounts } : {}),
  };
}

export type Result<T> = { ok: true; value: T } | { ok: false; rejection: Rejection };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function reject<T = never>(rejection: Rejection): Result<T> {
  return { ok: false, rejection };
}
