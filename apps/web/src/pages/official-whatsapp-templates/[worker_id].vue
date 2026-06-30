<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  CreateWhatsappTemplateRequest,
  UpdateWhatsappTemplateRequest,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { useWhatsappOfficialTemplateStore } from '@/@webcore/stores/whatsappOfficialTemplate';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import WhatsappTemplateEditor from '@/components/whatsappTemplate/WhatsappTemplateEditor.vue';
import WhatsappTemplateTable from '@/components/whatsappTemplate/WhatsappTemplateTable.vue';
import WhatsappTemplateToolbar from '@/components/whatsappTemplate/WhatsappTemplateToolbar.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EWorkerPermissions.worker_group,
      EWorkerPermissions.view_worker,
      EWorkerPermissions.update_worker,
      EWorkerPermissions.delete_worker,
    ],
  },
});

type ConfirmAction = 'delete' | 'deactivate';

const route = useRoute();
const router = useRouter();
const templateStore = useWhatsappOfficialTemplateStore();
const channelsStore = useChannelsStore();
useSnackbarCleanup(templateStore);

const workerId = computed(() =>
  String((route.params as { worker_id?: string }).worker_id ?? '')
);
const workerName = shallowRef<string>('WhatsApp Oficial');
const isEditorOpen = shallowRef(false);
const editingTemplate = shallowRef<WhatsappTemplateResponse | null>(null);
const confirmAction = shallowRef<ConfirmAction | null>(null);
const confirmTemplate = shallowRef<WhatsappTemplateResponse | null>(null);

const options = reactive({
  page: 1,
  itemsPerPage: 10,
  search: null as string | null,
  status: null as string | null,
  category: null as string | null,
  language: null as string | null,
  is_active: null as boolean | null,
});

const debouncedSearch = refDebounced(
  computed(() => options.search),
  500
);

const query = computed(() => ({
  current_page: options.page,
  per_page: options.itemsPerPage,
  search: debouncedSearch.value,
  status: options.status,
  category: options.category,
  language: options.language,
  is_active: options.is_active,
}));

const toolbarFilters = computed(() => ({
  search: options.search,
  status: options.status,
  category: options.category,
  language: options.language,
  is_active: options.is_active,
}));

const confirmTitle = computed(() =>
  confirmAction.value === 'delete'
    ? 'Excluir modelo na Meta'
    : 'Desativar modelo na Underchat'
);

const confirmMessage = computed(() => {
  if (confirmAction.value === 'delete') {
    return 'Esta ação tentará excluir o modelo na Meta. Se a Meta negar, o modelo continuará ativo na Underchat com o erro registrado.';
  }

  return 'Esta ação desativa apenas na Underchat e não altera o modelo na Meta.';
});

const loadWorker = async () => {
  if (!workerId.value) {
    return;
  }

  const worker = await channelsStore.getWorkerById(workerId.value);
  if (!worker) {
    return;
  }

  workerName.value = worker.name;

  if (worker.type?.id !== EWorkerType.whatsapp) {
    await router.push('/channels');
  }
};

const loadTemplates = async () => {
  if (!workerId.value) {
    return;
  }

  await templateStore.listTemplates(workerId.value, query.value);
};

const updateFilters = (filters: {
  search: string | null;
  status: string | null;
  category: string | null;
  language: string | null;
  is_active: boolean | null;
}) => {
  options.page = 1;
  options.search = filters.search;
  options.status = filters.status;
  options.category = filters.category;
  options.language = filters.language;
  options.is_active = filters.is_active;
};

const openAddEditor = () => {
  editingTemplate.value = null;
  isEditorOpen.value = true;
};

const openEditEditor = async (template: WhatsappTemplateResponse) => {
  editingTemplate.value =
    (await templateStore.viewTemplate(
      workerId.value,
      template.whatsapp_message_template_id
    )) ?? template;
  isEditorOpen.value = true;
};

const syncTemplates = async () => {
  const result = await templateStore.syncTemplates(workerId.value);
  if (result) {
    await loadTemplates();
  }
};

const saveTemplate = async (
  payload: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest
) => {
  const result = editingTemplate.value
    ? await templateStore.updateTemplate(
        workerId.value,
        editingTemplate.value.whatsapp_message_template_id,
        payload
      )
    : await templateStore.createTemplate(
        workerId.value,
        payload as CreateWhatsappTemplateRequest
      );

  if (!result) {
    return;
  }

  isEditorOpen.value = false;
  editingTemplate.value = null;
  await loadTemplates();
};

const uploadMedia = async (file: File): Promise<string | null> => {
  const result = await templateStore.uploadMedia(workerId.value, file);
  return result?.handle ?? null;
};

const requestDelete = (template: WhatsappTemplateResponse) => {
  confirmAction.value = 'delete';
  confirmTemplate.value = template;
};

const requestDeactivate = (template: WhatsappTemplateResponse) => {
  confirmAction.value = 'deactivate';
  confirmTemplate.value = template;
};

const closeConfirm = () => {
  confirmAction.value = null;
  confirmTemplate.value = null;
};

const confirmActionHandler = async () => {
  if (!confirmAction.value || !confirmTemplate.value) {
    return;
  }

  const templateId = confirmTemplate.value.whatsapp_message_template_id;
  const result =
    confirmAction.value === 'delete'
      ? await templateStore.deleteTemplate(workerId.value, templateId)
      : await templateStore.deactivateTemplate(workerId.value, templateId);

  if (result) {
    await loadTemplates();
  }

  closeConfirm();
};

watch(
  query,
  async () => {
    await loadTemplates();
  },
  { immediate: true, deep: true }
);

watch(
  workerId,
  async () => {
    await loadWorker();
  },
  { immediate: true }
);
</script>

<template>
  <div class="whatsapp-template-page">
    <div class="whatsapp-template-page__header">
      <div class="whatsapp-template-page__header-content">
        <VBtn
          variant="tonal"
          color="secondary"
          prepend-icon="tabler-arrow-left"
          @click="router.push('/channels')"
        >
          {{ $t('back') }}
        </VBtn>
        <div>
          <h1 class="whatsapp-template-page__title">
            Modelos oficiais do WhatsApp
          </h1>
          <p class="whatsapp-template-page__subtitle">
            {{ workerName }}
          </p>
        </div>
      </div>
    </div>

    <VCard no-padding>
      <VCardText>
        <WhatsappTemplateToolbar
          :filters="toolbarFilters"
          :syncing="templateStore.syncing"
          @add="openAddEditor"
          @sync="syncTemplates"
          @update:filters="updateFilters"
        />

        <VDivider class="my-4" />

        <WhatsappTemplateTable
          :templates="templateStore.list"
          :loading="templateStore.loading"
          :total-items="templateStore.pagings.total"
          :page="options.page"
          :items-per-page="options.itemsPerPage"
          @edit="openEditEditor"
          @delete="requestDelete"
          @deactivate="requestDeactivate"
          @update:page="options.page = $event"
          @update:items-per-page="options.itemsPerPage = $event"
        />
      </VCardText>
    </VCard>

    <WhatsappTemplateEditor
      v-model="isEditorOpen"
      :template="editingTemplate"
      :saving="templateStore.saving"
      :uploading="templateStore.uploading"
      :upload-media="uploadMedia"
      @save="saveTemplate"
    />

    <VDialogHandler
      v-if="confirmAction"
      :model-value="Boolean(confirmAction)"
      :title="confirmTitle"
      :message="confirmMessage"
      @update:model-value="!Boolean($event) && closeConfirm()"
      @confirm="confirmActionHandler"
    />

    <VSnackbar
      v-model="templateStore.snackbar.status"
      :color="templateStore.snackbar.color"
    >
      {{ templateStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style scoped>
.whatsapp-template-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.whatsapp-template-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.whatsapp-template-page__header-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
}

.whatsapp-template-page__title {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0;
}

.whatsapp-template-page__subtitle {
  margin: 4px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
