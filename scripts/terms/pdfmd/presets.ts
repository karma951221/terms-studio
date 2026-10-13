/**
 * 생성 범위 묶음 — `npm run terms:pdfmd -- --preset <이름>` 이 다시 만드는 fixture 목록.
 *
 * 원문(`src`)은 `docs/_자료/`(gitignore, 메인 체크아웃에만 있음)이고 산출물(`out`)은 커밋한다.
 * 탑재 범위를 넓히려면 `only` 에 이름을 더하거나 `only: "all"` 로 둔다(주계약 특별약관 파일 하나 전체).
 */
export interface PresetJob {
  /** 원문 파일 — 리포 뿌리 기준. */
  src: string;
  /** 특약 이름(원문 `## N. 이름` 의 이름 · 「특별약관」 뺀 이름 · fixture 파일명 중 하나) 또는 전체. */
  only: string[] | "all";
}

export interface Preset {
  out: string;
  jobs: PresetJob[];
}

const ALPHA2607 = "docs/_자료/알파Plus보장보험2607/00_주계약";

export const PRESETS: Record<string, Preset> = {
  /**
   * 알파Plus보장보험2607 — 보통약관 + 주계약 특별약관(Ⅰ 상해 · Ⅱ 질병 · Ⅲ 상해 및 질병 전부 …). 손으로 설정하지 않은 특약은 자동 탑재(config `ALPHA2607_AUTO`).
   * 질병 대표는 보통약관 제27조의1 납입면제 사유(암 · 양성뇌종양 · 말기신부전증 · 만성당뇨합병증 · 중대한재생불량성빈혈)와
   * 같은 병을 보장하는 진단비 — 납입면제 재모델링(ADR-0086)과 맞물리고, 구조는 진단비의 정형(지급사유 · 정의 · 소멸 · 준용)이다.
   */
  알파2607: {
    out: "tests/fixtures/terms/알파2607",
    jobs: [
      { src: `${ALPHA2607}/01_보통약관.md`, only: "all" },
      // Ⅰ 상해 — 전부(2604 와 같은 10 · 2604 담보의 갱신형 둘 · 자동 탑재 특약)
      { src: `${ALPHA2607}/02_특별약관_Ⅰ_상해관련.md`, only: "all" },
      // Ⅱ 질병 — 전부(질병 대표 5 · 자동 탑재 특약)
      { src: `${ALPHA2607}/03_특별약관_Ⅱ_질병관련.md`, only: "all" },
      { src: `${ALPHA2607}/04_특별약관_Ⅲ_상해및질병관련.md`, only: "all" },
    ],
  },
};
