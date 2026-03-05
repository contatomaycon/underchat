<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useUsersStore } from '@/@webcore/stores/user';
import { EColor } from '@core/common/enums/EColor';
import { UserAttendanceHoursRule } from '@core/schema/user/attendanceHours/shared.schema';

interface RuleForm {
  id: string;
  weekday: UserAttendanceHoursRule['weekday'] | null;
  start_time: string;
  end_time: string;
}

const props = defineProps<{
  modelValue: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  updated: [];
}>();

const { t } = useI18n();
const usersStore = useUsersStore();

const isLoading = ref(false);
const isSaving = ref(false);
const enabled = ref(false);
const rules = ref<RuleForm[]>([]);

const isVisible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const weekdayOptions = computed(
  () =>
    [
      { title: t('monday'), value: 'monday' },
      { title: t('tuesday'), value: 'tuesday' },
      { title: t('wednesday'), value: 'wednesday' },
      { title: t('thursday'), value: 'thursday' },
      { title: t('friday'), value: 'friday' },
      { title: t('saturday'), value: 'saturday' },
      { title: t('sunday'), value: 'sunday' },
    ] as Array<{ title: string; value: UserAttendanceHoursRule['weekday'] }>
);

const weekdayOrder: Record<UserAttendanceHoursRule['weekday'], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const createLocalId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const createDefaultRule = (): RuleForm => ({
  id: createLocalId(),
  weekday: 'monday',
  start_time: '09:00',
  end_time: '18:00',
});

const resetState = () => {
  enabled.value = false;
  rules.value = [];
};

const closeModal = () => {
  isVisible.value = false;
};

const toMinutes = (value: string): number | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  return hours * 60 + minutes;
};

const validateRules = (): boolean => {
  if (!enabled.value) {
    return true;
  }

  if (rules.value.length === 0) {
    usersStore.showSnackbar(
      t('attendance_hours_validation_required_rules'),
      EColor.warning
    );
    return false;
  }

  for (const rule of rules.value) {
    if (!rule.weekday || !rule.start_time || !rule.end_time) {
      usersStore.showSnackbar(
        t('attendance_hours_validation_required_fields'),
        EColor.warning
      );
      return false;
    }

    const start = toMinutes(rule.start_time);
    const end = toMinutes(rule.end_time);

    if (start === null || end === null || start >= end) {
      usersStore.showSnackbar(
        t('attendance_hours_validation_invalid_time_range', {
          day: t(rule.weekday),
        }),
        EColor.warning
      );
      return false;
    }
  }

  for (let i = 0; i < rules.value.length; i++) {
    const first = rules.value[i];
    if (!first.weekday) continue;

    const firstStart = toMinutes(first.start_time);
    const firstEnd = toMinutes(first.end_time);

    if (firstStart === null || firstEnd === null) {
      continue;
    }

    for (let j = i + 1; j < rules.value.length; j++) {
      const second = rules.value[j];
      if (!second.weekday || second.weekday !== first.weekday) {
        continue;
      }

      const secondStart = toMinutes(second.start_time);
      const secondEnd = toMinutes(second.end_time);

      if (secondStart === null || secondEnd === null) {
        continue;
      }

      const hasConflict = firstStart < secondEnd && secondStart < firstEnd;

      if (hasConflict) {
        usersStore.showSnackbar(
          t('attendance_hours_validation_conflict', {
            day: t(first.weekday),
          }),
          EColor.warning
        );
        return false;
      }
    }
  }

  return true;
};

const loadAttendanceHours = async () => {
  if (!props.userId) {
    resetState();
    return;
  }

  isLoading.value = true;

  try {
    const response = await usersStore.viewUserAttendanceHours(props.userId);

    if (!response) {
      resetState();
      return;
    }

    enabled.value = response.enabled;
    rules.value = (response.rules || []).map((rule) => ({
      id: createLocalId(),
      weekday: rule.weekday,
      start_time: rule.start_time,
      end_time: rule.end_time,
    }));
  } finally {
    isLoading.value = false;
  }
};

const addRule = () => {
  rules.value.push(createDefaultRule());
};

const removeRule = (ruleId: string) => {
  rules.value = rules.value.filter((rule) => rule.id !== ruleId);
};

const save = async () => {
  if (!props.userId || isSaving.value) {
    return;
  }

  if (!validateRules()) {
    return;
  }

  const payloadRules = enabled.value
    ? rules.value
        .filter((rule) => !!rule.weekday)
        .map((rule) => ({
          weekday: rule.weekday as UserAttendanceHoursRule['weekday'],
          start_time: rule.start_time,
          end_time: rule.end_time,
        }))
        .sort((first, second) => {
          if (first.weekday !== second.weekday) {
            return weekdayOrder[first.weekday] - weekdayOrder[second.weekday];
          }

          if (first.start_time !== second.start_time) {
            return first.start_time.localeCompare(second.start_time);
          }

          return first.end_time.localeCompare(second.end_time);
        })
    : [];

  isSaving.value = true;

  try {
    const response = await usersStore.updateUserAttendanceHours(props.userId, {
      rules: payloadRules,
    });

    if (!response) {
      return;
    }

    emit('updated');
    closeModal();
  } finally {
    isSaving.value = false;
  }
};

watch(
  [() => isVisible.value, () => props.userId],
  async ([visible]) => {
    if (!visible) {
      return;
    }

    await loadAttendanceHours();
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="900" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('attendance_hours_modal_title') }}</span>
        <IconBtn :disabled="isLoading || isSaving" @click="closeModal">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VCardText>
        <div class="text-caption text-medium-emphasis mb-4">
          {{
            $t('attendance_hours_timezone_hint', {
              timezone: 'America/Sao_Paulo',
            })
          }}
        </div>

        <div
          class="d-flex justify-space-between align-center mb-4 flex-wrap gap-2"
        >
          <VSwitch
            v-model="enabled"
            :label="$t('attendance_hours_enabled_label')"
            color="primary"
            :disabled="isLoading || isSaving"
          />

          <VBtn
            color="primary"
            variant="tonal"
            :disabled="isLoading || isSaving || !enabled"
            @click="addRule"
          >
            {{ $t('attendance_hours_add_rule') }}
          </VBtn>
        </div>

        <VAlert
          v-if="enabled && rules.length === 0"
          type="info"
          variant="tonal"
          class="mb-4"
        >
          {{ $t('attendance_hours_empty_state') }}
        </VAlert>

        <VAlert v-if="!enabled" type="info" variant="tonal" class="mb-4">
          {{ $t('attendance_hours_disabled_hint') }}
        </VAlert>

        <VRow
          v-for="rule in rules"
          :key="rule.id"
          dense
          class="mb-2 align-center"
        >
          <VCol cols="12" md="4">
            <VSelect
              v-model="rule.weekday"
              :items="weekdayOptions"
              item-title="title"
              item-value="value"
              :label="$t('attendance_hours_day_label')"
              density="comfortable"
              hide-details
              :disabled="isLoading || isSaving || !enabled"
            />
          </VCol>

          <VCol cols="5" md="3">
            <VTextField
              v-model="rule.start_time"
              type="time"
              :label="$t('attendance_hours_start_label')"
              density="comfortable"
              hide-details
              :disabled="isLoading || isSaving || !enabled"
            />
          </VCol>

          <VCol cols="5" md="3">
            <VTextField
              v-model="rule.end_time"
              type="time"
              :label="$t('attendance_hours_end_label')"
              density="comfortable"
              hide-details
              :disabled="isLoading || isSaving || !enabled"
            />
          </VCol>

          <VCol cols="2" md="2" class="d-flex justify-end">
            <IconBtn
              :disabled="isLoading || isSaving || !enabled"
              @click="removeRule(rule.id)"
            >
              <VIcon icon="tabler-trash" />
            </IconBtn>
          </VCol>
        </VRow>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isLoading || isSaving"
          @click="closeModal"
        >
          {{ $t('close') }}
        </VBtn>

        <VBtn
          color="primary"
          :loading="isSaving"
          :disabled="isLoading || isSaving"
          @click="save"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
