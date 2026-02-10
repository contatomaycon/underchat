<script setup lang="ts">
  import { ref, watch, computed } from 'vue';
  import { refDebounced } from '@vueuse/core';
  import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
  import { useI18n } from 'vue-i18n';
  import { SortRequest } from '@core/schema/common/sortRequestSchema';
  import { DataTableHeader } from 'vuetify';
  import { useContactStore } from '@/@webcore/stores/contact';
  import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
  import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
  import { EColor } from '@core/common/enums/EColor';
  import AppAddContact from '@/components/contact/AppAddContact.vue';
  import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
  import { formatDateTime } from '@core/common/functions/formatDateTime';
  
  definePage({
    meta: {
      permissions: [
        EGeneralPermissions.full_access,
        EGeneralPermissions.full_access_group,
        EContactPermissions.contact_group,
        EContactPermissions.contact_view,
        EContactPermissions.contact_create,
        EContactPermissions.contact_update,
        EContactPermissions.contact_delete,
      ],
    },
  });
  
  const permissionsEdit = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EContactPermissions.contact_group,
    EContactPermissions.contact_update,
  ];
  const permissionsDelete = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EContactPermissions.contact_group,
    EContactPermissions.contact_delete,
  ];
  const permissionsCreate = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EContactPermissions.contact_group,
    EContactPermissions.contact_create,
  ];
  
  const { t } = useI18n();
  const contactStore = useContactStore();
  useSnackbarCleanup(contactStore);
  
  const itemsPerPage = ref([
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: 100, title: '100' },
    { value: 200, title: '200' },
  ]);
  
  const isHexColor = (s: string) => /^#([0-9A-F]{6}|[0-9A-F]{3})$/i.test(s);
  
  const backgroundColor = (s: string): string => {
    if (isHexColor(s)) return s;
  
    return EColor.primary;
  };
  
  const textColor = (s: string): string => {
    const hex = backgroundColor(s);
  
    if (!isHexColor(hex)) return '#FFFFFF';
  
    let c = hex.substring(1);
    if (c.length === 3) {
      c = c
        .split('')
        .map((ch) => ch + ch)
        .join('');
    }
  
    const r = Number.parseInt(c.slice(0, 2), 16);
    const g = Number.parseInt(c.slice(2, 4), 16);
    const b = Number.parseInt(c.slice(4, 6), 16);
  
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  
    return yiq >= 128 ? '#000000' : '#FFFFFF';
  };
  
  const escapeCsv = (value: unknown): string => {
    if (value === null || value === undefined) return '';
  
    const s = String(value).replaceAll(/\r?\n/g, ' ');
  
    if (s.includes('"') || s.includes(';') || s.includes(',')) {
      return `"${s.replaceAll('"', '""')}"`;
    }
  
    return s;
  };
  
  const formatCpfDigits = (digits: string) => {
    const clean = digits.slice(0, 11);
    if (clean.length <= 3) return clean;
    if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
    if (clean.length <= 9) {
      return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
    }
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
  };
  
  const formatCnpjDigits = (digits: string) => {
    const clean = digits.slice(0, 14);
    if (clean.length <= 2) return clean;
    if (clean.length <= 5) {
      return `${clean.slice(0, 2)}.${clean.slice(2)}`;
    }
    if (clean.length <= 8) {
      return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5)}`;
    }
    if (clean.length <= 12) {
      return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8)}`;
    }
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
  };
  
  const exportContactsToCsv = async () => {
    const contacts = await contactStore.exportContacts();
  
    if (!contacts.length) {
      return;
    }
  
    const header = [
      t('name'),
      t('lastname'),
      t('email'),
      t('phone_ddi'),
      t('phone'),
      t('document_type'),
      t('document'),
      t('nickname'),
      t('birthday'),
      t('notes'),
      t('labels'),
    ];
  
    const rows = contacts.map((item) => {
      const document = item.document ?? '';
      let documentFormatted = '';
      if (document) {
        const digits = document.replaceAll(/\D/g, '');
        const docType = item.contact_document_type_name?.toLowerCase();
        if (docType === 'cpf' && digits.length === 11) {
          documentFormatted = formatCpfDigits(digits);
        } else if (docType === 'cnpj' && digits.length === 14) {
          documentFormatted = formatCnpjDigits(digits);
        } else {
          documentFormatted = document;
        }
      }
      const labelsText = item.labels && item.labels.length > 0
        ? item.labels.map((label) => label.label).join(', ')
        : '';
      return [
        item.name ?? '',
        item.last_name ?? '',
        item.email ?? '',
        item.phone_ddi ?? '',
        item.phone ?? '',
        item.contact_document_type_name ?? '',
        documentFormatted,
        item.nickname ?? '',
        item.birthday ?? '',
        item.notes ?? '',
        labelsText,
      ];
    });
  
    const delimiter = ';';
    const csv = [
      header.map(escapeCsv).join(delimiter),
      ...rows.map((r) => {
        const escapedRow = r.map((value, index) => {
          if (index === 6 && value) {
            return `"${String(value).replaceAll('"', '""')}"`;
          }
          return escapeCsv(value);
        });
        return escapedRow.join(delimiter);
      }),
    ].join('\r\n');
  
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
  
    try {
      link.href = url;
      link.setAttribute(
        'download',
        `contacts-${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  };
  
  const isDialogDeleterShow = ref(false);
  const contactToDelete = ref<string | null>(null);
  
  const isDialogBulkDeleterShow = ref(false);
  const contactsToDelete = ref<string[]>([]);
  const isDeletingAll = ref(false);
  
  const isDialogValidateContactShow = ref(false);
  const contactToValidate = ref<string | null>(null);
  
  const isDialogEditContactShow = ref(false);
  const isAddContactVisible = ref(false);
  const isAddImportContactVisible = ref(false);
  const contactToEdit = ref<string | null>(null);
  
  const selectedContacts = ref<string[]>([]);
  
  const headers: DataTableHeader<ListContactResponse>[] = [
    { title: '', key: 'select', sortable: false, width: '50px' },
    { title: '', key: 'photo', sortable: false, width: '80px' },
    { title: t('name'), key: 'name' },
    { title: t('lastname'), key: 'last_name' },
    { title: t('nickname'), key: 'nickname' },
    { title: t('email'), key: 'email' },
    { title: t('phone'), key: 'phone_partial' },
    { title: t('label'), key: 'label_template' },
    { title: t('status'), key: 'status' },
    { title: t('registration_date'), key: 'created_at' },
    { title: t('actions'), key: 'actions', sortable: false },
  ];
  
  const options = ref({
    page: 1,
    itemsPerPage: 10,
    sortBy: [] as SortRequest[],
    search: null as string | null,
  });
  
  const debouncedSearch = refDebounced(
    computed(() => options.value.search),
    500
  );
  
  const query = computed(() => ({
    page: options.value.page,
    per_page: options.value.itemsPerPage,
    sort_by: options.value.sortBy,
    search: debouncedSearch.value,
  }));
  
  const handleTableChange = (o: {
    page: number;
    itemsPerPage: number;
    sortBy: SortRequest[];
  }) => {
    options.value.page = o.page;
    options.value.itemsPerPage = o.itemsPerPage;
    options.value.sortBy = o.sortBy;
  };
  
  const deleteContact = async (id: string) => {
    contactToDelete.value = id;
  
    isDialogDeleterShow.value = true;
  };
  
  const handleDelete = async () => {
    if (!contactToDelete.value) return;
  
    const result = await contactStore.deleteContact(contactToDelete.value);
    if (result) {
      await contactStore.listContact(query.value);
    }
  
    contactToDelete.value = null;
  };
  
  const openBulkDeleteDialog = (deleteAll: boolean = false) => {
    isDeletingAll.value = deleteAll;
    
    if (deleteAll) {
      contactsToDelete.value = contactStore.list.map((c) => c.contact_id);
    } else {
      contactsToDelete.value = [...selectedContacts.value];
    }
    
    if (contactsToDelete.value.length === 0) {
      return;
    }
    
    isDialogBulkDeleterShow.value = true;
  };
  
  const handleBulkDelete = async () => {
    if (contactsToDelete.value.length === 0) return;
  
    const result = await contactStore.bulkDeleteContacts(contactsToDelete.value);
    if (result) {
      selectedContacts.value = [];
      await contactStore.listContact(query.value);
    }
  
    contactsToDelete.value = [];
  };
  
  const selectAllContacts = async () => {
    const allContacts = await contactStore.exportContacts();
    selectedContacts.value = allContacts.map((c) => c.contact_id);
  };
  
  const clearSelection = () => {
    selectedContacts.value = [];
  };
  
  const isAllSelected = computed(() => {
    if (contactStore.list.length === 0) return false;
    return contactStore.list.every((c) =>
      selectedContacts.value.includes(c.contact_id)
    );
  });
  
  const hasSelectedContacts = computed(() => selectedContacts.value.length > 0);
  
  const toggleContactSelection = (contactId: string) => {
    const index = selectedContacts.value.indexOf(contactId);
    if (index > -1) {
      selectedContacts.value.splice(index, 1);
    } else {
      selectedContacts.value.push(contactId);
    }
  };
  
  const openEditDialog = (id: string) => {
    contactToEdit.value = id;
  
    isDialogEditContactShow.value = true;
  };
  
  const openValidateDialog = (id: string) => {
    contactToValidate.value = id;
    isDialogValidateContactShow.value = true;
  };
  
  const photoViewerOpen = ref(false);
  const photoViewerSrc = ref<string>('');
  const photoViewerDownloadName = ref<string>('contact-photo.jpg');
  
  const openPhotoViewer = (photoUrl: string | null) => {
    if (!photoUrl) return;
    photoViewerSrc.value = photoUrl;
    photoViewerDownloadName.value = `contact-photo-${Date.now()}.jpg`;
    photoViewerOpen.value = true;
  };
  
  const downloadPhoto = async (url: string, filename?: string | null) => {
    if (!url) return;
  
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = globalThis.URL.createObjectURL(blob);
  
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename || 'contact-photo.jpg';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
  
      setTimeout(() => {
        globalThis.URL.revokeObjectURL(blobUrl);
      }, 100);
    } catch (error) {
      console.error('Erro ao baixar imagem:', error);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.download = filename || 'contact-photo.jpg';
      anchor.rel = 'noopener';
      anchor.click();
    }
  };
  
  const handleValidate = async () => {
    if (!contactToValidate.value) return;
  
    const result = await contactStore.validateContact(contactToValidate.value);
    if (result) {
      await contactStore.listContact(query.value);
    }
  
    contactToValidate.value = null;
  };
  
  const handleImportCompleted = async () => {
    await contactStore.listContact(query.value);
  };
  
  watch(
    query,
    async (q) => {
      await contactStore.listContact(q);
    },
    { immediate: true, deep: true }
  );
  </script>
  
  <template>
    <div>
      <VCard :title="$t('contacts')" no-padding>
        <VCardText>
          <div class="d-flex justify-space-between flex-wrap gap-4">
            <div class="d-flex gap-4 align-center mt-5">
              <div class="d-flex align-center gap-x-2">
                <div>{{ $t('show') }}</div>
                <AppSelect
                  :model-value="options.itemsPerPage"
                  :items="itemsPerPage"
                  @update:model-value="
                    options.itemsPerPage = parseInt($event, 10)
                  "
                />
              </div>
  
              <VBtn
                v-if="$canPermission(permissionsCreate)"
                prepend-icon="tabler-plus"
                @click="isAddContactVisible = true"
              >
                {{ $t('add') }}
              </VBtn>
  
              <VBtn
                v-if="$canPermission(permissionsCreate)"
                prepend-icon="tabler-upload"
                @click="isAddImportContactVisible = true"
              >
                {{ $t('import_contacts') }}
              </VBtn>
  
              <VBtn
                variant="outlined"
                prepend-icon="tabler-download"
                @click="exportContactsToCsv"
              >
                {{ $t('export_csv') }}
              </VBtn>
            </div>
            <div class="d-flex align-center flex-wrap gap-4">
              <div class="invoice-list-filter">
                <VLabel class="text-body-2 mb-1">{{ $t('search') }}:</VLabel>
                <AppTextField
                  :placeholder="$t('search') + '...'"
                  append-inner-icon="tabler-search"
                  single-line
                  hide-details
                  dense
                  outlined
                  v-model="options.search"
                />
              </div>
            </div>
          </div>
  
          <VDivider class="my-4" />
  
          <div>
            <VDataTableServer
              class="data-table"
              v-model:page="options.page"
              v-model:items-per-page="options.itemsPerPage"
              :headers="headers"
              :items="contactStore.list"
              :items-length="contactStore.pagings.total"
              :loading="contactStore.loading"
              :sort-by="options.sortBy"
              @update:options="handleTableChange"
              :loading-text="$t('loading_text')"
            >
              <template #top>
                <div
                  v-if="hasSelectedContacts"
                  class="d-flex align-center justify-end pa-4"
                >
                  <div class="d-flex gap-2">
                    <VBtn
                      v-if="isAllSelected"
                      variant="text"
                      size="small"
                      @click="clearSelection"
                    >
                      {{ $t('clear_selection') }}
                    </VBtn>
                    <VBtn
                      v-else
                      variant="text"
                      size="small"
                      @click="selectAllContacts"
                    >
                      {{ $t('select_all') }}
                    </VBtn>
                    <VBtn
                      v-if="$canPermission(permissionsDelete)"
                      color="error"
                      variant="outlined"
                      size="small"
                      prepend-icon="tabler-trash"
                      @click="openBulkDeleteDialog(false)"
                    >
                      {{ $t('delete_selected', { count: selectedContacts.length }) }}
                    </VBtn>
                  </div>
                </div>
              </template>

              <template #item.select="{ item }">
                <VCheckbox
                  :model-value="selectedContacts.includes(item.contact_id)"
                  @update:model-value="toggleContactSelection(item.contact_id)"
                  hide-details
                  density="compact"
                />
              </template>
              <template #item.photo="{ item }">
                <div
                  class="contact-photo-square"
                  :class="{ 'cursor-pointer': item?.photo }"
                  @click="item?.photo && openPhotoViewer(item.photo)"
                >
                  <VImg
                    v-if="item?.photo"
                    :src="item.photo"
                    alt="Contact photo"
                    cover
                  />
                  <VImg
                    v-else
                    :src="'/images/svg/avatar-default.svg'"
                    alt="Default avatar"
                    cover
                  />
                </div>
              </template>
  
              <template #item.name="{ item }">
                {{ item?.name }}
              </template>
  
              <template #item.last_name="{ item }">
                {{ item?.last_name }}
              </template>
  
              <template #item.nickname="{ item }">
                {{ item?.nickname }}
              </template>
  
              <template #item.email="{ item }">
                {{ item?.email_partial }}
              </template>
  
              <template #item.phone="{ item }">
                {{ item?.phone_partial }}
              </template>
  
              <template #item.label_template="{ item }">
                <div
                  v-if="item.label_templates && item.label_templates.length > 0"
                  class="d-flex align-center gap-1"
                >
                  <VChip
                    class="uc-chip"
                    size="small"
                    :style="{
                      backgroundColor: backgroundColor(
                        item.label_templates[0].color
                      ),
                      color: textColor(item.label_templates[0].color),
                    }"
                  >
                    {{ item.label_templates[0].label }}
                  </VChip>
                  <span v-if="item.label_templates.length > 1">
                    <VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{
                        item.label_templates
                          .slice(1)
                          .map((lt) => lt.label)
                          .join(', ')
                      }}</span>
                    </VTooltip>
                    <VChip
                      class="uc-chip uc-badge--muted uc-chip-count"
                      size="x-small"
                    >
                      +{{ item.label_templates.length - 1 }}
                    </VChip>
                  </span>
                </div>
  
                <VChip v-else class="uc-chip uc-badge--muted" size="small"
                  >-</VChip
                >
              </template>
  
              <template #item.status="{ item }">
                <VChip
                  v-if="item.is_valided"
                  class="uc-chip"
                  size="small"
                  color="success"
                >
                  {{ $t('validated') }}
                </VChip>
                <VChip v-else class="uc-chip" size="small" color="error">
                  {{ $t('not_validated') }}
                </VChip>
              </template>
  
              <template #item.created_at="{ item }">
                <span>{{ formatDateTime(item?.created_at ?? null) }}</span>
              </template>
  
              <template #item.actions="{ item }">
                <div class="d-flex gap-1">
                  <IconBtn
                    v-if="
                      $canPermission(permissionsEdit) &&
                      !item.is_valided &&
                      item?.contact_id
                    "
                    ><VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ $t('validate_contact') }}</span> </VTooltip
                    ><VIcon
                      icon="tabler-refresh"
                      @click="openValidateDialog(item.contact_id)"
                  /></IconBtn>
  
                  <IconBtn
                    v-if="$canPermission(permissionsEdit) && item?.contact_id"
                    ><VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ $t('edit_contact') }}</span> </VTooltip
                    ><VIcon
                      icon="tabler-edit"
                      @click="openEditDialog(item.contact_id)"
                  /></IconBtn>
  
                  <IconBtn
                    v-if="$canPermission(permissionsDelete) && item.contact_id"
                    ><VTooltip
                      location="top"
                      transition="scale-transition"
                      activator="parent"
                    >
                      <span>{{ $t('delete_contact') }}</span> </VTooltip
                    ><VIcon
                      icon="tabler-trash"
                      @click="deleteContact(item.contact_id)"
                  /></IconBtn>
                </div>
              </template>
  
              <template #no-data>
                {{ $t('no_data_available') }}
              </template>
  
              <template #bottom>
                <TablePagination
                  v-model:page="options.page"
                  :items-per-page="options.itemsPerPage"
                  :total-items="contactStore.pagings.total"
                />
              </template>
            </VDataTableServer>
          </div>
        </VCardText>
  
        <VDialogHandler
          v-if="isDialogDeleterShow"
          v-model="isDialogDeleterShow"
          :title="$t('delete_contact')"
          :message="$t('delete_contact_confirmation')"
          @confirm="handleDelete"
        />
  
        <VDialogHandler
          v-if="isDialogBulkDeleterShow"
          v-model="isDialogBulkDeleterShow"
          :title="isDeletingAll ? $t('delete_all_contacts') : $t('delete_selected_contacts')"
          :message="isDeletingAll ? $t('delete_all_contacts_confirmation', { count: contactsToDelete.length }) : $t('delete_selected_contacts_confirmation', { count: contactsToDelete.length })"
          @confirm="handleBulkDelete"
        />
  
        <VDialogHandler
          v-if="isDialogValidateContactShow"
          v-model="isDialogValidateContactShow"
          :title="$t('validate_contact')"
          :message="$t('validate_contact_confirmation')"
          @confirm="handleValidate"
        />
  
        <AppEditContact
          v-if="isDialogEditContactShow"
          v-model="isDialogEditContactShow"
          :contact-id="contactToEdit"
        />
  
        <AppAddContact v-if="isAddContactVisible" v-model="isAddContactVisible" />
  
        <AppImportContacts
          v-if="isAddImportContactVisible"
          v-model="isAddImportContactVisible"
          @import-completed="handleImportCompleted"
        />
      </VCard>
  
      <VDialog
        v-model="photoViewerOpen"
        fullscreen
        scrim="rgba(0,0,0,.9)"
        :scrollable="false"
      >
        <div class="viewer-wrap" @click="photoViewerOpen = false">
          <div class="viewer-box" @click.stop>
            <div class="viewer-media-container">
              <img
                v-if="photoViewerSrc"
                :src="photoViewerSrc"
                alt="Contact"
                class="viewer-img"
                loading="eager"
                decoding="async"
              />
  
              <div class="viewer-actions">
                <VBtn
                  v-if="photoViewerSrc"
                  class="viewer-download"
                  icon
                  size="36"
                  variant="text"
                  @click.stop="
                    downloadPhoto(photoViewerSrc, photoViewerDownloadName)
                  "
                >
                  <VIcon size="20">tabler-download</VIcon>
                </VBtn>
                <VBtn
                  class="viewer-close"
                  icon
                  size="36"
                  variant="text"
                  @click="photoViewerOpen = false"
                >
                  <VIcon size="20">tabler-x</VIcon>
                </VBtn>
              </div>
            </div>
          </div>
        </div>
      </VDialog>
  
      <VSnackbar
        v-model="contactStore.snackbar.status"
        transition="scroll-y-reverse-transition"
        location="top end"
        :color="contactStore.snackbar.color"
      >
        {{ contactStore.snackbar.message }}
      </VSnackbar>
    </div>
  </template>
  
  <style lang="scss" scoped>
  .status-filter {
    inline-size: 12rem;
  }
  
  .invoice-list-filter {
    inline-size: 20rem;
  }
  
  .uc-chip {
    height: 24px;
    min-width: 88px;
    justify-content: center;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .uc-chip-count {
    height: 18px;
    min-width: auto;
    padding: 0 6px;
    font-size: 11px;
  }
  
  .contact-photo-square {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    overflow: hidden;
    display: inline-block;
    transition: opacity 0.2s ease;
  
    &:hover {
      opacity: 0.8;
    }
  
    :deep(.v-img) {
      width: 100%;
      height: 100%;
    }
  }
  
  .viewer-wrap {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: transparent;
    padding: 16px;
    overflow: hidden;
  }
  
  .viewer-box {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    max-width: 90vw;
    max-height: 90vh;
  }
  
  .viewer-media-container {
    position: relative;
    display: inline-block;
    max-width: 100%;
    max-height: 100%;
  }
  
  .viewer-img {
    display: block;
    width: auto;
    height: auto;
    max-width: 90vw;
    max-height: 85vh;
    object-fit: contain;
    border-radius: 12px;
  }
  
  .viewer-actions {
    position: absolute;
    top: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 10;
  }
  
  .viewer-close,
  .viewer-download {
    color: white !important;
    background: rgba(0, 0, 0, 0.5) !important;
    border-radius: 50%;
    min-width: 36px;
    height: 36px;
  
    &:hover {
      background: rgba(0, 0, 0, 0.7) !important;
    }
  }
  
  .data-table {
    :deep(.v-table__wrapper > table > thead) {
      background-color: rgba(var(--v-theme-on-surface), 0.04);
    }
  
    :deep(.v-table__wrapper > table > thead > tr > th) {
      background-color: transparent;
      color: rgb(var(--v-theme-primary));
      font-weight: 700;
      border-bottom: 1px solid rgba(var(--v-theme-primary), 0.25);
    }
  
    :deep(
      .v-table__wrapper > table > thead > tr > th .v-data-table-header__content
    ) {
      color: inherit;
    }
  }
  </style>
  