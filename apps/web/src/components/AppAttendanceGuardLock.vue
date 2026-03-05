<script setup lang="ts">
import { computed } from 'vue';
import { formatDateTime } from '@core/common/functions/formatDateTime';
import { useAttendanceGuardStore } from '@/@webcore/stores/attendanceGuard';

const attendanceGuardStore = useAttendanceGuardStore();

const todayWindowsLabel = computed(() => {
  return attendanceGuardStore.status?.today_windows_label ?? '--';
});

const nextUnlockLabel = computed(() => {
  const nextUnlockAt = attendanceGuardStore.status?.next_unlock_at ?? null;
  return nextUnlockAt ? formatDateTime(nextUnlockAt) : null;
});

const fallbackMessage = computed(() => {
  return attendanceGuardStore.message || null;
});
</script>

<template>
  <div v-if="attendanceGuardStore.isLocked" class="attendance-lock-overlay">
    <div class="attendance-lock-card">
      <h2 class="attendance-lock-title">
        {{ $t('attendance_guard_locked_title') }}
      </h2>
      <p class="attendance-lock-description">
        {{ fallbackMessage || $t('attendance_guard_locked_description') }}
      </p>

      <div class="attendance-lock-info">
        <div class="attendance-lock-row">
          <span class="attendance-lock-label">
            {{ $t('attendance_guard_today_windows_label') }}
          </span>
          <strong>{{ todayWindowsLabel }}</strong>
        </div>

        <div v-if="nextUnlockLabel" class="attendance-lock-row">
          <span class="attendance-lock-label">
            {{ $t('attendance_guard_next_unlock_label') }}
          </span>
          <strong>{{ nextUnlockLabel }}</strong>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attendance-lock-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(14, 18, 35, 0.86);
  backdrop-filter: blur(3px);
}

.attendance-lock-card {
  width: min(560px, 100%);
  border-radius: 16px;
  padding: 28px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
}

.attendance-lock-title {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
}

.attendance-lock-description {
  margin: 12px 0 20px;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.attendance-lock-info {
  display: grid;
  gap: 12px;
}

.attendance-lock-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  border-radius: 10px;
  padding: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.attendance-lock-label {
  color: rgba(var(--v-theme-on-surface), 0.72);
}
</style>
