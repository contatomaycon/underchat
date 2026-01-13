export const extractFieldValue = (
  field: string | { value: string } | null | undefined
): string => {
  if (field === null || field === undefined) {
    return '';
  }

  if (typeof field === 'object' && 'value' in field) {
    return field.value ?? '';
  }

  if (typeof field === 'string') {
    return field;
  }

  return '';
};
