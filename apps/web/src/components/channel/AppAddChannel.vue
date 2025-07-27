<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ManagerCreateWorkerRequest } from '@core/schema/worker/managerCreateWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);

const itemsType = ref([{ value: EWorkerType.baileys, title: t('unofficial') }]);

const refFormAddChannel = ref<VForm>();

const addChannel = async () => {
  const validateForm = await refFormAddChannel?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || !type.value) {
    return;
  }

  const payload: ManagerCreateWorkerRequest = {
    name: name.value,
    worker_type: type.value,
  };

  const result = await channelStore.addChannel(payload);

  if (result) {
    isVisible.value = false;

    await channelStore.listChannels();
  }
};

const resetForm = () => {
  name.value = null;
  type.value = null;
  refFormAddChannel.value?.resetValidation();
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

onMounted(resetForm);
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

    <VForm ref="refFormAddChannel" @submit.prevent>
      <VCard :title="$t('add_server')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="6" md="6">
              <AppSelect
                :items="itemsType"
                v-model="type"
                :label="$t('type') + ':'"
                :placeholder="$t('type')"
                :rules="[requiredValidator(type, $t('type_required'))]"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
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
          <VBtn @click="addChannel"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
