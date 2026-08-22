import { getWwebjsRuntimeSafetyReasons } from '@core/common/functions/wwebjsRuntimeSafety';

const EXPECTED_IMAGE = `sha256:${'a'.repeat(64)}`;
const OTHER_IMAGE = `sha256:${'b'.repeat(64)}`;
const TINI_ENTRYPOINT = [
  '/usr/bin/tini',
  '--',
  '/usr/local/bin/worker-liveness-entrypoint',
];

describe('WWebJS runtime safety profile', () => {
  it('detects an immutable image mismatch independently', () => {
    expect(
      getWwebjsRuntimeSafetyReasons({
        currentContentId: OTHER_IMAGE,
        entrypoint: TINI_ENTRYPOINT,
        expectedContentId: EXPECTED_IMAGE,
        pidsLimit: 512,
      })
    ).toEqual(['image_mismatch']);
  });

  it('detects a missing PID-1 reaper independently', () => {
    expect(
      getWwebjsRuntimeSafetyReasons({
        currentContentId: EXPECTED_IMAGE,
        entrypoint: ['docker-entrypoint.sh'],
        expectedContentId: EXPECTED_IMAGE,
        pidsLimit: 512,
      })
    ).toEqual(['tini_missing']);
  });

  it('detects an absent PID ceiling independently', () => {
    expect(
      getWwebjsRuntimeSafetyReasons({
        currentContentId: EXPECTED_IMAGE,
        entrypoint: TINI_ENTRYPOINT,
        expectedContentId: EXPECTED_IMAGE,
        pidsLimit: null,
      })
    ).toEqual(['pids_limit_missing']);
  });

  it('accepts the current immutable image with tini and a positive PID ceiling', () => {
    expect(
      getWwebjsRuntimeSafetyReasons({
        currentContentId: EXPECTED_IMAGE,
        entrypoint: TINI_ENTRYPOINT,
        expectedContentId: EXPECTED_IMAGE,
        pidsLimit: 512,
      })
    ).toEqual([]);
  });
});
