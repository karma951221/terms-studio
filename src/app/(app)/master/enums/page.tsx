import { redirect } from "next/navigation";

/** 옛 주소 — 열거형 조회는 메뉴 「열거형」 `/enums` (기능/열거형 §4.1). */
export default function LegacyMasterEnumsPage() {
  redirect("/enums");
}
