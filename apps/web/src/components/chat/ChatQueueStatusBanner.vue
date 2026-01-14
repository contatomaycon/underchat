<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

const { t } = useI18n();

const props = defineProps<{
  isQueueStatus: boolean;
  isClosedStatus: boolean;
  canAttendChat: boolean;
  canReopenChat: boolean;
  canReopenChatPermission: boolean;
  cannotAttendDueToStatus: boolean;
  cannotAttendDueToLimit: boolean;
  workerConfigForChat: ViewWorkerConfigForChatResponse | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  attend: [];
  reopen: [];
}>();

const message = computed(() => {
  if (props.isClosedStatus) {
    if (props.cannotAttendDueToStatus) {
      return t('attendance_only_online_required');
    }
    if (props.cannotAttendDueToLimit) {
      return t('simultaneous_attendance_limit_message', {
        limit: props.workerConfigForChat?.simultaneous_attendance,
      });
    }
    return t(
      'chat_closed_message',
      'Para reabrir o atendimento clique em reabrir'
    );
  }

  if (props.canAttendChat) {
    return t(
      'chat_queue_message',
      'Para iniciar o atendimento clique em atender'
    );
  }
  if (props.cannotAttendDueToStatus) {
    return t('attendance_only_online_required');
  }
  if (props.cannotAttendDueToLimit) {
    return t('simultaneous_attendance_limit_message', {
      limit: props.workerConfigForChat?.simultaneous_attendance,
    });
  }
  return t(
    'chat_queue_message',
    'Para iniciar o atendimento clique em atender'
  );
});

const buttonText = computed(() => {
  if (props.isClosedStatus) {
    return t('reopen', 'Reabrir');
  }
  return t('attend', 'Atender');
});

const showButton = computed(() => {
  if (props.isClosedStatus) {
    return true;
  }
  if (props.isQueueStatus && props.canAttendChat) {
    return true;
  }
  return false;
});

const tooltipText = computed(() => {
  if (props.isClosedStatus && !props.canReopenChatPermission) {
    return t('reopen_chat_permission_denied');
  }
  return undefined;
});

const handleClick = () => {
  if (props.isClosedStatus) {
    emit('reopen');
    return;
  }
  emit('attend');
};
</script>

<template>
  <div
    v-if="isQueueStatus || isClosedStatus || loading"
    class="d-flex align-center justify-space-between pa-4 bg-surface rounded mb-2"
  >
    <template v-if="loading">
      <div class="d-flex align-center justify-space-between w-100">
        <div class="flex-grow-1 me-4">
          <VSkeletonLoader type="text" width="60%" height="20" class="mb-1" />
          <VSkeletonLoader type="text" width="40%" height="16" />
        </div>
        <VSkeletonLoader type="button" width="100" height="36" />
      </div>
    </template>
    <template v-else>
      <span class="text-body-2 text-medium-emphasis">
        {{ message }}
      </span>
      <template v-if="showButton">
        <VTooltip v-if="tooltipText" :text="tooltipText" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="d-inline-block">
              <VBtn
                color="primary"
                size="small"
                :disabled="props.isClosedStatus && !props.canReopenChat"
                @click="handleClick"
              >
                {{ buttonText }}
              </VBtn>
            </span>
          </template>
        </VTooltip>
        <VBtn
          v-else
          color="primary"
          size="small"
          :disabled="props.isClosedStatus && !props.canReopenChat"
          @click="handleClick"
        >
          {{ buttonText }}
        </VBtn>
      </template>
    </template>
  </div>
</template>
