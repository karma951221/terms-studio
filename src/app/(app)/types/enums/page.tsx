import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 조회는 `/master/enums` (기능/마스터 §4.4 ~ §4.6). */
export default function LegacyTypeEnumsPage() {
  redirect("/master/enums");
}
