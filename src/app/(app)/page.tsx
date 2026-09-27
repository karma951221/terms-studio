/**
 * 홈 (`/`) — 메뉴를 작업 순서대로 네 열(기준 데이터 → 담보 설계 → 약관 조문 → 상품)에 놓고,
 * 전체를 가로지르는 점검(관계정보)은 아래 띠로 둔다. 카드는 이름 + 한 줄 설명만 — 개수·경고는 싣지 않는다.
 * 구성은 `_lib/menu` — 좌측 내비와 같다. 좌측 내비 제목(`term-studio`)이 이 화면으로 온다. L1 과 같이 경로(제목 줄)는 없다.
 */
import Link from "next/link";

import { IconChevron } from "@/app/_components/icons";
import { MENU_CHECK, MENU_FLOW, type MenuItem } from "@/app/_lib/menu";

function Card({ item }: { item: MenuItem }) {
  return (
    <Link href={item.href} className="ts-home-card">
      <span className="ts-home-card-label">{item.label}</span>
      <span className="ts-home-card-desc">{item.desc}</span>
    </Link>
  );
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
            {group.items.map((item) => (
              <Card key={item.href} item={item} />
            ))}
            {i < MENU_FLOW.length - 1 ? <IconChevron className="ts-home-arrow" /> : null}
          </li>
        ))}
      </ol>
      <section className="ts-home-check">
        <h2 className="ts-home-col-title">{MENU_CHECK.title}</h2>
        {MENU_CHECK.items.map((item) => (
          <Card key={item.href} item={item} />
        ))}
      </section>
    </div>
  );
}
