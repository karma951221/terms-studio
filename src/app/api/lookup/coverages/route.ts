/**
 * 담보 찾기 — 검색 입력(콤보박스)의 서버 조회 (디자인원칙 §1.8).
 *
 * 담보 마스터는 상품을 가리지 않고 계속 는다 — 상품담보 탑재 폼마다 전부를 실어 보내지 않고 친 글로 찾는다.
 * 이름 · 담보코드로 거르고 50건까지 (넘으면 `more`). 거르기는 화면과 같은 함수(`comboModel`).
 * 서버 함수(Server Action)는 한 번에 하나씩 차례로 가서 앞 요청을 취소할 수 없어 GET route 로 둔다.
 */
import type { NextRequest } from "next/server";

import { lookupResponse } from "@/app/_components/comboModel";
import { currentActorOrNull, getServices } from "@/lib/services";

export const dynamic = "force-dynamic";

const LIMIT = 50;

export async function GET(request: NextRequest) {
  if (!(await currentActorOrNull())) return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const query = request.nextUrl.searchParams.get("q") ?? "";
  const coverages = await getServices().coverage.listSummaries();
  return Response.json(lookupResponse(coverages.map((c) => ({ value: c.id, label: c.name, hint: c.code })), query, LIMIT));
}
