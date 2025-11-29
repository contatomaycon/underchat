<script lang="ts" setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ViewWorkerConfigForChatResponse } from '@core/schema/chat/viewWorkerConfigForChat/response.schema';

const { t } = useI18n();

const props = defineProps<{
  isQueueStatus: boolean;
  canAttendChat: boolean;
  cannotAttendDueToStatus: boolean;
  cannotAttendDueToLimit: boolean;
  workerConfigForChat: ViewWorkerConfigForChatResponse | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  attend: [];
}>();

const message = computed(() => {
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
</script>

<template>
  <div
    v-if="isQueueStatus"
    class="d-flex align-center justify-space-between pa-4 bg-surface rounded mb-2"
  >
    <span class="text-body-2 text-medium-emphasis">
      {{ message }}
    </span>
    <VBtn
      v-if="canAttendChat"
      color="primary"
      size="small"
      @click="$emit('attend')"
      :loading="loading"
    >
      {{ t('attend', 'Atender') }}
    </VBtn>
  </div>
</template>
