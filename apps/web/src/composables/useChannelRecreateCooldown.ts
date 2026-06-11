import { onMounted, onUnmounted, readonly, shallowRef } from 'vue';
import type { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';

type ChannelRecreateCooldown = Pick<
  ListWorkerResponse,
  'recreate_available_at'
>;

const parseAvailableAtMs = (value?: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const formatSeconds = (seconds: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds
  ).padStart(2, '0')}`;
};

export function useChannelRecreateCooldown() {
  const nowMs = shallowRef(Date.now());
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    nowMs.value = Date.now();
  };

  onMounted(() => {
    tick();
    timer = setInterval(tick, 1000);
  });

  onUnmounted(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  const getRecreateCooldownRemainingMs = (
    channel: ChannelRecreateCooldown
  ): number => {
    const availableAtMs = parseAvailableAtMs(channel.recreate_available_at);

    if (!availableAtMs) {
      return 0;
    }

    return Math.max(availableAtMs - nowMs.value, 0);
  };

  const isRecreateCooldownActive = (
    channel: ChannelRecreateCooldown
  ): boolean => getRecreateCooldownRemainingMs(channel) > 0;

  const formatRecreateCooldownRemaining = (
    channel: ChannelRecreateCooldown
  ): string => formatSeconds(getRecreateCooldownRemainingMs(channel) / 1000);

  return {
    nowMs: readonly(nowMs),
    getRecreateCooldownRemainingMs,
    isRecreateCooldownActive,
    formatRecreateCooldownRemaining,
  };
}
