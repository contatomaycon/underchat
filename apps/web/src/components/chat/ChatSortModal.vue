<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSelectSearch from '@/components/AppSelectSearch.vue';

const { t } = useI18n();

interface Props {
  modelValue: boolean;
  sortField?: string | null;
  sortOrder?: string | null;
  filterType?: 'all' | 'in_chat' | 'queue' | 'my_chats' | 'chatbot';
  inChatSortField?: string | null;
  inChatSortOrder?: string | null;
  queueSortField?: string | null;
  queueSortOrder?: string | null;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:sortField', value: string | null): void;
  (e: 'update:sortOrder', value: string | null): void;
  (e: 'save', status?: 'in_chat' | 'queue'): Promise<void>;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const isSaving = ref(false);

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const sortField = ref<string | null>(props.sortField ?? 'summary.last_message');
const sortOrder = ref<string | null>(props.sortOrder ?? 'desc');

watch(
  () => props.sortField,
  (newValue) => {
    sortField.value = newValue ?? 'summary.last_message';
  }
);

watch(
  () => props.sortOrder,
  (newValue) => {
    sortOrder.value = newValue ?? 'desc';
  }
);

const selectedStatus = ref<'in_chat' | 'queue' | null>(null);

watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue && props.filterType === 'all') {
      selectedStatus.value = null;
      sortField.value = props.sortField ?? 'summary.last_message';
      sortOrder.value = props.sortOrder ?? 'desc';
    }
  }
);

watch(
  () => [
    props.inChatSortField,
    props.inChatSortOrder,
    props.queueSortField,
    props.queueSortOrder,
  ],
  () => {
    if (props.filterType === 'all' && selectedStatus.value) {
      if (selectedStatus.value === 'in_chat') {
        sortField.value = props.inChatSortField ?? 'summary.last_message';
        sortOrder.value = props.inChatSortOrder ?? 'desc';
      } else if (selectedStatus.value === 'queue') {
        sortField.value = props.queueSortField ?? 'summary.last_message';
        sortOrder.value = props.queueSortOrder ?? 'desc';
      }
    }
  }
);

watch(
  () => selectedStatus.value,
  (newStatus) => {
    if (props.filterType === 'all') {
      if (newStatus === 'in_chat') {
        sortField.value = props.inChatSortField ?? 'summary.last_message';
        sortOrder.value = props.inChatSortOrder ?? 'desc';
      } else if (newStatus === 'queue') {
        sortField.value = props.queueSortField ?? 'summary.last_message';
        sortOrder.value = props.queueSortOrder ?? 'desc';
      } else {
        sortField.value = props.sortField ?? 'summary.last_message';
        sortOrder.value = props.sortOrder ?? 'desc';
      }
    }
  },
  { immediate: true }
);

const sortFieldOptions = [
  {
    value: 'summary.last_message',
    title: t('last_message', 'Última mensagem'),
  },
  { value: 'account.name', title: t('account', 'Conta') },
  { value: 'worker.name', title: t('channel', 'Canal') },
  { value: 'name', title: t('name', 'Nome') },
  { value: 'phone', title: t('phone', 'Telefone') },
  { value: 'status', title: t('status', 'Status') },
  { value: 'date', title: t('date', 'Data') },
  { value: 'user.name', title: t('attendant', 'Atendente') },
  { value: 'sector.name', title: t('sector', 'Setor') },
  { value: 'started_at', title: t('started_at', 'Iniciado em') },
  { value: 'closed_at', title: t('closed_at', 'Fechado em') },
];

const sortOrderOptions = [
  { value: 'asc', title: t('ascending', 'Crescente') },
  { value: 'desc', title: t('descending', 'Decrescente') },
];

const modalTitle = computed(() => {
  if (props.filterType === 'all') {
    return t('sort_all_chats', 'Ordenar Todos');
  }
  if (props.filterType === 'in_chat') {
    return t('sort_in_chat', 'Ordenar Em Atendimento');
  }
  if (props.filterType === 'queue') {
    return t('sort_queue', 'Ordenar Aguardando atendimento');
  }
  if (props.filterType === 'my_chats') {
    return t('sort_my_chats', 'Ordenar Meus atendimentos');
  }
  if (props.filterType === 'chatbot') {
    return t('sort_chatbot', 'Ordenar ChatBot');
  }
  return t('sort', 'Ordenar');
});

const showStatusSelection = computed(() => {
  return props.filterType === 'all';
});

const handleSave = async () => {
  isSaving.value = true;

  try {
    emit('update:sortField', sortField.value);
    emit('update:sortOrder', sortOrder.value);

    if (props.filterType === 'all' && selectedStatus.value) {
      await emit('save', selectedStatus.value);
    } else {
      await emit('save');
    }

    isVisible.value = false;
  } catch (error) {
    console.error('Error saving sort:', error);
  } finally {
    isSaving.value = false;
  }
};

const handleCancel = () => {
  sortField.value = props.sortField ?? 'summary.last_message';
  sortOrder.value = props.sortOrder ?? 'desc';
  isVisible.value = false;
};
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center">
        <span class="text-h6">{{ modalTitle }}</span>
        <VSpacer />
        <IconBtn @click="handleCancel">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <VRow v-if="showStatusSelection">
          <VCol cols="12">
            <VLabel class="text-body-2 mb-1">
              {{ $t('filter_status', 'Status') }}:
            </VLabel>
            <AppSelectSearch
              v-model="selectedStatus"
              :items="[
                { value: 'in_chat', title: $t('in_service', 'Em Atendimento') },
                {
                  value: 'queue',
                  title: $t('waiting_for_service', 'Aguardando atendimento'),
                },
              ]"
              :placeholder="$t('select_status', 'Selecione o status')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('sort_by', 'Ordenar por') }}:
            </VLabel>
            <AppSelectSearch
              v-model="sortField"
              :items="sortFieldOptions"
              :placeholder="$t('select_sort_field', 'Selecione o campo')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('sort_order', 'Ordem') }}:
            </VLabel>
            <AppSelectSearch
              v-model="sortOrder"
              :items="sortOrderOptions"
              :placeholder="$t('select_sort_order', 'Selecione a ordem')"
              item-value="value"
              item-title="title"
            />
          </VCol>
        </VRow>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="isSaving"
          @click="handleCancel"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn :loading="isSaving" @click="handleSave">
          {{ $t('apply', 'Aplicar') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
