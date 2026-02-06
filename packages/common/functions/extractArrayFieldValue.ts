export const extractArrayFieldValue = (
  field:
    | string[]
    | Array<{ value: string }>
    | { value: string }
    | { value: string[] }
    | { value: string[] | null }
    | { value: string | null }
    | null
    | undefined
): string[] => {
  if (field === null || field === undefined) {
    return [];
  }

  if (Array.isArray(field)) {
    if (field.length === 0) {
      return [];
    }
    if (
      field.length > 0 &&
      typeof field[0] === 'object' &&
      field[0] !== null &&
      'value' in field[0]
    ) {
      return (field as Array<{ value: string }>).map((item) => item.value);
    }

    return field as string[];
  }

  if (typeof field === 'object' && 'value' in field) {
    if (field.value === null) {
      return [];
    }
    if (Array.isArray(field.value)) {
      return field.value;
    }
    if (typeof field.value === 'string') {
      return [field.value];
    }
    return [];
  }

  return [];
};
