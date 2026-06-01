export const LONG_TEXT_COLLAPSE_LINES = 8;
export const LONG_TEXT_COLLAPSE_CHAR_THRESHOLD = 420;

type ResolveLongTextCollapseInput = {
  text: string;
  isExpanded: boolean;
  measuredLineCount?: number | null;
  forceCollapsed?: boolean;
};

type LongTextCollapseState = {
  isLongByLength: boolean;
  isLongByExplicitLines: boolean;
  isLongByMeasuredLines: boolean;
  isKnownLong: boolean;
  shouldCollapse: boolean;
  shouldClamp: boolean;
  canToggle: boolean;
  numberOfLines: number | undefined;
  toggleLabel: 'more' | 'less' | null;
};

export function countExplicitTextLines(text: string): number {
  if (!text) return 0;

  return text.split(/\r\n|\r|\n/).length;
}

export function resolveLongTextCollapse({
  text,
  isExpanded,
  measuredLineCount,
  forceCollapsed = false,
}: ResolveLongTextCollapseInput): LongTextCollapseState {
  const isLongByLength = text.length > LONG_TEXT_COLLAPSE_CHAR_THRESHOLD;
  const isLongByExplicitLines =
    countExplicitTextLines(text) > LONG_TEXT_COLLAPSE_LINES;
  const isLongByMeasuredLines =
    typeof measuredLineCount === 'number' &&
    measuredLineCount > LONG_TEXT_COLLAPSE_LINES;
  const isKnownLong =
    isLongByLength || isLongByExplicitLines || isLongByMeasuredLines;
  const shouldCollapse = forceCollapsed || !isExpanded;
  const shouldClamp = isKnownLong && shouldCollapse;
  const canToggle = isKnownLong && !forceCollapsed;

  return {
    isLongByLength,
    isLongByExplicitLines,
    isLongByMeasuredLines,
    isKnownLong,
    shouldCollapse,
    shouldClamp,
    canToggle,
    numberOfLines: shouldClamp ? LONG_TEXT_COLLAPSE_LINES : undefined,
    toggleLabel: canToggle ? (shouldCollapse ? 'more' : 'less') : null,
  };
}
