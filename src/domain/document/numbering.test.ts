import { describe, expect, it } from "vitest";

import { nodeBuilders, sequentialIds } from "./builders";
import { surgeryFixture } from "./fixture";
import {
  appendixRefLabel,
  articleLabel,
  articleRefLabel,
  itemLabel,
  numberTree,
  paragraphLabel,
  referenceTargetIndex,
  referenceChunkLabel,
  referenceTargetLabel,
  subitemLabel,
} from "./numbering";

describe("번호 표기 (임시 규칙 — 실물 조사 후 확정)", () => {
  it("조 「제N조」 · 항 원문자 (20 넘으면 (N)) · 호 「N.」 · 목 「가.」", () => {
    expect(articleLabel(3)).toBe("제3조");
    expect(paragraphLabel(1)).toBe("①");
    expect(paragraphLabel(20)).toBe("⑳");
    expect(paragraphLabel(21)).toBe("(21)");
    expect(itemLabel(2)).toBe("2.");
    expect(subitemLabel(1)).toBe("가.");
    expect(subitemLabel(14)).toBe("하.");
    expect(subitemLabel(15)).toBe("(15)");
  });

  it("조 참조 슬롯 「제N조(조 명)」 · 별표 「【별표N(이름)】」", () => {
    expect(articleRefLabel(3, "보험금의 지급사유")).toBe("제3조(보험금의 지급사유)");
    expect(appendixRefLabel(13, "화상 분류표")).toBe("【별표13(화상 분류표)】");
  });

  it("조·항·호·목 참조는 직전 위치와 같은 상위 번호를 생략한다", () => {
    const article = { id: "a1", n: 6, title: "해약환급금" };
    const paragraph1 = { kind: "paragraph" as const, article, paragraph: { id: "p1", n: 1 } };
    const paragraph2 = { kind: "paragraph" as const, article, paragraph: { id: "p2", n: 2 } };
    expect(referenceTargetLabel(paragraph1)).toBe("제6조(해약환급금) 제1항");
    expect(referenceTargetLabel(paragraph2, paragraph1)).toBe("제2항");
    expect(referenceTargetLabel({ kind: "item", article, paragraph: { id: "p1", n: 1 }, item: { id: "i2", n: 2 } }, paragraph1)).toBe("제2호");
    expect(referenceTargetLabel({ kind: "subitem", article, paragraph: { id: "p1", n: 1 }, item: { id: "i2", n: 2 }, subitem: { id: "s1", n: 1 } })).toBe("제6조(해약환급금) 제1항 제2호 제1목");
  });

  describe("다중 참조 덩어리 표기 (기능/문면 §3.5) — 연속 3개 이상은 「부터 … 까지」, 나머지는 쉼표 + 연결어", () => {
    const art = (id: string, n: number) => ({ kind: "article" as const, article: { id, n, title: `조${n}` } });
    const a = { id: "a1", n: 1, title: "첫 조" };
    const par = (id: string, n: number, article = a) => ({ kind: "paragraph" as const, article, paragraph: { id, n } });
    const item = (id: string, n: number, paragraph = { id: "p1", n: 1 }) => ({ kind: "item" as const, article: a, paragraph, item: { id, n } });

    it("조 3개 연속 → 제3조(…)부터 제5조(…)까지", () => {
      expect(referenceChunkLabel([art("a3", 3), art("a4", 4), art("a5", 5)], "및")).toBe("제3조(조3)부터 제5조(조5)까지");
    });

    it("조 2개 연속은 범위가 아니라 연결어로 잇는다", () => {
      expect(referenceChunkLabel([art("a3", 3), art("a4", 4)], "및")).toBe("제3조(조3) 및 제4조(조4)");
      expect(referenceChunkLabel([art("a3", 3), art("a4", 4)], "또는")).toBe("제3조(조3) 또는 제4조(조4)");
    });

    it("연속 구간과 낱개가 섞이면 구간은 하나로 묶고 나머지와 쉼표 · 연결어로 잇는다", () => {
      expect(referenceChunkLabel([art("a3", 3), art("a4", 4), art("a5", 5), art("a7", 7)], "및")).toBe("제3조(조3)부터 제5조(조5)까지 및 제7조(조7)");
      expect(referenceChunkLabel([art("a1", 1), art("a3", 3), art("a4", 4), art("a5", 5), art("a6", 6)], "또는")).toBe("제1조(조1) 또는 제3조(조3)부터 제6조(조6)까지");
      expect(referenceChunkLabel([art("a1", 1), art("a2", 2), art("a3", 3), art("a5", 5), art("a6", 6), art("a7", 7)], "및")).toBe("제1조(조1)부터 제3조(조3)까지 및 제5조(조5)부터 제7조(조7)까지");
    });

    it("연속 판정은 작성 순서대로 — 역순 · 건너뜀은 구간이 아니다", () => {
      expect(referenceChunkLabel([art("a5", 5), art("a4", 4), art("a3", 3)], "및")).toBe("제5조(조5), 제4조(조4) 및 제3조(조3)");
      expect(referenceChunkLabel([art("a3", 3), art("a5", 5), art("a7", 7)], "또는")).toBe("제3조(조3), 제5조(조5) 또는 제7조(조7)");
    });

    it("항 · 호도 같은 상위 안에서만 구간이 된다 — 자리가 같은 조면 조 명은 생략", () => {
      const here = par("p9", 9);
      expect(referenceChunkLabel([par("p1", 1), par("p2", 2), par("p3", 3)], "및", here)).toBe("제1항부터 제3항까지");
      expect(referenceChunkLabel([par("p1", 1), par("p2", 2), par("p3", 3)], "및")).toBe("제1조(첫 조) 제1항부터 제3항까지");
      expect(referenceChunkLabel([item("i1", 1), item("i2", 2), item("i3", 3), item("i5", 5)], "또는", here)).toBe("제1항 제1호부터 제3호까지 또는 제5호");
      // 다른 항의 호 — 번호가 이어져도 상위가 다르면 구간이 아니다
      expect(referenceChunkLabel([item("i1", 1), item("i2", 2), item("j3", 3, { id: "p2", n: 2 })], "및", here)).toBe("제1항 제1호, 제2호 및 제2항 제3호");
    });

    it("다른 조로 넘어가면 구간이 끊긴다 — 조가 달라 번호가 이어져도 별개", () => {
      const b = { id: "a2", n: 2, title: "둘째 조" };
      expect(referenceChunkLabel([par("p1", 1), par("p2", 2), par("q3", 3, b)], "및")).toBe("제1조(첫 조) 제1항, 제2항 및 제2조(둘째 조) 제3항");
    });

    it("대상 하나 · 없음", () => {
      expect(referenceChunkLabel([art("a3", 3)], "및")).toBe("제3조(조3)");
      expect(referenceChunkLabel([], "및")).toBe("");
    });
  });

  it("문서 트리의 참조 가능 조·항·호·목을 계산 번호 경로로 색인한다", () => {
    const b = nodeBuilders(sequentialIds("r"));
    const doc = b.document("d", [b.article("a", [b.paragraph([], [b.item([], [b.subitem([])])])])]);
    const index = referenceTargetIndex(doc, numberTree(doc));
    expect([...index.values()].map((target) => referenceTargetLabel(target))).toEqual(["제1조(a)", "제1조(a) 제1항", "제1조(a) 제1항 제1호", "제1조(a) 제1항 제1호 제1목"]);
  });
});

describe("문면작성 S1·S3 — 번호는 저장하지 않고 현재 트리에서 계산한다", () => {
  it("조·항·호·목 번호를 순서대로 매긴다 — 조건 블록 안의 조도 현재 트리 순서대로 (전체 뷰)", () => {
    const { special } = surgeryFixture();
    const numbers = numberTree(special);
    const view = Object.fromEntries([...numbers].map(([id, n]) => [id, n.label]));
    expect(view).toMatchSnapshot();
    // 조건 블록 안의 「보험기간」 조가 제2조로 끼고, 이후 조가 밀린다
    expect(numbers.get("s-art-term")?.label).toBe("제2조");
    expect(numbers.get("s-art-exempt")?.label).toBe("제3조");
  });

  it("조 자리의 조건 블록 앞에 조를 넣으면 이후 번호가 전부 밀린다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [
      b.article("a", []), // n1
      b.condBlock([b.branch("D0001", [b.article("b", [])])]), // article n2 · branch n3 · cond n4
      b.article("c", []), // n5
    ]);
    expect(numberTree(doc).get("n5")?.n).toBe(3);
    const withFront = { ...doc, children: [b.article("z", []), ...doc.children] };
    expect(numberTree(withFront).get("n5")?.n).toBe(4);
    expect(numberTree(withFront).get("n2")?.n).toBe(3);
  });

  it("사전평가 S1 경계 — 안 타는(notTaken) 가지의 조는 번호에서 빠져 이후 조가 당겨진다", () => {
    const { special } = surgeryFixture();
    const numbers = numberTree(special, { branchStates: new Map([["s-cond-term-if", "notTaken"]]) });
    expect(numbers.has("s-art-term")).toBe(false);
    expect(numbers.get("s-art-exempt")?.label).toBe("제2조");
    // 미결·오류 가지는 뺄 수 없다 — 그대로 센다
    const undetermined = numberTree(special, { branchStates: new Map([["s-cond-term-if", "undetermined"]]) });
    expect(undetermined.get("s-art-term")?.label).toBe("제2조");
  });

  it("공용조항 block 참조는 항 1개로 센다 (임시 — 실제 항 수는 조립이 안다)", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const doc = b.document("d", [b.article("a", [b.paragraph([]), b.clauseBlock("C001", {}), b.paragraph([])])]);
    const numbers = numberTree(doc);
    expect(numbers.get("n1")?.label).toBe("①");
    expect(numbers.get("n2")?.label).toBe("②");
    expect(numbers.get("n3")?.label).toBe("③");
  });
});

describe("관 · 단항 조 (기능/문면 §3.2)", () => {
  it("관은 제N관, 조 번호는 관을 넘어 연속이고 표·박스는 번호가 없다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const t = b.table({ columns: [{}], rows: [] });
    const s1 = b.section("목적", [b.article("A", [b.paragraph([b.text("x")]), t])]);
    const s2 = b.section("지급", [b.article("B", [b.paragraph([b.text("y")]), b.paragraph([b.text("z")])])]);
    const doc = b.document("D", [s1, s2]);
    const n = numberTree(doc);
    expect(n.get(s1.id)).toEqual({ kind: "section", n: 1, label: "제1관" });
    expect(n.get(s2.id)).toEqual({ kind: "section", n: 2, label: "제2관" });
    expect(n.get(s1.children[0].id)?.label).toBe("제1조");
    expect(n.get(s2.children[0].id)?.label).toBe("제2조");
    expect(n.has(t.id)).toBe(false);
  });

  it("항이 하나뿐인 조는 항 마커를 찍지 않고, 둘 이상이면 ①②", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const single = b.paragraph([b.text("x")]);
    const p1 = b.paragraph([b.text("y")]);
    const p2 = b.paragraph([b.text("z")]);
    const doc = b.document("D", [b.article("A", [single]), b.article("B", [p1, p2])]);
    const n = numberTree(doc);
    expect(n.get(single.id)).toEqual({ kind: "paragraph", n: 1, label: "" });
    expect(n.get(p1.id)?.label).toBe("①");
    expect(n.get(p2.id)?.label).toBe("②");
  });

  it("참조 색인은 관 안의 조도 찾는다", () => {
    const b = nodeBuilders(sequentialIds("n"));
    const a = b.article("A", [b.paragraph([b.text("x")])]);
    const doc = b.document("D", [b.section("관", [a])]);
    const index = referenceTargetIndex(doc, numberTree(doc));
    expect(index.get(a.id)).toEqual({ kind: "article", article: { id: a.id, n: 1, title: "A" } });
  });
});
