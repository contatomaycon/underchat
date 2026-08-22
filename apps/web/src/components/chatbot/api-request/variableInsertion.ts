export interface VariableInsertionOptions {
  value: string | null | undefined;
  tag: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  withSpacing?: boolean;
}

export interface VariableInsertionResult {
  value: string;
  cursor: number;
}

const clampSelectionIndex = (
  value: number | null | undefined,
  fallback: number,
  maximum: number
): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 0), maximum);
};

export const insertVariableAtSelection = ({
  value,
  tag,
  selectionStart,
  selectionEnd,
  withSpacing = true,
}: VariableInsertionOptions): VariableInsertionResult => {
  const currentValue = value ?? '';
  const initialStart = clampSelectionIndex(
    selectionStart,
    currentValue.length,
    currentValue.length
  );
  const initialEnd = clampSelectionIndex(
    selectionEnd,
    initialStart,
    currentValue.length
  );
  const start = Math.min(initialStart, initialEnd);
  const end = Math.max(initialStart, initialEnd);
  const before = currentValue.slice(0, start);
  const after = currentValue.slice(end);
  const prefix = withSpacing && before && !/\s$/u.test(before) ? ' ' : '';
  const suffix = withSpacing && after && !/^\s/u.test(after) ? ' ' : '';

  return {
    value: `${before}${prefix}${tag}${suffix}${after}`,
    cursor: before.length + prefix.length + tag.length + suffix.length,
  };
};
