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
  if (props.isClosedStatus && props.canReopenChat) {
    return true;
  }
  if (props.isQueueStatus && props.canAttendChat) {
    return true;
  }
  return false;
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
    v-if="isQueueStatus || isClosedStatus"
    class="d-flex align-center justify-space-between pa-4 bg-surface rounded mb-2"
  >
    <span class="text-body-2 text-medium-emphasis">
      {{ message }}
    </span>
    <VBtn
      v-if="showButton"
      color="primary"
      size="small"
      @click="handleClick"
      :loading="loading"
    >
      {{ buttonText }}
    </VBtn>
  </div>
</template>
