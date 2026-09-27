import { redirect } from "next/navigation";

/** 옛 메뉴 「유형」 — 열거형변수는 마스터의 둘째 탭으로 옮겼다 (기능/마스터 §4.4 ~ §4.6). */
export default function TypesPage() {
  redirect("/master/enums");
}
