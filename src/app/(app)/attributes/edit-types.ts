export interface AttributeEditValue {
  code: string;
  label: string;
  fragment: string;
}

export interface AttributeEditData extends Record<string, unknown> {
  label: string;
  values: AttributeEditValue[];
}

export interface NamingTemplateEditData extends Record<string, unknown> {
  template: string;
}
