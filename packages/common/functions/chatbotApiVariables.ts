const CHATBOT_TEMPLATE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/gu;

const FORBIDDEN_PATH_SEGMENTS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

const CHATBOT_API_OUTPUT = Symbol('chatbot-api-output');

export type ChatbotApiFieldType =
  'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface ChatbotApiDiscoveredField {
  readonly path: string;
  readonly type: ChatbotApiFieldType;
}

export interface ChatbotTemplateResolutionOptions {
  readonly missingValue?: 'empty' | 'error' | 'preserve';
  readonly arrayFormat?: 'human' | 'json';
}

export class ChatbotVariableResolutionError extends Error {
  public readonly code: 'invalid_path' | 'missing_variable';
  public readonly path: string;

  constructor(
    code: 'invalid_path' | 'missing_variable',
    path: string,
    message: string
  ) {
    super(message);
    this.name = 'ChatbotVariableResolutionError';
    this.code = code;
    this.path = path;
  }
}

interface PathResolution {
  readonly found: boolean;
  readonly value: unknown;
}

interface PathSelection {
  readonly found: boolean;
  readonly value: unknown;
}

interface ChatbotApiVariableOutput {
  readonly [CHATBOT_API_OUTPUT]: true;
  readonly body: unknown;
  readonly response: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isApiVariableOutput = (
  value: unknown
): value is ChatbotApiVariableOutput =>
  isRecord(value) &&
  (value as unknown as ChatbotApiVariableOutput)[CHATBOT_API_OUTPUT] === true;

/**
 * Creates the virtual API namespace exposed to templates. The body remains
 * directly addressable while transport metadata lives below `_response`.
 */
export const createChatbotApiVariableOutput = (
  body: unknown,
  response: unknown
): unknown => ({
  [CHATBOT_API_OUTPUT]: true,
  body,
  response,
});

const getFieldType = (value: unknown): ChatbotApiFieldType => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
};

const assertSafePathSegments = (segments: readonly string[]): void => {
  const forbidden = segments.find((segment) =>
    FORBIDDEN_PATH_SEGMENTS.has(segment.toLowerCase())
  );
  if (forbidden) {
    throw new ChatbotVariableResolutionError(
      'invalid_path',
      segments.join('.'),
      `Variable path contains forbidden segment "${forbidden}"`
    );
  }
};

/**
 * Normalizes the dotted path notation used by chatbot API variables.
 * Array markers are presentation-only: `items[].id` resolves as `items.id`.
 */
export const normalizeChatbotVariablePath = (path: string): string[] => {
  const normalized = path
    .trim()
    .replaceAll(/\[(\d+)\]/gu, '.$1')
    .replaceAll('[]', '')
    .replace(/^\.+|\.+$/gu, '');

  if (!normalized) {
    throw new ChatbotVariableResolutionError(
      'invalid_path',
      path,
      'Variable path cannot be empty'
    );
  }

  const segments = normalized.split('.').map((segment) => segment.trim());
  if (segments.some((segment) => segment.length === 0)) {
    throw new ChatbotVariableResolutionError(
      'invalid_path',
      path,
      'Variable path contains an empty segment'
    );
  }

  assertSafePathSegments(segments);
  return segments;
};

const resolveSegments = (
  current: unknown,
  segments: readonly string[]
): PathResolution => {
  if (isApiVariableOutput(current)) {
    if (segments[0] === '_response') {
      return resolveSegments(current.response, segments.slice(1));
    }
    return resolveSegments(current.body, segments);
  }

  if (segments.length === 0) {
    return { found: true, value: current };
  }

  if (Array.isArray(current)) {
    const numericIndex = Number(segments[0]);
    if (
      /^\d+$/u.test(segments[0] ?? '') &&
      Number.isSafeInteger(numericIndex)
    ) {
      if (numericIndex < 0 || numericIndex >= current.length) {
        return { found: false, value: undefined };
      }
      return resolveSegments(current[numericIndex], segments.slice(1));
    }

    let hasResolvedItem = false;
    const projected = current.map((item) => {
      const result = resolveSegments(item, segments);
      if (result.found) {
        hasResolvedItem = true;
        return result.value;
      }
      return null;
    });

    return hasResolvedItem
      ? { found: true, value: projected }
      : { found: false, value: undefined };
  }

  if (!isRecord(current)) {
    return { found: false, value: undefined };
  }

  const [head, ...tail] = segments;
  if (!head || !Object.hasOwn(current, head)) {
    return { found: false, value: undefined };
  }

  return resolveSegments(current[head], tail);
};

export const resolveChatbotVariablePath = (
  variables: Readonly<Record<string, unknown>>,
  path: string
): PathResolution => {
  const segments = normalizeChatbotVariablePath(path);
  return resolveSegments(variables, segments);
};

export const extractChatbotTemplatePaths = (value: string): string[] => {
  const paths = new Set<string>();
  for (const match of value.matchAll(CHATBOT_TEMPLATE_PATTERN)) {
    const path = match[1]?.trim();
    if (!path) continue;
    normalizeChatbotVariablePath(path);
    paths.add(path);
  }
  return [...paths];
};

/**
 * Expands editor-friendly sample keys such as `data_1.cpf` into the nested
 * variable scope consumed by the runtime template resolver.
 */
export const expandChatbotVariableValues = (
  values: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  const expanded: Record<string, unknown> = {};

  for (const [rawPath, value] of Object.entries(values)) {
    const templateMatch = /^\{\{\s*([^{}]+?)\s*\}\}$/u.exec(rawPath);
    const segments = normalizeChatbotVariablePath(
      templateMatch?.[1] ?? rawPath
    );
    let target = expanded;

    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        target[segment] = value;
        return;
      }

      const current = target[segment];
      if (!isRecord(current)) {
        target[segment] = {};
      }
      target = target[segment] as Record<string, unknown>;
    });
  }

  return expanded;
};

const stringifyInterpolatedValue = (
  value: unknown,
  arrayFormat: 'human' | 'json'
): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && arrayFormat === 'human') {
    return value
      .map((item) =>
        isRecord(item) || Array.isArray(item)
          ? JSON.stringify(item)
          : stringifyInterpolatedValue(item, arrayFormat)
      )
      .join(', ');
  }
  return JSON.stringify(value);
};

/**
 * Resolves chatbot templates while preserving the native value when the
 * complete input is one placeholder. Embedded values are rendered to text.
 */
export const resolveChatbotTemplate = (
  value: string,
  variables: Readonly<Record<string, unknown>>,
  options: ChatbotTemplateResolutionOptions = {}
): unknown => {
  const missingValue = options.missingValue ?? 'error';
  const arrayFormat = options.arrayFormat ?? 'json';
  const exactMatch = /^\{\{\s*([^{}]+?)\s*\}\}$/u.exec(value);

  const resolvePath = (path: string, original: string): unknown => {
    const resolved = resolveChatbotVariablePath(variables, path);
    if (resolved.found) return resolved.value;
    if (missingValue === 'empty') return '';
    if (missingValue === 'preserve') return original;
    throw new ChatbotVariableResolutionError(
      'missing_variable',
      path,
      `Variable "${path}" is not available in this flow context`
    );
  };

  if (exactMatch?.[1]) {
    return resolvePath(exactMatch[1].trim(), value);
  }

  return value.replace(CHATBOT_TEMPLATE_PATTERN, (original, rawPath: string) =>
    stringifyInterpolatedValue(
      resolvePath(rawPath.trim(), original),
      arrayFormat
    )
  );
};

export const resolveChatbotTemplateValue = (
  value: unknown,
  variables: Readonly<Record<string, unknown>>,
  options: ChatbotTemplateResolutionOptions = {}
): unknown => {
  if (typeof value === 'string') {
    return resolveChatbotTemplate(value, variables, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      resolveChatbotTemplateValue(item, variables, options)
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveChatbotTemplateValue(item, variables, options),
      ])
    );
  }
  return value;
};

const selectSegments = (
  current: unknown,
  segments: readonly string[]
): PathSelection => {
  if (segments.length === 0) {
    return { found: true, value: current };
  }

  if (Array.isArray(current)) {
    const selected = current.map((item) => {
      const result = selectSegments(item, segments);
      return result.found ? result.value : null;
    });
    const found = selected.some((item) => item !== null);
    return found
      ? { found: true, value: selected }
      : { found: false, value: undefined };
  }

  if (!isRecord(current)) {
    return { found: false, value: undefined };
  }

  const [head, ...tail] = segments;
  if (!head || !Object.hasOwn(current, head)) {
    return { found: false, value: undefined };
  }

  const nested = selectSegments(current[head], tail);
  return nested.found
    ? { found: true, value: { [head]: nested.value } }
    : { found: false, value: undefined };
};

const mergeSelectedValues = (left: unknown, right: unknown): unknown => {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    return Array.from({ length }, (_, index) => {
      const leftValue = left[index];
      const rightValue = right[index];
      if (leftValue === undefined || leftValue === null) return rightValue;
      if (rightValue === undefined || rightValue === null) return leftValue;
      return mergeSelectedValues(leftValue, rightValue);
    });
  }
  if (isRecord(left) && isRecord(right)) {
    const result: Record<string, unknown> = { ...left };
    for (const [key, value] of Object.entries(right)) {
      result[key] = Object.hasOwn(result, key)
        ? mergeSelectedValues(result[key], value)
        : value;
    }
    return result;
  }
  return right;
};

/** Selects response fields while retaining their original JSON structure. */
export const selectChatbotApiResponsePaths = (
  body: unknown,
  paths: readonly string[]
): unknown => {
  let selected: unknown = {};
  let hasSelection = false;

  for (const path of paths) {
    const result = selectSegments(body, normalizeChatbotVariablePath(path));
    if (!result.found) continue;
    selected = hasSelection
      ? mergeSelectedValues(selected, result.value)
      : result.value;
    hasSelection = true;
  }

  return hasSelection ? selected : null;
};

export const discoverChatbotApiResponseFields = (
  body: unknown,
  options: { readonly maxDepth?: number; readonly maxFields?: number } = {}
): ChatbotApiDiscoveredField[] => {
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 20, 50));
  const maxFields = Math.max(1, Math.min(options.maxFields ?? 500, 2000));
  const fields: ChatbotApiDiscoveredField[] = [];

  const visit = (value: unknown, path: string, depth: number): void => {
    if (fields.length >= maxFields || depth > maxDepth) return;
    if (path) fields.push({ path, type: getFieldType(value) });
    if (fields.length >= maxFields || depth === maxDepth) return;

    if (Array.isArray(value)) {
      const sample = value.find((item) => item !== null && item !== undefined);
      if (sample !== undefined) visit(sample, `${path}[]`, depth + 1);
      return;
    }

    if (isRecord(value)) {
      for (const [key, nested] of Object.entries(value)) {
        if (FORBIDDEN_PATH_SEGMENTS.has(key.toLowerCase())) continue;
        visit(nested, path ? `${path}.${key}` : key, depth + 1);
        if (fields.length >= maxFields) return;
      }
    }
  };

  visit(body, '', 0);
  return fields;
};
