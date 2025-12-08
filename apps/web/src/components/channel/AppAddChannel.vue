<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
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
const type = ref<EWorkerType | null>(EWorkerType.baileys);

const itemsType = ref([{ value: EWorkerType.baileys, title: t('unofficial') }]);

const typeSearchQuery = ref('');
const isTypeMenuOpen = ref(false);

const filteredTypes = computed(() => {
  if (!typeSearchQuery.value) {
    return itemsType.value;
  }
  const query = typeSearchQuery.value.toLowerCase();
  return itemsType.value.filter((item) =>
    item.title.toLowerCase().includes(query)
  );
});

watch(isTypeMenuOpen, (isOpen) => {
  if (!isOpen) {
    typeSearchQuery.value = '';
  }
});

const refFormAddChannel = ref<VForm>();

const addChannel = async () => {
  const validateForm = await refFormAddChannel?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value || !type.value) {
    return;
  }

  const payload: CreateWorkerRequest = {
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
  type.value = EWorkerType.baileys;
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

    <VOverlay
      :model-value="channelStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddChannel" @submit.prevent>
      <VCard :title="$t('add_server')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="6" md="6">
              <VLabel class="mb-1 text-body-2">{{ $t('type') }}:</VLabel>
              <VMenu v-model="isTypeMenuOpen">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      filteredTypes.find((item) => item.value === type)
                        ?.title || ''
                    "
                    :placeholder="$t('type')"
                    variant="outlined"
                    readonly
                    :clearable="!!type"
                    clear-icon="tabler-x"
                    @click:clear="type = null"
                    :append-inner-icon="
                      type ? undefined : 'tabler-chevron-down'
                    "
                    :error-messages="!type ? [$t('type_required')] : undefined"
                  />
                </template>
                <VCard>
                  <VCardText class="pa-2">
                    <AppTextField
                      v-model="typeSearchQuery"
                      :placeholder="$t('search') + '...'"
                      prepend-inner-icon="tabler-search"
                      density="compact"
                      hide-details
                      autofocus
                      @click.stop
                    />
                  </VCardText>
                  <VDivider />
                  <VList max-height="300" style="overflow-y: auto">
                    <template v-if="filteredTypes.length > 0">
                      <VListItem
                        v-for="(item, index) in filteredTypes"
                        :key="index"
                        :value="item.value"
                        @click="
                          () => {
                            type = item.value;
                            isTypeMenuOpen = false;
                            typeSearchQuery = '';
                          }
                        "
                        :active="type === item.value"
                      >
                        <VListItemTitle>{{ item.title }}</VListItemTitle>
                      </VListItem>
                    </template>
                    <VListItem v-else-if="typeSearchQuery" disabled>
                      <VListItemTitle
                        class="text-center text-body-2 text-medium-emphasis"
                      >
                        {{ $t('no_results_found') }}
                      </VListItemTitle>
                    </VListItem>
                  </VList>
                </VCard>
              </VMenu>
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
