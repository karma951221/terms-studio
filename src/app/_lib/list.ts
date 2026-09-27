export interface PageSlice<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
}

export function includesQuery(query: string, values: readonly string[]): boolean {
  const q = query.trim().toLocaleLowerCase("ko-KR");
  return q === "" || values.some((value) => value.toLocaleLowerCase("ko-KR").includes(q));
}

export function paginate<T>(items: readonly T[], requestedPage: string | number | undefined, pageSize: number): PageSlice<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const parsed = typeof requestedPage === "number" ? requestedPage : Number(requestedPage);
  const page = Math.min(Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : 1), pageCount);
  return { rows: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageCount };
}

export function changedQuery(current: string, changes: Record<string, string | undefined>, pageParam = "page"): string {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  params.delete(pageParam);
  return params.toString();
}

/** 필터바의 「기준일」에 넣을 오늘(서울). 서버에서 계산해 넘긴다 — client 가 스스로 구하면 hydration 이 어긋난다. */
export function todayInSeoul(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 목록의 「최종수정」 칸 — 날짜만, mono 로 세로줄이 맞게. */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 「YYYY-MM-DD HH:mm」 — 미리보기 산출본의 생성 시각처럼 분 단위가 뜻을 갖는 자리 (기능/조립산출 §3.6).
 * `todayInSeoul` 과 같은 이유로 서울 시각으로 쓴다 — 서버 시간대에 따라 표기가 흔들리면 안 된다.
 */
export function formatDateTime(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  // 일부 런타임은 자정을 "24" 로 낸다 — 00 으로 고정.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}`;
}
