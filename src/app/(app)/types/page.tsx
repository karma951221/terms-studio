import { redirect } from "next/navigation";

/** 옛 메뉴 「유형」 — 열거형변수는 메뉴 「열거형」으로 옮겼다 (기능/열거형 §4). */
export default function TypesPage() {
  redirect("/enums");
}
