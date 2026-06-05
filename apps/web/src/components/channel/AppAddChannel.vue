<script lang="ts" setup>
import { nextTick } from 'vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { ICreateWorkerResponse } from '@core/common/interfaces/ICreateWorkerResponse';
import { VForm } from 'vuetify/components/VForm';
import { can } from '@layouts/plugins/casl';
import AppChannelConnectionTypeInfo from './AppChannelConnectionTypeInfo.vue';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'created', data: ICreateWorkerResponse): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const canChooseServer = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const name = ref<string | null>(null);
const serverId = ref<string | null>(null);
const type = ref<EWorkerType>(EWorkerType.baileys);

const itemsType = ref([
  { value: EWorkerType.baileys, title: 'Opção 1 (Socket)' },
  { value: EWorkerType.wwebjs, title: 'Opção 2 (Navegador)' },
  { value: EWorkerType.whatsmeow, title: 'Opção 3 (Socket)' },
]);

const serverItems = ref<Array<{ value: string; title: string }>>([]);
const serversLoading = ref(false);

const refFormAddChannel = ref<VForm>();
const isAdding = ref(false);

const loadWorkerServers = async () => {
  if (!canChooseServer.value) {
    return;
  }

  serversLoading.value = true;
  try {
    const result = await channelStore.listWorkerServers();

    if (result) {
      serverItems.value = result.map((s) => ({
        value: s.server_id,
        title: s.name,
      }));
    }
  } finally {
    serversLoading.value = false;
  }
};

const addChannel = async () => {
  const validateForm = await refFormAddChannel?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) {
    return;
  }

  const payload: CreateWorkerRequest = {
    name: name.value,
    worker_type: type.value,
  };

  if (canChooseServer.value && serverId.value) {
    payload.server_id = serverId.value;
  }

  isAdding.value = true;
  try {
    const result = await channelStore.addChannel(payload);

    if (result) {
      isVisible.value = false;
      emit('created', result);

      await channelStore.listChannels();
    }
  } finally {
    isAdding.value = false;
  }
};

const resetForm = () => {
  name.value = null;
  serverId.value = null;
  type.value = EWorkerType.baileys;
  refFormAddChannel.value?.resetValidation();
};

watch(
  isVisible,
  async (visible) => {
    if (visible) {
      resetForm();
      serverItems.value = [];
      await nextTick();
      if (canChooseServer.value) {
        loadWorkerServers();
      }
    }
  },
  { immediate: true }
);

onMounted(resetForm);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddChannel" @submit.prevent>
      <VCard :title="$t('add_channel')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
              <AppSelectSearch
                v-model="type"
                :items="itemsType"
                :placeholder="$t('type')"
                :clearable="false"
                item-value="value"
                item-title="title"
                data-testid="add-channel-type-select"
                option-test-id-prefix="add-channel-type-option"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol v-if="canChooseServer" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
              <AppSelectSearch
                v-model="serverId"
                :items="serverItems"
                :placeholder="$t('select_server')"
                :loading="serversLoading"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol cols="12">
              <AppChannelConnectionTypeInfo />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn :loading="isAdding" @click="addChannel">
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
