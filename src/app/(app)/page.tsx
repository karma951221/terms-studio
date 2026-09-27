/**
 * 홈 (`/`) — 메뉴를 작업 순서대로 네 열(기본정보 → 담보 설계 → 약관 조문 → 상품)에 놓고,
 * 전체를 가로지르는 점검(관계정보)은 아래 띠로 둔다. 카드는 이름 + 한 줄 설명만 — 개수·경고는 싣지 않는다.
 * 탭으로 기능 여럿을 묶은 메뉴 항목(「기본정보」 = 열거형 · 폼 · 구분자)은 탭마다 카드 하나로 펼쳐 그 탭으로 간다.
 * 구성은 `_lib/menu` — 좌측 내비와 같다. 좌측 내비 제목(`term-studio`)이 이 화면으로 온다. L1 과 같이 경로(제목 줄)는 없다.
 */
import Link from "next/link";

import { IconChevron } from "@/app/_components/icons";
import { MENU_CHECK, MENU_FLOW, type MenuItem, type MenuLink } from "@/app/_lib/menu";

function Card({ item }: { item: MenuLink }) {
  return (
    <Link href={item.href} className="ts-home-card">
      <span className="ts-home-card-label">{item.label}</span>
      <span className="ts-home-card-desc">{item.desc}</span>
    </Link>
  );
}

/** 탭 묶음 항목은 탭마다 카드 하나, 아니면 항목 자체가 카드. */
function cardsOf(item: MenuItem): readonly MenuLink[] {
  return "tabs" in item ? item.tabs : [{ href: item.href, label: item.label, desc: item.desc }];
}

export default function HomePage() {
  return (
    <div className="ts-home">
      <h1 className="ts-h1">홈</h1>
      <ol className="ts-home-flow">
        {MENU_FLOW.map((group, i) => (
          <li key={group.title} className="ts-home-col">
            <h2 className="ts-home-col-title">
              <span className="ts-home-step">{i + 1}</span>
              {group.title}
            </h2>
            {group.items.flatMap(cardsOf).map((item) => (
              <Card key={item.href} item={item} />
            ))}
            {i < MENU_FLOW.length - 1 ? <IconChevron className="ts-home-arrow" /> : null}
          </li>
        ))}
      </ol>
      <section className="ts-home-check">
        <h2 className="ts-home-col-title">{MENU_CHECK.title}</h2>
        {MENU_CHECK.items.flatMap(cardsOf).map((item) => (
          <Card key={item.href} item={item} />
        ))}
      </section>
    </div>
  );
}
