<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

type WeekdayOptionId =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

interface WeekdayOption {
  id: WeekdayOptionId;
  text: string;
  required?: boolean;
}

interface WeekdayData {
  timezone?: string;
  options: WeekdayOption[];
  onRemove?: () => void;
}

const WEEKDAY_IDS: WeekdayOptionId[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const props = defineProps<NodeProps>();
const { t } = useI18n();

const dayLabels = computed<Record<WeekdayOptionId, string>>(() => ({
  sunday: t('sunday'),
  monday: t('monday'),
  tuesday: t('tuesday'),
  wednesday: t('wednesday'),
  thursday: t('thursday'),
  friday: t('friday'),
  saturday: t('saturday'),
}));

const buildWeekdayOptions = (existingOptions?: WeekdayOption[]): WeekdayOption[] => {
  const optionsById = new Map<WeekdayOptionId, WeekdayOption>();

  for (const option of existingOptions || []) {
    if (WEEKDAY_IDS.includes(option.id)) {
      optionsById.set(option.id, option);
    }
  }

  return WEEKDAY_IDS.map((id) => {
    const existing = optionsById.get(id);
    return {
      id,
      text: existing?.text || dayLabels.value[id],
      required: true,
    };
  });
};

const getInitialData = (): WeekdayData => {
  const data = props.data as WeekdayData | undefined;

  return {
    timezone: data?.timezone || DEFAULT_TIMEZONE,
    options: buildWeekdayOptions(data?.options),
  };
};

const weekdayData = ref<WeekdayData>(getInitialData());

const currentWeekdayId = computed<WeekdayOptionId>(() => {
  const timezone = weekdayData.value.timezone || DEFAULT_TIMEZONE;

  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  })
    .format(new Date())
    .toLowerCase();

  switch (weekday) {
    case 'monday':
      return 'monday';
    case 'tuesday':
      return 'tuesday';
    case 'wednesday':
      return 'wednesday';
    case 'thursday':
      return 'thursday';
    case 'friday':
      return 'friday';
    case 'saturday':
      return 'saturday';
    default:
      return 'sunday';
  }
});

const buildOptionHandleId = (optionId: WeekdayOptionId): string => {
  return `option-${optionId}-source`;
};

const updateNodeData = () => {
  if (!props.data) {
    return;
  }

  const data = props.data as WeekdayData;
  data.timezone = weekdayData.value.timezone || DEFAULT_TIMEZONE;
  data.options = buildWeekdayOptions(weekdayData.value.options);
};

const handleRemove = () => {
  const data = props.data as WeekdayData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => weekdayData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-weekday-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />

    <VCard class="weekday-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-calendar" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{ t('chatbot_weekday') }}</span>
        </div>
        <VIcon
          v-if="(props.data as WeekdayData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <div class="options-list nodrag">
          <div
            v-for="(option, index) in weekdayData.options"
            :key="option.id"
            class="option-item nodrag"
          >
            <div class="option-number-wrapper">
              <div class="option-number">
                <span class="option-number-text">{{ index + 1 }}</span>
              </div>
            </div>

            <VTextField
              :model-value="option.text"
              variant="outlined"
              density="compact"
              class="option-text-field"
              disabled
              hide-details
            >
              <template #append-inner>
                <VIcon
                  v-if="currentWeekdayId === option.id"
                  icon="tabler-circle-check"
                  color="success"
                  size="18"
                />
              </template>
            </VTextField>

            <Handle
              :id="buildOptionHandleId(option.id)"
              type="source"
              :position="Position.Right"
              class="option-handle handle-source"
              @mousedown.stop
              @touchstart.stop
            />
          </div>
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-weekday-node {
  min-width: 360px;
}

.weekday-card {
  border-radius: 8px;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option-item {
  padding: 2px 0;
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 8px;
  position: relative;
}

.option-number-wrapper {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.option-number {
  min-width: 28px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}

.option-text-field {
  flex: 1;
  min-width: 0;
  margin-right: 12px;
}

.option-handle {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.cursor-pointer {
  cursor: pointer;
}

.node-drag-handle {
  cursor: grab;
  user-select: none;
}

.node-drag-handle:active {
  cursor: grabbing;
}
</style>
