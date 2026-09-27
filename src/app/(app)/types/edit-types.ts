export interface EnumEditValue { code: string; label: string }
export interface EnumEditData extends Record<string, unknown> { label: string; description: string; values: EnumEditValue[] }
