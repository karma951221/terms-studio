import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnumDef, EnumLookup } from "@/domain/catalog/types";
import type { MasterForm } from "@/domain/master";
import { entered, type ValueSlot } from "@/domain/types";

import { buildForm } from "./model";
import { StructForm } from "./StructForm";

const 고지유형: EnumDef = {
  code: "E0001",
  label: "고지유형",
  values: [
    { code: "V01", label: "일반심사", order: 0 },
    { code: "V02", label: "간편심사", order: 1 },
  ],
};
const enums: EnumLookup = (c) => (c === "E0001" ? 고지유형 : undefined);

/** 픽스처 마스터 — 급부 레벨에 6 타입을 모두 둔다. */
const master: MasterForm[] = [
  {
    key: "pay",
    label: "보험금지급",
    level: "benefit",
    fields: [
      { key: "exempt", label: "면책여부", type: { kind: "boolean" } },
      { key: "rate", label: "지급률", type: { kind: "number" }, defaultValue: 100 },
      { key: "note", label: "비고", type: { kind: "string" } },
      { key: "since", label: "개시일", type: { kind: "date" } },
      { key: "notice", label: "고지유형", type: { kind: "enum", enumCode: "E0001" } },
      { key: "applied", label: "적용유형", type: { kind: "list<enum>", enumCode: "E0001" } },
    ],
  },
];

function render(current: Map<string, ValueSlot> = new Map()) {
  const model = buildForm("benefit", enums, current, undefined, master);
  return renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
}

/** 태그 하나의 속성 문자열을 뽑는다 — 마크업 검증 보조. */
function tagsWith(html: string, attr: string): string[] {
  return html.match(new RegExp(`<[^>]*${attr}[^>]*>`, "g")) ?? [];
}

describe("StructForm — 마스터 필드 메타만으로 6 타입이 알맞은 입력으로 그려진다 (인수기준 P1)", () => {
  it("string → text · number → number · date → date 입력", () => {
    const html = render();
    expect(tagsWith(html, 'name="pay.note"')[0]).toContain('type="text"');
    expect(tagsWith(html, 'name="pay.rate"')[0]).toContain('type="number"');
    expect(tagsWith(html, 'name="pay.since"')[0]).toContain('type="date"');
  });

  it("boolean → 예/아니오 라디오 (값은 true/false)", () => {
    const radios = tagsWith(render(), 'name="pay.exempt"').filter((t) => t.includes('type="radio"'));
    expect(radios).toHaveLength(2);
    expect(radios.some((t) => t.includes('value="true"'))).toBe(true);
    expect(radios.some((t) => t.includes('value="false"'))).toBe(true);
    expect(render()).toContain("예");
    expect(render()).toContain("아니오");
  });

  it("enum → select — 표시명을 보여주고 값은 코드 (ADR-0005)", () => {
    const html = render();
    const select = html.match(/<select[^>]*name="pay.notice"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toContain('<option value="V01">일반심사</option>');
    expect(select).toContain('<option value="V02">간편심사</option>');
    // 표시명이 값으로 쓰이지 않는다
    expect(select).not.toContain('value="일반심사"');
  });

  it("list<enum> → 체크박스 목록 — 표시명 노출, 값은 코드", () => {
    const html = render();
    const boxes = tagsWith(html, 'name="pay.applied"').filter((t) => t.includes('type="checkbox"'));
    expect(boxes).toHaveLength(2);
    expect(boxes.some((t) => t.includes('value="V01"'))).toBe(true);
    expect(boxes.some((t) => t.includes('value="V02"'))).toBe(true);
  });

  it("필드 라벨은 표시명으로 그려진다", () => {
    const html = render();
    for (const label of ["면책여부", "지급률", "비고", "개시일", "고지유형", "적용유형"]) {
      expect(html).toContain(label);
    }
  });

  it("폼 제목은 레벨 표시명", () => {
    expect(render()).toContain("급부");
  });
});

describe("StructForm — 미입력 · 보이는 제안값 · 비우기 (ADR-0004 · 리뷰 #3)", () => {
  it("미입력 필드마다 「미입력」 배지가 붙는다 — 기본값이 있어도", () => {
    const html = render();
    const badges = html.match(/미입력/g) ?? [];
    expect(badges.length).toBe(6);
  });

  it("저장 값이 있는 필드에는 배지가 없고 값이 채워져 있다", () => {
    const html = render(new Map([["pay.note", entered("메모")]]));
    expect((html.match(/미입력/g) ?? []).length).toBe(5);
    expect(tagsWith(html, 'name="pay.note"')[0]).toContain('value="메모"');
  });

  it("시나리오 1 — 기본값이 폼이 열리자마자 칸에 들어가 있다 (버튼 뒤에 숨지 않는다)", () => {
    const html = render();
    expect(tagsWith(html, 'name="pay.rate"')[0]).toContain('value="100"');
    expect(html).not.toContain("기본값 채우기");
  });

  it("제안값 자리는 「미입력」과 「제안값 · 저장해야 확정」 두 배지를 함께 단다", () => {
    const html = render();
    expect(html).toContain("제안값 · 저장해야 확정");
    // 기본값이 있는 필드는 지급률 하나뿐 → 제안 배지도 하나
    expect((html.match(/제안값 · 저장해야 확정/g) ?? []).length).toBe(1);
  });

  it("저장 값이 있으면 제안 배지가 없다 — 그 값은 사람이 이미 저장한 것이다", () => {
    const html = render(new Map([["pay.rate", entered(80)]]));
    expect(html).not.toContain("제안값 · 저장해야 확정");
    expect(tagsWith(html, 'name="pay.rate"')[0]).toContain('value="80"');
  });

  it("「비우기」는 폼마다 하나다", () => {
    expect((render().match(/비우기/g) ?? []).length).toBe(1);
  });

  it("enum 저장 값은 select 에서 선택돼 있다", () => {
    const html = render(new Map([["pay.notice", entered("V02")]]));
    expect(html).toContain('<option value="V02" selected="">간편심사</option>');
  });

  it("list<enum> 저장 값은 체크돼 있다", () => {
    const html = render(new Map([["pay.applied", entered(["V02"])]]));
    const boxes = tagsWith(html, 'name="pay.applied"');
    expect(boxes.find((t) => t.includes('value="V02"'))).toContain("checked");
    expect(boxes.find((t) => t.includes('value="V01"'))).not.toContain("checked");
  });

  it("제출 버튼이 있다", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"/);
  });
});

describe("StructForm — 입력률 표시 없음", () => {
  it("입력된 값이 있어도 제목에 입력률을 표시하지 않는다", () => {
    const html = render(new Map([["pay.note", entered("메모")]]));
    expect(html).not.toContain('class="ts-count"');
    expect(html).not.toContain("ts-progress");
    expect(html).not.toContain("--value:17");
  });

  it("빈 폼에도 진행 막대를 표시하지 않는다", () => {
    expect(render()).not.toContain("ts-progress");
  });
});

describe("StructForm — 값의 출처 문법 (디자인원칙 §1.2, 리뷰 #47)", () => {
  it("직접값은 실선 테두리 입력 — 모든 입력에 ts-field-direct", () => {
    const html = render();
    expect(tagsWith(html, 'name="pay.note"')[0]).toContain("ts-field-direct");
    expect(tagsWith(html, 'name="pay.notice"')[0]).toContain("ts-field-direct");
  });

  it("손댄 스냅샷은 입력칸 + 되돌리기 버튼, 마스터 값은 tooltip 으로만 준다", () => {
    const model = buildForm(
      "benefit",
      enums,
      new Map<string, ValueSlot>([["pay.rate", entered(80)]]),
      { masterLabel: "수술비(1~7종)[상해]", masterValues: new Map<string, ValueSlot>([["pay.rate", entered(100)]]) },
      master,
    );
    const html = renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
    expect(html).toContain("ts-field-snapshot");
    expect(html).toContain("ts-revert");
    expect(html).toContain("마스터 값으로 되돌리기 · 마스터: 수술비(1~7종)[상해] = 100");
  });

  it("글리프를 문자로 쓰지 않는다 — 되돌리기는 SVG (§1.6)", () => {
    const model = buildForm(
      "benefit",
      enums,
      new Map<string, ValueSlot>([["pay.rate", entered(80)]]),
      { masterLabel: "마스터", masterValues: new Map<string, ValueSlot>([["pay.rate", entered(100)]]) },
      master,
    );
    const html = renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
    expect(html).toContain("<svg");
    for (const glyph of ["\u21ba", "\u2327", "\u0192"]) expect(html).not.toContain(glyph);
  });
});

describe("StructForm — 2열 그리드 (디자인원칙 §2 L2, 리뷰 #51)", () => {
  it("모든 필드가 ts-form-row 다 — 라벨이 값 위에 쌓이는 자리가 없다", () => {
    const html = render();
    expect((html.match(/class="ts-form-row/g) ?? []).length).toBe(6);
    expect(html).not.toContain('class="ts-field"');
  });
});

describe("StructForm — 폼 하나가 카드 하나 · 코드 칩 · 필드 강조 (기능/마스터 §3.5)", () => {
  /** 정본 마스터(MASTER)의 세목 레벨 — 폼 4개. */
  const planModel = () => buildForm("plan", () => undefined, new Map());

  it("폼마다 카드 하나 — 제목은 폼 표시명 (fieldset + aria-label)", () => {
    const html = renderToStaticMarkup(<StructForm model={planModel()} />);
    const cards = tagsWith(html, 'class="ts-form-card"').filter((t) => t.startsWith("<fieldset"));
    expect(cards).toHaveLength(4);
    for (const label of ["납입면제", "무저해지", "계약전환", "영위업종적용"]) {
      expect(cards.some((t) => t.includes(`aria-label="${label}"`))).toBe(true);
    }
    // 폼 설명은 제목 옆에 옅게
    expect(html).toContain("납입면제 사유에 해당하면 이후 보험료를 받지 않는다");
  });

  it("카드 안의 필드는 폼 선언 순 — 첫 카드에 waiver.applies · waiver.reasons", () => {
    const html = renderToStaticMarkup(<StructForm model={planModel()} />);
    const first = html.match(/<fieldset[\s\S]*?<\/fieldset>/)?.[0] ?? "";
    expect(tagsWith(first, 'data-path="').map((t) => t.match(/data-path="([^"]+)"/)?.[1])).toEqual([
      "waiver.applies",
      "waiver.reasons",
    ]);
  });

  it("showCodes 면 필드 옆에 코드 칩 — 마스터 화면 링크", () => {
    const html = renderToStaticMarkup(<StructForm model={planModel()} showCodes />);
    const chip = tagsWith(html, 'class="ts-chip-code ts-mono"')[0];
    expect(chip).toBeDefined();
    expect(chip).toContain('href="/master/waiver.applies"');
    expect(html).toContain(">waiver.applies</a>");
  });

  it("showCodes 가 없으면 칩이 없다", () => {
    const html = renderToStaticMarkup(<StructForm model={planModel()} />);
    expect(html).not.toContain("ts-chip-code");
    expect(html).not.toContain('href="/master/');
  });

  it("highlightPath 의 행에 강조 클래스 — 그 행만", () => {
    const html = renderToStaticMarkup(<StructForm model={planModel()} highlightPath="waiver.reasons" />);
    const rows = tagsWith(html, "ts-field-highlight");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('data-path="waiver.reasons"');
  });

  it("highlightPath 가 없으면 강조 행이 없다", () => {
    expect(renderToStaticMarkup(<StructForm model={planModel()} />)).not.toContain("ts-field-highlight");
  });

  it("폼이 없는 레벨은 빈 안내 하나 · 카드 0", () => {
    const html = renderToStaticMarkup(<StructForm model={buildForm("product", () => undefined, new Map())} />);
    expect(html).toContain("입력할 값 자리가 없습니다.");
    expect(html).not.toContain("<fieldset");
  });
});

describe("StructForm — 여는 폼 카드 (ADR-0065 §4)", () => {
  /** 감액 하나 — table 필드 하나뿐인 여는 폼. */
  const openableMaster: MasterForm[] = [
    {
      key: "reduction",
      label: "감액",
      level: "benefit",
      optional: true,
      fields: [
        {
          key: "periods",
          label: "구간",
          type: { kind: "table", columns: [{ key: "end", label: "기간", type: "period" }, { key: "rate", label: "지급률", type: "percent" }] },
        },
      ],
    },
  ];

  it("닫힌 채 렌더되면 「열기」 버튼과 폼 라벨만 있고 입력칸이 없다", () => {
    const model = buildForm("benefit", enums, new Map(), undefined, openableMaster);
    const html = renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
    expect(html).toContain("감액");
    expect(html).toContain("열기");
    expect(html).not.toContain("닫기");
    expect(html).not.toContain("<table");
    expect(html).not.toContain('name="reduction.periods');
  });

  it("저장 값이 있으면 열린 채 렌더되고 <table> 이 있다", () => {
    const model = buildForm(
      "benefit",
      enums,
      new Map<string, ValueSlot>([["reduction.periods", entered([{ end: 12, rate: 50 }])]]),
      undefined,
      openableMaster,
    );
    const html = renderToStaticMarkup(<StructForm model={model} onSubmit={() => {}} />);
    expect(html).toContain("<table");
    expect(html).toContain("닫기");
    expect(html).not.toContain("열기");
  });

  it("읽기 전용이면 열기·닫기 버튼이 없다", () => {
    const model = buildForm("benefit", enums, new Map(), undefined, openableMaster);
    const html = renderToStaticMarkup(<StructForm model={model} embedded readOnly />);
    expect(html).not.toContain("열기");
    expect(html).not.toContain("닫기");
  });
});
