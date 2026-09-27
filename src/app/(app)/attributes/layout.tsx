import { NavLink } from "@/app/_components/NavLink";
import { ENTITY_LABEL, FIELD_LABEL } from "@/app/_lib/labels";

export default function AttributesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="ts-types-head">
        <h1 className="ts-h1">{ENTITY_LABEL.attribute}</h1>
        <nav className="ts-subtabs" aria-label={`${ENTITY_LABEL.attribute} 하위 탭`}>
          <NavLink href="/attributes" label={FIELD_LABEL.type} excludePrefix="/attributes/template" />
          <NavLink href="/attributes/template" label={ENTITY_LABEL.namingTemplate} />
        </nav>
      </div>
      {children}
    </div>
  );
}
