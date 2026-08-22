<script setup lang="ts">
import './chatbot-node-workbench.css';
import { computed, nextTick, ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position, useVueFlow } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const OUTSIDE_HOURS_OPTION_ID = 'outside-hours';
const DEFAULT_INTERVAL_START = '09:00';
const DEFAULT_INTERVAL_END = '18:00';
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface HoursOption {
  id: string;
  text: string;
  required?: boolean;
  start_time?: string;
  end_time?: string;
}

interface HoursData {
  timezone?: string;
  options: HoursOption[];
  onRemove?: () => void;
  onRemoveOption?: (optionId: string) => void;
}

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { updateNodeInternals } = useVueFlow();

const isValidTime = (value?: string): boolean => {
  return typeof value === 'string' && TIME_REGEX.test(value);
};

const isValidWindow = (start?: string, end?: string): boolean => {
  if (!isValidTime(start) || !isValidTime(end)) {
    return false;
  }

  return (start as string) < (end as string);
};

const normalizeIntervalOption = (option: HoursOption): HoursOption => {
  const optionId =
    typeof option.id === 'string' && option.id.trim().length > 0
      ? option.id.trim().replace(/^option-/i, '')
      : crypto.randomUUID();

  const startTime = isValidTime(option.start_time)
    ? option.start_time!
    : DEFAULT_INTERVAL_START;
  const endTime = isValidTime(option.end_time)
    ? option.end_time!
    : DEFAULT_INTERVAL_END;

  const text =
    typeof option.text === 'string' && option.text.trim().length > 0
      ? option.text
      : `${startTime} -> ${endTime}`;

  return {
    id: optionId,
    text,
    start_time: startTime,
    end_time: endTime,
    required: false,
  };
};

const buildHoursOptions = (existingOptions?: HoursOption[]): HoursOption[] => {
  const intervalOptions: HoursOption[] = [];
  let outsideHoursText = t('chatbot_hours_outside_hours');

  for (const option of existingOptions || []) {
    if (!option) {
      continue;
    }

    const optionId =
      typeof option.id === 'string'
        ? option.id.trim().replace(/^option-/i, '')
        : '';

    if (!optionId) {
      continue;
    }

    if (optionId === OUTSIDE_HOURS_OPTION_ID) {
      if (typeof option.text === 'string' && option.text.trim().length > 0) {
        outsideHoursText = option.text;
      }
      continue;
    }

    intervalOptions.push(
      normalizeIntervalOption({
        ...option,
        id: optionId,
      })
    );
  }

  if (intervalOptions.length === 0) {
    intervalOptions.push(
      normalizeIntervalOption({
        id: crypto.randomUUID(),
        text: `${DEFAULT_INTERVAL_START} -> ${DEFAULT_INTERVAL_END}`,
        start_time: DEFAULT_INTERVAL_START,
        end_time: DEFAULT_INTERVAL_END,
      })
    );
  }

  return [
    ...intervalOptions,
    {
      id: OUTSIDE_HOURS_OPTION_ID,
      text: outsideHoursText,
      required: true,
    },
  ];
};

const getInitialData = (): HoursData => {
  const data = props.data as HoursData | undefined;

  return {
    timezone: data?.timezone || DEFAULT_TIMEZONE,
    options: buildHoursOptions(data?.options),
  };
};

const hoursData = ref<HoursData>(getInitialData());

const intervalOptions = computed(() => {
  return hoursData.value.options.filter(
    (option) => option.id !== OUTSIDE_HOURS_OPTION_ID
  );
});

const outsideHoursOption = computed(() => {
  return (
    hoursData.value.options.find(
      (option) => option.id === OUTSIDE_HOURS_OPTION_ID
    ) || {
      id: OUTSIDE_HOURS_OPTION_ID,
      text: t('chatbot_hours_outside_hours'),
      required: true,
    }
  );
});

const buildOptionHandleId = (optionId: string): string => {
  return `option-${optionId}-source`;
};

const refreshNodeInternals = () => {
  nextTick(() => {
    updateNodeInternals([props.id]);
  });
};

const updateNodeData = () => {
  if (!props.data) {
    return;
  }

  const data = props.data as HoursData;
  data.timezone = hoursData.value.timezone || DEFAULT_TIMEZONE;
  data.options = buildHoursOptions(hoursData.value.options);

  refreshNodeInternals();
};

const updateIntervals = (intervals: HoursOption[]) => {
  const rebuiltOptions = buildHoursOptions([
    ...intervals,
    outsideHoursOption.value,
  ]);

  hoursData.value.options = rebuiltOptions;
  updateNodeData();
};

const addInterval = () => {
  const intervals = [...intervalOptions.value];
  intervals.push(
    normalizeIntervalOption({
      id: crypto.randomUUID(),
      text: `${DEFAULT_INTERVAL_START} -> ${DEFAULT_INTERVAL_END}`,
      start_time: DEFAULT_INTERVAL_START,
      end_time: DEFAULT_INTERVAL_END,
    })
  );

  updateIntervals(intervals);
};

const updateIntervalStart = (optionId: string, startTime: string) => {
  const intervals = intervalOptions.value.map((option) => {
    if (option.id !== optionId) {
      return option;
    }

    const normalizedStart = isValidTime(startTime)
      ? startTime
      : DEFAULT_INTERVAL_START;
    const normalizedEnd = isValidTime(option.end_time)
      ? option.end_time!
      : DEFAULT_INTERVAL_END;

    return {
      ...option,
      start_time: normalizedStart,
      end_time: normalizedEnd,
      text: `${normalizedStart} -> ${normalizedEnd}`,
    };
  });

  updateIntervals(intervals);
};

const updateIntervalEnd = (optionId: string, endTime: string) => {
  const intervals = intervalOptions.value.map((option) => {
    if (option.id !== optionId) {
      return option;
    }

    const normalizedStart = isValidTime(option.start_time)
      ? option.start_time!
      : DEFAULT_INTERVAL_START;
    const normalizedEnd = isValidTime(endTime) ? endTime : DEFAULT_INTERVAL_END;

    return {
      ...option,
      start_time: normalizedStart,
      end_time: normalizedEnd,
      text: `${normalizedStart} -> ${normalizedEnd}`,
    };
  });

  updateIntervals(intervals);
};

const removeInterval = (optionId: string) => {
  const data = props.data as HoursData;

  if (data?.onRemoveOption) {
    data.onRemoveOption(optionId);
  }

  const intervals = intervalOptions.value.filter(
    (option) => option.id !== optionId
  );
  updateIntervals(intervals);
};

const handleRemove = () => {
  const data = props.data as HoursData;
  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => hoursData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-hours-node chatbot-workbench-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />

    <VCard class="hours-card chatbot-workbench-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle chatbot-workbench-header"
      >
        <div class="d-flex align-center ga-2 chatbot-workbench-identity">
          <VIcon
            icon="tabler-clock-hour-3"
            color="primary"
            size="20"
            class="chatbot-workbench-icon"
          />
          <span class="text-sm font-weight-medium chatbot-workbench-title">{{
            t('chatbot_hours')
          }}</span>
        </div>
        <VIcon
          v-if="(props.data as HoursData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer chatbot-workbench-remove"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3 chatbot-workbench-body">
        <VLabel class="text-body-2 mb-2">{{
          t('chatbot_hours_intervals')
        }}</VLabel>

        <div class="interval-list nodrag">
          <div
            v-for="option in intervalOptions"
            :key="option.id"
            class="interval-item nodrag"
          >
            <VTextField
              :model-value="option.start_time"
              type="time"
              variant="outlined"
              density="compact"
              hide-details
              class="interval-time-field"
              @update:model-value="
                updateIntervalStart(option.id, $event as string)
              "
            />

            <VIcon icon="tabler-arrow-right" size="16" class="interval-arrow" />

            <VTextField
              :model-value="option.end_time"
              type="time"
              variant="outlined"
              density="compact"
              hide-details
              class="interval-time-field"
              @update:model-value="
                updateIntervalEnd(option.id, $event as string)
              "
            />

            <IconBtn
              size="small"
              class="interval-remove-btn"
              @click="removeInterval(option.id)"
            >
              <VIcon icon="tabler-trash" size="16" />
            </IconBtn>

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

        <VBtn
          color="primary"
          variant="text"
          size="small"
          class="px-0 mt-1"
          @click="addInterval"
        >
          <VIcon icon="tabler-plus" class="me-1" size="16" />
          {{ t('chatbot_hours_add_interval') }}
        </VBtn>

        <div class="outside-hours-item nodrag mt-2">
          <VTextField
            :model-value="outsideHoursOption.text"
            variant="outlined"
            density="compact"
            hide-details
            disabled
            class="outside-hours-field"
          />

          <Handle
            :id="buildOptionHandleId(outsideHoursOption.id)"
            type="source"
            :position="Position.Right"
            class="option-handle handle-source"
            @mousedown.stop
            @touchstart.stop
          />
        </div>
      </VCardText>
    </VCard>
  </div>
</template>

<style scoped>
.chatbot-hours-node {
  min-width: 360px;
}

.hours-card {
  border-radius: 8px;
}

.interval-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 4px;
}

.interval-item {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  padding-right: 24px;
}

.interval-time-field {
  width: 110px;
}

.interval-arrow {
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
}

.interval-remove-btn {
  flex-shrink: 0;
}

.outside-hours-item {
  display: flex;
  align-items: center;
  position: relative;
  padding-right: 24px;
}

.outside-hours-field {
  width: 100%;
}

.option-handle {
  width: 12px;
  height: 12px;
  background: #42b883;
  border: 2px solid #fff;
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
}

.handle-target {
  width: 12px;
  height: 12px;
  background: #ff6b6b;
  border: 2px solid #fff;
}
</style>
