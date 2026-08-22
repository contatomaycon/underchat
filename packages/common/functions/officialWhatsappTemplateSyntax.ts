import type { OfficialTemplateParameterFormat } from '@core/common/interfaces/IOfficialWhatsappTemplate';

const META_TEMPLATE_PLACEHOLDER_CANDIDATE_PATTERN = /\{\{([^{}]*)\}\}/gu;
const META_TEMPLATE_NAMED_PARAMETER_PATTERN = /^[a-z][a-z0-9_]*$/u;
const META_TEMPLATE_POSITIONAL_PARAMETER_PATTERN = /^[1-9]\d*$/u;

export const META_TEMPLATE_PLACEHOLDER_PATTERN =
  /\{\{([1-9]\d*|[a-z][a-z0-9_]*)\}\}/gu;

export interface OfficialWhatsappTemplateSyntaxInspection {
  valid: boolean;
  tokens: string[];
}

export const hasExactOfficialWhatsappTemplatePlaceholderBoundaries = (
  text: string,
  index: number,
  length: number
): boolean => text[index - 1] !== '{' && text[index + length] !== '}';

const isTokenValidForFormat = (
  token: string,
  parameterFormat: OfficialTemplateParameterFormat
): boolean =>
  parameterFormat === 'NAMED'
    ? META_TEMPLATE_NAMED_PARAMETER_PATTERN.test(token)
    : META_TEMPLATE_POSITIONAL_PARAMETER_PATTERN.test(token);

/**
 * Meta Graph only counts canonical placeholders without whitespace inside the
 * braces. Named parameters are lowercase identifiers and positional
 * parameters start at one. A balanced expression such as `{{ greeting }}` is
 * literal template text and must not become a runtime parameter in UnderChat.
 */
export const inspectOfficialWhatsappTemplateTextSyntax = (
  text: string | null | undefined,
  parameterFormat: OfficialTemplateParameterFormat
): OfficialWhatsappTemplateSyntaxInspection => {
  if (!text) {
    return { valid: true, tokens: [] };
  }

  const tokens: string[] = [];
  let valid = true;

  for (const match of text.matchAll(
    META_TEMPLATE_PLACEHOLDER_CANDIDATE_PATTERN
  )) {
    const rawToken = match[1] ?? '';
    const hasExactBoundaries =
      hasExactOfficialWhatsappTemplatePlaceholderBoundaries(
        text,
        match.index,
        match[0].length
      );
    if (!hasExactBoundaries) {
      valid = false;
      continue;
    }

    // Meta treats balanced, non-canonical brace expressions as literal text.
    // In particular, trimming here would turn `{{ greeting }}` into a named
    // parameter even though Graph expects zero BODY parameters for it.
    if (rawToken !== rawToken.trim()) {
      continue;
    }

    const token = rawToken;
    if (!isTokenValidForFormat(token, parameterFormat)) {
      valid = false;
      continue;
    }
    tokens.push(token);
  }

  if (parameterFormat === 'POSITIONAL' && tokens.length > 0) {
    const indexes = [...new Set(tokens.map(Number))].sort((a, b) => a - b);
    if (
      indexes.some(
        (index, position) =>
          !Number.isSafeInteger(index) || index !== position + 1
      )
    ) {
      valid = false;
    }
  }

  const textWithoutCandidates = text.replace(
    META_TEMPLATE_PLACEHOLDER_CANDIDATE_PATTERN,
    ''
  );
  if (
    textWithoutCandidates.includes('{{') ||
    textWithoutCandidates.includes('}}')
  ) {
    valid = false;
  }

  return { valid, tokens };
};

export const inferOfficialWhatsappTemplateParameterFormat = (
  texts: Array<string | null | undefined>
): OfficialTemplateParameterFormat => {
  for (const text of texts) {
    if (!text) continue;
    for (const match of text.matchAll(META_TEMPLATE_PLACEHOLDER_PATTERN)) {
      if (
        !hasExactOfficialWhatsappTemplatePlaceholderBoundaries(
          text,
          match.index,
          match[0].length
        )
      ) {
        continue;
      }
      const token = match[1] ?? '';
      if (META_TEMPLATE_NAMED_PARAMETER_PATTERN.test(token)) {
        return 'NAMED';
      }
    }
  }

  return 'POSITIONAL';
};
