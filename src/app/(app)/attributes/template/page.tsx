import { getServices } from "@/lib/services";

import { NamingTemplateEditor } from "./NamingTemplateEditor";

export const dynamic = "force-dynamic";

export default async function NamingTemplatePage() {
  const services = getServices();
  const [template, kinds] = await Promise.all([services.product.getNamingTemplate(), services.product.listAttributeKinds()]);
  return <NamingTemplateEditor template={template} kinds={kinds} />;
}
