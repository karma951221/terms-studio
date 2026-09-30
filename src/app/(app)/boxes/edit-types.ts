/** 박스 상세가 들고 다니는 값 — 코드는 불변이라 여기 없다. 줄은 줄 칸 글(한 줄 = 한 줄). */
export interface BoxEditData {
  name: string;
  title: string;
  lines: string;
  [key: string]: unknown;
}
