import { ErrorBanner } from "@/app/_components/ErrorBanner";
import { CreateHead, FormRow } from "@/app/_components/FormRow";
import { ENTITY_LABEL, NAME_LABEL, newLabel } from "@/app/_lib/labels";

import { createProductAction } from "../actions";

export const dynamic = "force-dynamic";

const FORM_ID = "create-product";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div>
      <CreateHead title={newLabel(ENTITY_LABEL.product)} formId={FORM_ID} path={[{ label: ENTITY_LABEL.product, href: "/products" }]} banner={<ErrorBanner message={error} />} />
      <form id={FORM_ID} action={createProductAction} className="ts-create-form">
        <FormRow label={NAME_LABEL.product} htmlFor="product-name">
          <input id="product-name" type="text" name="name" required autoFocus />
        </FormRow>
      </form>
    </div>
  );
}
