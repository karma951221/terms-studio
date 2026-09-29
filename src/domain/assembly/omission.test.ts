import { describe, expect, it } from "vitest";

import type { RArticle, RItem, RParagraph, RStatic, SInline, SubstitutedDoc } from "./types";
import { parseRefKey } from "../document/pcode";
import { judgeOmission } from "./omission";

/** 항 — 참조 열쇠(`key`)는 id 그대로 둔다(조립이 매긴 P코드 자리). 가리키는 쪽은 `조id#항id`. */
const paragraph = (id: string, text: string, excludeFromComparison = false): RParagraph<SInline> => ({
  kind: "paragraph",
  id,
  key: id,
  children: [{ kind: "text", id: `${id}-text`, text }],
  ...(excludeFromComparison ? { excludeFromComparison: true } : {}),
});

const at = { document: "special" as const, ownerId: "pc-1" };
/** 참조 슬롯을 품은 항 — `targets` 는 대상 열쇠(조 id · `조id#열쇠`). 조든 항이든 판정기가 코드 유무로 가려낸다 (ADR-0072). */
const refParagraph = (id: string, text: string, targets: string[], scope: "self" | "general" = "self"): RParagraph<SInline> => ({
  kind: "paragraph",
  id,
  key: id,
  children: [
    { kind: "text", id: `${id}-text`, text },
    { kind: "articleRef", id: `${id}-ref`, targets: targets.map(parseRefKey), connector: "및", scope, at },
  ],
});

const article = (id: string, title: string, paragraphs: (RParagraph<SInline> | RStatic<SInline>)[], linkedArticleId?: string): RArticle<SInline> => ({
  kind: "article",
  id,
  title,
  children: paragraphs,
  ...(linkedArticleId ? { linkedArticleId } : {}),
});

const doc = (id: string, children: RArticle<SInline>[]): SubstitutedDoc => ({ kind: "document", id, title: id, children });
const owner = { productCoverageId: "pc-1", productCoverageName: "일반상해사망" };
const record = (extra: Record<string, unknown>) => ({ ...owner, articleId: "s-a", articleTitle: "특약 조", linkedArticleId: "g-a", ...extra });

describe("3차 S4 — 항 단위 생략·준용·통째 판정 (기능/조립산출 §3.5 위치 대조)", () => {
  it("항 수가 같고 i 번째 항끼리 같으면 생략한다 — pairs 전부 일치", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "둘")])]);
    const special = doc("s", [article("s-a", "특약 조", [paragraph("s-1", "하나"), paragraph("s-2", "둘")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    expect(out.doc.children).toEqual([]);
    expect(out.issues).toEqual([]);
    expect(out.records).toEqual([
      record({
        disposition: "omitted",
        pairs: [
          { special: 1, general: 1, matched: true },
          { special: 2, general: 2, matched: true },
        ],
        excludedClauseNodeIds: [],
      }),
    ]);
  });

  it("항 집합은 같은데 순서가 다르면 통째 + 「항 순서가 달라」 경고 — pairs 에 불일치 (기능/조립산출 §3.5 미합의 · 옛 ADR-0020 순서 무관 매칭)", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "둘")])]);
    const original = article("s-a", "특약 조", [paragraph("s-2", "둘"), paragraph("s-1", "하나")], "g-a");
    const out = judgeOmission(doc("s", [original]), general, owner);
    expect(out.doc.children).toEqual([original]);
    expect(out.records).toEqual([
      record({
        disposition: "full",
        reason: "항 순서가 달라 자동 판정하지 않았습니다",
        pairs: [
          { special: 1, general: 1, matched: false },
          { special: 2, general: 2, matched: false },
        ],
        excludedClauseNodeIds: [],
      }),
    ]);
    expect(out.issues).toEqual([
      {
        kind: "omissionUndecided",
        severity: "warning",
        message: "항 순서가 달라 자동 판정하지 않았습니다",
        at: { document: "special", ownerId: "pc-1", ownerName: "일반상해사망", articleId: "s-a", articleTitle: "특약 조", nodePath: ["s-a"] },
      },
    ]);
  });

  it("보통약관 항이 전부 같은 순서로 있고 추가 항이 더 있으면 준용 문장 + 추가 항만 남긴다 — 남는 담보 항은 general null", () => {
    const general = doc("g", [article("g-a", "해약환급금", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")])]);
    const special = doc("s", [article("s-a", "보험금의 감액지급", [paragraph("s-1", "공통 1"), paragraph("s-extra", "추가"), paragraph("s-2", "공통 2")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    const judged = out.doc.children[0];
    expect(judged.kind).toBe("article");
    if (judged.kind !== "article") return;
    expect(judged.children.map((p) => p.id)).toEqual(["s-a::application", "s-extra"]);
    expect(judged.children[0]).toMatchObject({ children: [{ text: "이 특별약관의 보험금의 감액지급은 " }, { kind: "articleRef", scope: "general", targets: [{ articleId: "g-a" }] }, { text: "를 준용합니다." }] });
    expect(out.records[0].disposition).toBe("applied");
    expect(out.records[0].pairs).toEqual([
      { special: 1, general: 1, matched: true },
      { special: 2, general: null, matched: false },
      { special: 3, general: 2, matched: true },
    ]);
    expect(out.issues).toEqual([]);
  });

  it("보통약관 항이 전부 있어도 상대 순서가 다르면 준용하지 않는다 — 통째 + 「항 순서가 달라」", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")])]);
    const original = article("s-a", "특약 조", [paragraph("s-2", "공통 2"), paragraph("s-extra", "추가"), paragraph("s-1", "공통 1")], "g-a");
    const out = judgeOmission(doc("s", [original]), general, owner);
    expect(out.doc.children).toEqual([original]);
    expect(out.records[0].disposition).toBe("full");
    expect(out.records[0].reason).toBe("항 순서가 달라 자동 판정하지 않았습니다");
  });

  it("보통약관 항 중 없는 것이 있으면 통째로 유지한다 — 경고 없음 (미합의 아님)", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통"), paragraph("g-2", "없음")])]);
    const original = article("s-a", "특약 조", [paragraph("s-1", "공통"), paragraph("s-x", "특약")], "g-a");
    const out = judgeOmission(doc("s", [original]), general, owner);
    expect(out.doc.children).toEqual([original]);
    expect(out.records[0]).toEqual(
      record({
        disposition: "full",
        pairs: [
          { special: 1, general: 1, matched: true },
          { special: 2, general: 2, matched: false },
        ],
        excludedClauseNodeIds: [],
      }),
    );
    expect(out.issues).toEqual([]);
  });

  it("보통약관 block 함수조항의 비교 제외 항은 판정 집합에서 빼고 참조 노드 id 를 기록한다", () => {
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통"), paragraph("g-clause/g-x", "제외", true)])]);
    const special = doc("s", [article("s-a", "특약 조", [paragraph("s-1", "공통")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    expect(out.records[0].disposition).toBe("omitted");
    expect(out.records[0].pairs).toEqual([{ special: 1, general: 1, matched: true }]);
    expect(out.records[0].excludedClauseNodeIds).toEqual(["g-clause"]);
  });
});

describe("기능/조립산출 §3.5 미합의 사례 — 원문 유지 + warning 하나 (표 순서대로 첫 사유만)", () => {
  const undecided = (special: RArticle<SInline>, general: RArticle<SInline>) => {
    const out = judgeOmission(doc("s", [special]), doc("g", [general]), owner);
    return { out, reason: out.records[0].reason, kinds: out.issues.map((i) => [i.kind, i.severity, i.message]) };
  };

  it("같은 항 두 번 (담보 쪽) → 통째 + 「같은 항이 반복돼 …」", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "둘")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), paragraph("s-2", "둘"), paragraph("s-3", "하나")], "g-a");
    const { out, reason, kinds } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBe("같은 항이 반복돼 자동 판정하지 않았습니다");
    expect(kinds).toEqual([["omissionUndecided", "warning", "같은 항이 반복돼 자동 판정하지 않았습니다"]]);
  });

  it("같은 항 두 번 (보통약관 쪽) → 통째 + 「같은 항이 반복돼 …」 — 리터럴 동일해도 생략하지 않는다", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "하나")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), paragraph("s-2", "하나")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(reason).toBe("같은 항이 반복돼 자동 판정하지 않았습니다");
  });

  it("준용에서 보통약관 항이 담보 조에 두 번 나오면 준용하지 않는다 (정확히 한 번 조건 — 반복 사유가 먼저 걸린다)", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), paragraph("s-x", "추가"), paragraph("s-2", "하나")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("full");
    expect(out.doc.children).toEqual([special]);
    expect(reason).toBe("같은 항이 반복돼 자동 판정하지 않았습니다");
  });

  it("항 참조 슬롯(대상이 항·호·목)을 품은 항 → 통째 + 「항 참조를 품은 항이라 생략하면 참조가 끊깁니다」", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), refParagraph("g-2", "앞 항의 사유로 ", ["g-a#g-1"], "general")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), refParagraph("s-2", "앞 항의 사유로 ", ["g-a#g-1"], "general")], "g-a");
    const { out, reason, kinds } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(reason).toBe("항 참조를 품은 항이라 생략하면 참조가 끊깁니다");
    expect(kinds).toEqual([["omissionUndecided", "warning", "항 참조를 품은 항이라 생략하면 참조가 끊깁니다"]]);
  });

  it("호 참조도 항 참조로 본다 — 대상 노드 종류로 가른다", () => {
    const item = (id: string): RItem<SInline> => ({ kind: "item", id, key: id, children: [{ kind: "text", id: `${id}-t`, text: "호" }] });
    const general = article("g-a", "일반 조", [{ ...paragraph("g-1", "하나"), items: [item("g-i1")] }, refParagraph("g-2", "위 호에 따라 ", ["g-a#g-i1"], "general")]);
    const special = article("s-a", "특약 조", [{ ...paragraph("s-1", "하나"), items: [item("s-i1")] }, refParagraph("s-2", "위 호에 따라 ", ["g-a#g-i1"], "general")], "g-a");
    expect(undecided(special, general).reason).toBe("항 참조를 품은 항이라 생략하면 참조가 끊깁니다");
  });

  it("준용에서 남는 담보 항의 참조는 사유가 아니다 — 지워질 항만 본다 (남는 항은 문서에 그대로 선다)", () => {
    const general = article("g-a", "해약환급금", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "공통 1"), paragraph("s-2", "공통 2"), refParagraph("s-3", "감액 시 ", ["g-a#g-1", "g-a#g-2"], "general")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("applied");
    expect(reason).toBeUndefined();
    expect(out.issues).toEqual([]);
  });

  it("리터럴로 맞지 않는 조는 참조·표가 있어도 경고 없이 통째 — 「왜 안 지웠나」의 답이 내용 차이라서", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나")]);
    const special = article("s-a", "특약 조", [refParagraph("s-1", "전혀 다른 ", ["g-a"], "general")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBeUndefined();
    expect(out.issues).toEqual([]);
  });

  it("조 참조 슬롯을 품은 항 → 통째 + 「참조 · 표를 품은 항은 자동 판정하지 않았습니다」", () => {
    const general = article("g-a", "일반 조", [refParagraph("g-1", "보통약관 ", ["g-other"], "general")]);
    const special = article("s-a", "특약 조", [refParagraph("s-1", "보통약관 ", ["g-other"], "general")], "g-a");
    const out = judgeOmission(doc("s", [special]), doc("g", [general, article("g-other", "다른 조", [paragraph("g-o1", "본문")])]), owner);
    expect(out.doc.children).toEqual([special]);
    expect(out.records[0].reason).toBe("참조 · 표를 품은 항은 자동 판정하지 않았습니다");
    expect(out.issues.map((i) => i.message)).toEqual(["참조 · 표를 품은 항은 자동 판정하지 않았습니다"]);
  });

  it("표 노드를 품은 조 → 통째 + 「참조 · 표를 품은 항은 …」 (같은 표라도 자동 판정하지 않는다)", () => {
    const table: RStatic<SInline> = { kind: "table", id: "t", columns: [{}], rows: [{ cells: [[{ kind: "text", id: "t-c", text: "셀" }]] }] };
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), { ...table, id: "g-t" }]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), { ...table, id: "s-t" }], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(reason).toBe("참조 · 표를 품은 항은 자동 판정하지 않았습니다");
  });

  it("pairs 의 서수는 렌더 항 번호 — 표·박스는 항으로 세지 않고 종류(kind)로 표시한다 (표 뒤의 첫 항은 제1항)", () => {
    const table: RStatic<SInline> = { kind: "table", id: "t", columns: [{}], rows: [{ cells: [[{ kind: "text", id: "t-c", text: "셀" }]] }] };
    const general = article("g-a", "일반 조", [{ ...table, id: "g-t" }, paragraph("g-1", "하나")]);
    const special = article("s-a", "특약 조", [{ ...table, id: "s-t" }, paragraph("s-1", "하나")], "g-a");
    const { out } = undecided(special, general);
    expect(out.records[0].pairs).toEqual([
      { special: 1, general: 1, matched: true, specialKind: "table", generalKind: "table" },
      { special: 1, general: 1, matched: true },
    ]);
  });

  it("준용에서 남는 표는 원본 배열 자리로 남긴다 — 표시 번호(표 1)와 keep 인덱스(0)가 다르다", () => {
    const table: RStatic<SInline> = { kind: "table", id: "s-t", columns: [{}], rows: [{ cells: [[{ kind: "text", id: "t-c", text: "셀" }]] }] };
    const general = doc("g", [article("g-a", "일반 조", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")])]);
    const special = doc("s", [article("s-a", "특약 조", [table, paragraph("s-1", "공통 1"), paragraph("s-2", "공통 2")], "g-a")]);
    const out = judgeOmission(special, general, owner);
    expect(out.records[0].disposition).toBe("applied");
    const judged = out.doc.children[0];
    if (judged.kind !== "article") throw new Error("article expected");
    expect(judged.children.map((p) => p.id)).toEqual(["s-a::application", "s-t"]);
    expect(out.records[0].pairs).toEqual([
      { special: 1, general: null, matched: false, specialKind: "table" },
      { special: 1, general: 1, matched: true },
      { special: 2, general: 2, matched: true },
    ]);
  });

  it("비교 제외된 보통약관 항 안의 참조·표는 사유가 되지 않는다", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), { ...refParagraph("g-c/x", "참조 ", ["g-a#g-1"]), excludeFromComparison: true }]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("omitted");
    expect(reason).toBeUndefined();
    expect(out.issues).toEqual([]);
  });

  it("한 조에 사유가 여럿이면 표 순서의 첫 사유 하나만 — 반복이 순서보다 먼저", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), paragraph("g-2", "둘"), paragraph("g-3", "둘")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "둘"), paragraph("s-2", "하나"), paragraph("s-3", "둘")], "g-a");
    const { reason, kinds } = undecided(special, general);
    expect(reason).toBe("같은 항이 반복돼 자동 판정하지 않았습니다");
    expect(kinds).toHaveLength(1);
  });

  it("자기 문서 항 참조 — 양쪽 id 가 달라 리터럴로는 안 맞아도 참조를 빼고 보면 같으면 「항 참조를 품은 …」 (셋째 줄)", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "하나"), refParagraph("g-2", "앞 항의 사유로 ", ["g-a#g-1"])]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "하나"), refParagraph("s-2", "앞 항의 사유로 ", ["s-a#s-1"])], "g-a");
    const { out, reason, kinds } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBe("항 참조를 품은 항이라 생략하면 참조가 끊깁니다");
    expect(kinds).toHaveLength(1);
  });

  it("조 참조의 대상 id 가 달라도 참조를 빼고 보면 같으면 「참조 · 표를 품은 …」 (넷째 줄)", () => {
    const general = article("g-a", "일반 조", [refParagraph("g-1", "이 약관의 ", ["g-other"])]);
    const special = article("s-a", "특약 조", [refParagraph("s-1", "이 약관의 ", ["s-other"])], "g-a");
    const out = judgeOmission(doc("s", [special, article("s-other", "다른 조", [paragraph("s-o1", "본문")])]), doc("g", [general, article("g-other", "다른 조", [paragraph("g-o1", "본문")])]), owner);
    expect(out.records[0].disposition).toBe("full");
    expect(out.records[0].reason).toBe("참조 · 표를 품은 항은 자동 판정하지 않았습니다");
    expect(out.issues.map((i) => i.message)).toEqual(["참조 · 표를 품은 항은 자동 판정하지 않았습니다"]);
  });

  it("참조를 빼고 봐도 다르면 경고 없이 통째 — 참조 무시 대조는 셋째·넷째 사유의 문일 뿐", () => {
    const general = article("g-a", "일반 조", [refParagraph("g-1", "이 약관의 ", ["g-other"])]);
    const special = article("s-a", "특약 조", [refParagraph("s-1", "저 약관의 ", ["g-other"], "general")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBeUndefined();
    expect(out.issues).toEqual([]);
  });

  it("준용에서 남는 담보 항이 지워질(같은 조 안의) 항을 가리키면 준용하지 않는다 — 통째 + 「항 참조를 품은 …」 (렌더의 articleGone 을 만들지 않는다)", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "공통 1"), paragraph("g-2", "공통 2")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "공통 1"), paragraph("s-2", "공통 2"), refParagraph("s-3", "위 ", ["s-a#s-1"])], "g-a");
    const { out, reason, kinds } = undecided(special, general);
    expect(out.doc.children).toEqual([special]);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBe("항 참조를 품은 항이라 생략하면 참조가 끊깁니다");
    expect(kinds).toHaveLength(1);
  });

  it("보통약관 항이 담보 조보다 많으면 통째 — 남는 보통약관 항은 special null 행으로 근거에 남는다", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "A"), paragraph("g-2", "B"), paragraph("g-3", "C")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "A"), paragraph("s-2", "B")], "g-a");
    const { out, reason } = undecided(special, general);
    expect(out.records[0].disposition).toBe("full");
    expect(reason).toBeUndefined();
    expect(out.records[0].pairs).toEqual([
      { special: 1, general: 1, matched: true },
      { special: 2, general: 2, matched: true },
      { special: null, general: 3, matched: false },
    ]);
  });

  it("pairs 의 서수는 조 안 실제 자리(항 번호) — 비교 제외 항이 중간에 끼어도 어긋나지 않는다", () => {
    const general = article("g-a", "일반 조", [paragraph("g-1", "A"), paragraph("g-clause/x", "제외", true), paragraph("g-3", "B")]);
    const special = article("s-a", "특약 조", [paragraph("s-1", "A"), paragraph("s-2", "B")], "g-a");
    const { out } = undecided(special, general);
    expect(out.records[0].disposition).toBe("omitted");
    expect(out.records[0].pairs).toEqual([
      { special: 1, general: 1, matched: true },
      { special: 2, general: 3, matched: true },
    ]);
    expect(out.records[0].excludedClauseNodeIds).toEqual(["g-clause"]);
  });
});
