import { getErrorMessage, toError } from '@core/common/functions/toError';

describe('toError', () => {
  it('returns the same Error instance when value is already an Error', () => {
    const original = new Error('boom');

    expect(toError(original)).toBe(original);
    expect(getErrorMessage(original)).toBe('boom');
  });

  it('creates an Error from strings and message objects', () => {
    expect(toError('plain message').message).toBe('plain message');
    expect(toError({ message: 'from object' }).message).toBe('from object');
    expect(getErrorMessage({ message: 'from object' })).toBe('from object');
  });

  it('uses custom toString output when available', () => {
    const value = {
      toString: () => 'custom-value',
    };

    expect(toError(value).message).toBe('custom-value');
    expect(getErrorMessage(value)).toBe('custom-value');
  });

  it('falls back to unknown error for unparseable values', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(toError(circular).message).toBe('Unknown error');
    expect(getErrorMessage(circular)).toBe('Unknown error');
    expect(toError(undefined).message).toBe('Unknown error');
  });
});
