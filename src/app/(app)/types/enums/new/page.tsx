import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 생성은 `/master/enums/new` (기능/마스터 §4.4 ~ §4.6). */
export default function LegacyNewTypeEnumPage() {
  redirect("/master/enums/new");
}
