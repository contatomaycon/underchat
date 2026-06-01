import { describe, expect, it } from '@jest/globals';
import {
  LONG_TEXT_COLLAPSE_LINES,
  resolveLongTextCollapse,
} from '../utils/longTextCollapse';

describe('longTextCollapse', () => {
  it('collapses text longer than the character threshold', () => {
    const state = resolveLongTextCollapse({
      text: 'a'.repeat(421),
      isExpanded: false,
    });

    expect(state.isLongByLength).toBe(true);
    expect(state.shouldClamp).toBe(true);
    expect(state.numberOfLines).toBe(LONG_TEXT_COLLAPSE_LINES);
    expect(state.toggleLabel).toBe('more');
  });

  it('collapses short text with more than eight explicit lines', () => {
    const state = resolveLongTextCollapse({
      text: Array.from({ length: 9 }, (_, index) => `linha ${index}`).join('\n'),
      isExpanded: false,
    });

    expect(state.isLongByExplicitLines).toBe(true);
    expect(state.shouldClamp).toBe(true);
    expect(state.toggleLabel).toBe('more');
  });

  it('does not clamp short unmeasured text before layout reports line count', () => {
    const state = resolveLongTextCollapse({
      text: 'texto curto que pode quebrar no viewport mobile',
      isExpanded: false,
    });

    expect(state.isKnownLong).toBe(false);
    expect(state.shouldClamp).toBe(false);
    expect(state.numberOfLines).toBeUndefined();
    expect(state.toggleLabel).toBeNull();
  });

  it('collapses text measured with more than eight rendered lines', () => {
    const state = resolveLongTextCollapse({
      text: 'texto curto que quebrou em muitas linhas no mobile',
      isExpanded: false,
      measuredLineCount: 9,
    });

    expect(state.isLongByMeasuredLines).toBe(true);
    expect(state.shouldClamp).toBe(true);
    expect(state.toggleLabel).toBe('more');
  });

  it('shows less state without clamping when expanded', () => {
    const state = resolveLongTextCollapse({
      text: 'a'.repeat(421),
      isExpanded: true,
    });

    expect(state.shouldCollapse).toBe(false);
    expect(state.shouldClamp).toBe(false);
    expect(state.numberOfLines).toBeUndefined();
    expect(state.toggleLabel).toBe('less');
  });

  it('keeps forced previews collapsed and non-toggleable', () => {
    const state = resolveLongTextCollapse({
      text: 'a'.repeat(421),
      isExpanded: true,
      forceCollapsed: true,
    });

    expect(state.shouldCollapse).toBe(true);
    expect(state.shouldClamp).toBe(true);
    expect(state.numberOfLines).toBe(LONG_TEXT_COLLAPSE_LINES);
    expect(state.canToggle).toBe(false);
    expect(state.toggleLabel).toBeNull();
  });
});
