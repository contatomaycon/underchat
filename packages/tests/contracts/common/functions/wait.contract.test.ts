import { wait } from '@core/common/functions/wait';

describe('wait', () => {
  it('resolves only after configured milliseconds', async () => {
    jest.useFakeTimers();

    let resolved = false;
    const promise = wait(250).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(249);
    await Promise.resolve();
    expect(resolved).toBe(false);

    jest.advanceTimersByTime(1);
    await promise;
    expect(resolved).toBe(true);

    jest.useRealTimers();
  });
});
