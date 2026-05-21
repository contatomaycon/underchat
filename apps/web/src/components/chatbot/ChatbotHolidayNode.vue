<script setup lang="ts">
import { ref, watch } from 'vue';
import type { NodeProps } from '@vue-flow/core';
import { Handle, Position } from '@vue-flow/core';
import { useI18n } from 'vue-i18n';
import AppInfoTooltip from '@/components/AppInfoTooltip.vue';

interface HolidayOption {
  id: string;
  text: string;
  required?: boolean;
}

interface HolidayData {
  holidayMessage?: string;
  options: HolidayOption[];
  onRemove?: () => void;
}

const HOLIDAY_IS_OPTION_ID = 'is-holiday';
const HOLIDAY_NOT_OPTION_ID = 'not-holiday';
const HOLIDAY_NAMES_VARIABLE = '{{ holiday_names }}';
const HOLIDAY_TAGS_VARIABLE = '{{ holiday_tags }}';
const holidayPlaceholderParams = {
  holiday_names: HOLIDAY_NAMES_VARIABLE,
  holiday_tags: HOLIDAY_TAGS_VARIABLE,
};

const props = defineProps<NodeProps>();
const { t } = useI18n();

const buildHolidayOptions = (existingOptions?: HolidayOption[]): HolidayOption[] => {
  const options = Array.isArray(existingOptions) ? existingOptions : [];

  const isHolidayOption = options.find((option) => option.id === HOLIDAY_IS_OPTION_ID);
  const notHolidayOption = options.find(
    (option) => option.id === HOLIDAY_NOT_OPTION_ID
  );

  return [
    {
      id: HOLIDAY_IS_OPTION_ID,
      text: isHolidayOption?.text || t('chatbot_holiday_option_is_holiday'),
      required: true,
    },
    {
      id: HOLIDAY_NOT_OPTION_ID,
      text:
        notHolidayOption?.text || t('chatbot_holiday_option_not_holiday'),
      required: true,
    },
  ];
};

const getInitialData = (): HolidayData => {
  const data = props.data as HolidayData | undefined;

  return {
    holidayMessage: data?.holidayMessage || '',
    options: buildHolidayOptions(data?.options),
  };
};

const holidayData = ref<HolidayData>(getInitialData());

const buildOptionHandleId = (optionId: string): string => {
  return `option-${optionId}-source`;
};

const updateNodeData = () => {
  if (!props.data) {
    return;
  }

  const data = props.data as HolidayData;
  data.holidayMessage = holidayData.value.holidayMessage || '';
  data.options = buildHolidayOptions(holidayData.value.options);
};

const handleRemove = () => {
  const data = props.data as HolidayData;

  if (data?.onRemove) {
    data.onRemove();
  }
};

watch(
  () => holidayData.value,
  () => {
    updateNodeData();
  },
  { deep: true }
);
</script>

<template>
  <div class="chatbot-holiday-node">
    <Handle
      id="target"
      type="target"
      :position="Position.Top"
      class="handle-target"
    />

    <VCard class="holiday-card" elevation="2">
      <VCardTitle
        class="d-flex align-center justify-space-between pa-2 node-drag-handle"
      >
        <div class="d-flex align-center ga-2">
          <VIcon icon="tabler-calendar-star" color="primary" size="20" />
          <span class="text-sm font-weight-medium">{{ t('chatbot_holidays') }}</span>
        </div>
        <VIcon
          v-if="(props.data as HolidayData)?.onRemove"
          icon="tabler-x"
          size="18"
          color="error"
          class="cursor-pointer"
          @click.stop="handleRemove"
        />
      </VCardTitle>

      <VCardText class="pa-3">
        <div class="d-flex align-center ga-1 mb-1">
          <VLabel class="text-body-2">{{ t('chatbot_holiday_message') }}</VLabel>
          <AppInfoTooltip
            :title="t('chatbot_holiday_placeholders_title')"
            :text="
              t('chatbot_holiday_placeholders_help', holidayPlaceholderParams)
            "
          />
        </div>
        <VTextarea
          v-model="holidayData.holidayMessage"
          :placeholder="
            t('chatbot_holiday_message_placeholder', holidayPlaceholderParams)
          "
          variant="outlined"
          density="comfortable"
          rows="3"
          auto-grow
          hide-details
          class="nodrag"
        />

        <div class="options-list nodrag">
          <div
            v-for="(option, index) in holidayData.options"
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
              disabled
              hide-details
              class="option-text-field"
            />

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
.chatbot-holiday-node {
  min-width: 360px;
}

.holiday-card {
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
