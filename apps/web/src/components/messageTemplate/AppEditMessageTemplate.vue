<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import {
  EditMessageTemplateParamsRequest,
  UpdateMessageTemplateRequest,
} from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  messageTemplateId: string | null;
}>();

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const messageTemplateId = toRef(props, 'messageTemplateId');
const message = ref<string | null>(null);
const message_status_id = ref<string | null>(null);
const command = ref<string | null>(null);

const refFormEditMessageTemplate = ref<VForm>();

const updateMessageTemplate = async () => {
  const validateForm = await refFormEditMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!messageTemplateId.value || !message_status_id.value) {
    return;
  }

  const payload: EditMessageTemplateParamsRequest = {
    message_template_id: messageTemplateId.value,
  };

  const body: UpdateMessageTemplateRequest = {
    message: message.value,
    command: command.value,
    message_status: {
      message_status_id: message_status_id.value,
    },
  };

  const result = await messageTemplateStore.updateMessageTemplate(
    payload,
    body
  );

  if (result) {
    isVisible.value = false;

    await messageTemplateStore.listMessageTemplate();
  }
};

const noSlashRule = (value: string) => {
  if (!value) return true;

  if (/[\\/]/.test(value)) {
    return String.raw`Não é permitido usar / ou \ no comando.`;
  }

  if (value.trim() === '.') {
    return 'O comando não pode ser apenas um ponto.';
  }

  return true;
};

onMounted(async () => {
  if (!messageTemplateId.value) return;

  const messageTemplate = await messageTemplateStore.getMessageTemplateById(
    messageTemplateId.value
  );
  if (messageTemplate) {
    message.value = messageTemplate.message;
    command.value = messageTemplate.command;
    message_status_id.value =
      messageTemplate.message_status?.message_status_id ?? null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="messageTemplateStore.loading">
      <VOverlay
        :model-value="messageTemplateStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditMessageTemplate" @submit.prevent>
      <VCard :title="$t('edit_message_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <label class="text-body-2 mb-1" for="message-textarea">
                {{ $t('message') }}:
              </label>
              <VTextarea
                v-model="message"
                :placeholder="$t('message')"
                :rules="[requiredValidator(message, $t('message_required'))]"
              />
            </VCol>
            <VCol cols="12">
              <AppTextField
                v-model="command"
                :label="$t('command') + ':'"
                :placeholder="$t('command')"
                :rules="[
                  requiredValidator(command, $t('command_required')),
                  noSlashRule,
                ]"
              />
            </VCol>
            <VCol cols="12" md="6">
              <AppSelect
                v-model="message_status_id"
                :items="itemsStatus"
                item-title="text"
                item-value="value"
                :label="$t('message_status') + ':'"
                :placeholder="$t('message_status')"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateMessageTemplate"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
