import { defineStore } from 'pinia';
import axios from '@webcore/axios';
import { IApiResponse } from '@core/common/interfaces/IApiResponse';
import {
  UserAttendanceGuardStatus,
  UserAttendanceHoursBlockedData,
} from '@core/schema/user/attendanceHours/shared.schema';
import { getToken } from '@webcore/localStorage/user';

const ATTENDANCE_BLOCK_REASON = 'user_attendance_hours_blocked';
const MIN_TIMER_DELAY_MS = 750;

export const useAttendanceGuardStore = defineStore('attendanceGuard', {
  state: () => ({
    status: null as UserAttendanceGuardStatus | null,
    isLocked: false,
    message: null as string | null,
    clockOffsetMs: 0,
    timerId: null as ReturnType<typeof setTimeout> | null,
    listenersAttached: false,
    visibilityHandler: null as (() => void) | null,
    focusHandler: null as (() => void) | null,
    syncing: false,
  }),
  actions: {
    clearTimer() {
      if (!this.timerId) {
        return;
      }

      clearTimeout(this.timerId);
      this.timerId = null;
    },

    updateClockOffset(status: UserAttendanceGuardStatus) {
      const serverNowMs = Date.parse(status.server_now);
      if (!Number.isFinite(serverNowMs)) {
        this.clockOffsetMs = 0;
        return;
      }

      this.clockOffsetMs = serverNowMs - Date.now();
    },

    getAdjustedNowMs(): number {
      return Date.now() + this.clockOffsetMs;
    },

    scheduleNextTransition() {
      this.clearTimer();

      const nextTransitionAt = this.status?.next_transition_at;
      if (!nextTransitionAt) {
        return;
      }

      const nextTransitionMs = Date.parse(nextTransitionAt);
      if (!Number.isFinite(nextTransitionMs)) {
        return;
      }

      const delay = Math.max(
        MIN_TIMER_DELAY_MS,
        nextTransitionMs - this.getAdjustedNowMs() + 150
      );

      this.timerId = setTimeout(() => {
        void this.syncStatus(true);
      }, delay);
    },

    applyStatus(status: UserAttendanceGuardStatus, message?: string | null) {
      this.status = status;
      this.isLocked = status.is_blocked_now;
      this.message = message ?? null;
      this.updateClockOffset(status);
      this.scheduleNextTransition();
    },

    resetState() {
      this.clearTimer();
      this.status = null;
      this.isLocked = false;
      this.message = null;
      this.clockOffsetMs = 0;
    },

    attachListeners() {
      if (this.listenersAttached || typeof document === 'undefined') {
        return;
      }

      this.visibilityHandler = () => {
        if (document.hidden) {
          return;
        }

        void this.syncStatus(true);
      };

      this.focusHandler = () => {
        void this.syncStatus(true);
      };

      document.addEventListener('visibilitychange', this.visibilityHandler);
      globalThis.addEventListener('focus', this.focusHandler);
      this.listenersAttached = true;
    },

    detachListeners() {
      if (!this.listenersAttached || typeof document === 'undefined') {
        return;
      }

      if (this.visibilityHandler) {
        document.removeEventListener(
          'visibilitychange',
          this.visibilityHandler
        );
      }

      if (this.focusHandler) {
        globalThis.removeEventListener('focus', this.focusHandler);
      }

      this.visibilityHandler = null;
      this.focusHandler = null;
      this.listenersAttached = false;
    },

    async syncStatus(force = false): Promise<UserAttendanceGuardStatus | null> {
      if (!getToken()) {
        this.resetState();
        return null;
      }

      if (this.syncing && !force) {
        return this.status;
      }

      this.syncing = true;

      try {
        const response = await axios.get<
          IApiResponse<UserAttendanceGuardStatus>
        >('/user/me/attendance-hours/status');

        if (!response.data?.status || !response.data?.data) {
          return this.status;
        }

        this.applyStatus(response.data.data, null);

        return response.data.data;
      } catch {
        return this.status;
      } finally {
        this.syncing = false;
      }
    },

    async bootstrap() {
      if (!getToken()) {
        this.detachListeners();
        this.resetState();
        return;
      }

      this.attachListeners();
      await this.syncStatus(true);
    },

    shutdown() {
      this.detachListeners();
      this.resetState();
    },

    applyBlockedError(
      blockedData: UserAttendanceHoursBlockedData,
      message?: string | null
    ): boolean {
      if (
        blockedData.reason !== ATTENDANCE_BLOCK_REASON ||
        !blockedData.attendance_guard
      ) {
        return false;
      }

      this.applyStatus(blockedData.attendance_guard, message ?? null);

      return true;
    },
  },
});
