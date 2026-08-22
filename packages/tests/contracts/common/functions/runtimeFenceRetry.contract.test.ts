import { runtimeFenceFullJitterDelayMs } from '@core/common/functions/runtimeFenceRetry';

describe('runtimeFenceFullJitterDelayMs', () => {
  it.each([
    { sample: 0, cap: 100, expected: 1 },
    { sample: 0.5, cap: 100, expected: 51 },
    { sample: 0.999, cap: 100, expected: 100 },
    { sample: 1, cap: 100, expected: 100 },
    { sample: -1, cap: 100, expected: 1 },
    { sample: Number.NaN, cap: 100, expected: 1 },
    { sample: 0.5, cap: 0, expected: 1 },
  ])('keeps sample $sample within 1..$cap', ({ sample, cap, expected }) => {
    expect(runtimeFenceFullJitterDelayMs(cap, () => sample)).toBe(expected);
  });

  it('does not synchronize every retry at the exponential cap', () => {
    const samples = [0.01, 0.17, 0.33, 0.51, 0.78, 0.99];
    const delays = samples.map((sample) =>
      runtimeFenceFullJitterDelayMs(2_000, () => sample)
    );

    expect(new Set(delays).size).toBe(samples.length);
    expect(delays.every((delay) => delay >= 1 && delay <= 2_000)).toBe(true);
  });
});
