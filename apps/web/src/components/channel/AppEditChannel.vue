<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EServerWebProtocol } from '@core/common/enums/EServerWebProtocol';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';
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

watch(channelId, async (id) => {
  if (!id) return;

  const server = await channelStore.getServerById(id);
  if (server) {
    name.value = server.name;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="channelStore.loading">
      <VOverlay
        :model-value="channelStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditChannel" @submit.prevent>
      <VCard :title="$t('edit_channel')">
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
