<script lang="ts" setup>
import { useMessageTemplateStore } from '@/@webcore/stores/messageTemplate';
import { EMessageStatus } from '@core/common/enums/EMessageStatus';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { VForm } from 'vuetify/components/VForm';

const messageTemplateStore = useMessageTemplateStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const itemsStatus = ref([
  { value: EMessageStatus.active, text: t('active') },
  { value: EMessageStatus.inactive, text: t('inactive') },
]);

const message = ref<string | null>(null);
const command = ref<string | null>(null);
const message_status_id = ref<string | null>(null);

const refFormAddMessageTemplate = ref<VForm>();

const addMessageTemplate = async () => {
  const validateForm = await refFormAddMessageTemplate?.value?.validate();
  if (!validateForm?.valid) return;

  if (!message.value || !message_status_id.value || !command.value) {
    return;
  }

  const payload: CreateMessageTemplateRequest = {
    message: message.value,
    message_status: {
      message_status_id: message_status_id.value,
    },
    command: command.value,
  };

  const result = await messageTemplateStore.addMessageTemplate(payload);

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

const resetForm = () => {
  message.value = null;
  message_status_id.value = null;
  command.value = null;
  refFormAddMessageTemplate.value?.resetValidation();
};

onMounted(async () => {
  resetForm();
});

watch(isVisible, (visible) => {
  if (visible) resetForm();
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

    <VForm ref="refFormAddMessageTemplate" @submit.prevent>
      <VCard :title="$t('add_message_template')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="message"
                :label="$t('message') + ':'"
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
                :rules="[
                  requiredValidator(
                    message_status_id,
                    $t('message_status_id_required')
                  ),
                ]"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addMessageTemplate"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
