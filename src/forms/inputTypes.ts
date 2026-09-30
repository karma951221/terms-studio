/**
 * 타입별 입력 부품 공통 Props — `StructForm.tsx` 와 `TableInput.tsx` 가 함께 쓴다.
 *
 * `StructForm.tsx` 밖에 두는 이유: `TableInput` 이 이 타입을 `StructForm` 에서 가져오면
 * `StructForm → TableInput → StructForm` 순환 import 가 된다. `StructForm.tsx` 는 이 파일을
 * re-export 해 기존 `import type { InputProps } from "./StructForm"` 을 그대로 지원한다.
 */
import type { Draft, FieldState } from "./model";

export interface InputProps {
  id: string;
  field: FieldState;
  onEdit: (draft: Draft) => void;
  /** 출처 문법 클래스 — 테두리 있는 입력에만 붙는다 (라디오·체크박스 묶음에는 그릴 상자가 없다). */
  className?: string;
  /**
   * 입력의 `name`. 기본은 필드 경로. 한 문서에 같은 폼이 여러 벌 그려질 때(상품 기본정보의 보험종목 표)
   * 라디오 묶음이 서로 섞이지 않도록 호출부가 접두를 붙여 넘긴다.
   */
  name?: string;
  /** list<enum> 만 — 하나만 고른다(라디오). 조건부 `singleWhen` 이 맞을 때 호출부가 넘긴다. */
  single?: boolean;
}
