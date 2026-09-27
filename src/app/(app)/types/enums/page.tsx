import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 조회는 `/enums` (기능/열거형 §4). */
export default function LegacyTypeEnumsPage() {
  redirect("/enums");
}
