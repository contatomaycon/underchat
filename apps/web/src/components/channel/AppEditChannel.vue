<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const name = ref<string | null>(null);

const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);

const updateServer = async () => {
  const validateForm = await refFormEditChannel?.value?.validate();
  if (!validateForm?.valid) return;

  if (!channelId.value || !name.value) {
    return;
  }

  const payload: EditWorkerRequest = {
    name: name.value,
    worker_id: channelId.value,
  };

  const result = await channelStore.updateChannel(payload);

  if (result) {
    isVisible.value = false;

    await channelStore.listChannels();
  }
};

const initializeModal = async () => {
  if (!isVisible.value || !channelId.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    const channel = await channelStore.getWorkerById(channelId.value);
    if (channel) {
      name.value = channel.name;
    }
  } finally {
    isInitializingModal.value = false;
  }
};

watch(isVisible, async (visible) => {
  if (visible && channelId.value) {
    await initializeModal();
  }
}, { immediate: true });
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent>
      <VCard :title="$t('edit_channel')" class="position-relative">
        <VOverlay
          :model-value="isInitializingModal || channelStore.loading"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateServer"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
