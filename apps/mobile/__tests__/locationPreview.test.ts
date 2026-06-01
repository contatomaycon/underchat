import { describe, expect, it } from '@jest/globals';
import {
  buildLocationPreviewCandidates,
  buildLocationStaticPreviewUrl,
  normalizeLocationCoordinate,
  parseLocationCoordinate,
} from '../utils/locationPreview';

describe('locationPreview', () => {
  it('parses numeric and string coordinates', () => {
    expect(parseLocationCoordinate(-15.5)).toBe(-15.5);
    expect(parseLocationCoordinate(' -15,5 ')).toBe(-15.5);
    expect(parseLocationCoordinate('')).toBeNull();
    expect(parseLocationCoordinate('abc')).toBeNull();
  });

  it('normalizes coordinates with valid ranges and stable precision', () => {
    expect(normalizeLocationCoordinate('12.3456789', '-45.9876543')).toEqual({
      latitude: 12.345679,
      longitude: -45.987654,
    });

    expect(normalizeLocationCoordinate(91, 0)).toBeNull();
    expect(normalizeLocationCoordinate(0, -181)).toBeNull();
    expect(normalizeLocationCoordinate(Number.POSITIVE_INFINITY, 0)).toBeNull();
  });

  it('builds static preview urls with rounded coordinates', () => {
    expect(buildLocationStaticPreviewUrl('12.3456789', '-45.9876543')).toBe(
      'https://static-maps.yandex.ru/1.x/?lang=en-US&ll=-45.987654,12.345679&z=18&l=map&size=600,340'
    );
  });

  it('builds fallback preview candidates only for valid coordinates', () => {
    const candidates = buildLocationPreviewCandidates(
      '12.3456789',
      '-45.9876543'
    );

    expect(candidates).toEqual([
      'https://static-maps.yandex.ru/1.x/?lang=en-US&ll=-45.987654,12.345679&z=18&l=map&size=600,340',
    ]);
    expect(buildLocationPreviewCandidates('x', '-45.9876543')).toEqual([]);
  });
});
