import { redirect } from "next/navigation";

/** 옛 주소 — 열거형변수 생성은 `/enums/new` (기능/열거형 §4.2). */
export default function LegacyMasterEnumNewPage() {
  redirect("/enums/new");
}
