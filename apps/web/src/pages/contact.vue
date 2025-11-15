<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { refDebounced } from '@vueuse/core';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { useI18n } from 'vue-i18n';
import { SortRequest } from '@core/schema/common/sortRequestSchema';
import { getAdministrator } from '@/@webcore/localStorage/user';
import { DataTableHeader } from 'vuetify';
import { useContactStore } from '@/@webcore/stores/contact';
import { EContactPermissions } from '@core/common/enums/EPermissions/contact';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { EColor } from '@core/common/enums/EColor';
import AppAddContact from '@/components/contact/AppAddContact.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EContactPermissions.contact_list,
      EContactPermissions.contact_view,
      EContactPermissions.contact_create,
      EContactPermissions.contact_update,
      EContactPermissions.contact_delete,
    ],
  },
});

const permissionsEdit = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_update,
];
const permissionsDelete = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_delete,
];
const permissionsCreate = [
  EGeneralPermissions.full_access,
  EContactPermissions.contact_create,
];

const { t } = useI18n();
const contactStore = useContactStore();
const isAdministrator = getAdministrator();

const itemsPerPage = ref([
  { value: 5, title: '5' },
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'All' },
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

const exportContactsToCsv = () => {
  const header = [
    t('name'),
    t('lastname'),
    t('email'),
    t('phone'),
    t('nickname'),
    t('label'),
    t('birthday'),
    t('notes'),
  ];

  const rows = contactStore.list.map((item) => [
    item.name ?? '',
    item.last_name ?? '',
    item.email_partial ?? item.email ?? '',
    item.phone_partial ?? '',
    item.nickname ?? '',
    item.label_template?.label ?? '',
    item.birthday ?? '',
    item.notes ?? '',
  ]);

  const delimiter = ';';
  const csv = [
    header.map(escapeCsv).join(delimiter),
    ...rows.map((r) => r.map(escapeCsv).join(delimiter)),
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

const isDialogEditContactShow = ref(false);
const isAddContactVisible = ref(false);
const isAddImportContactVisible = ref(false);
const contactToEdit = ref<string | null>(null);

const headers: DataTableHeader<ListContactResponse>[] = [
  { title: t('name'), key: 'name' },
  { title: t('lastname'), key: 'last_name' },
  { title: t('nickname'), key: 'nickname' },
  { title: t('email'), key: 'email' },
  { title: t('phone'), key: 'phone_partial' },
  { title: t('label'), key: 'label_template' },
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

const openEditDialog = (id: string) => {
  contactToEdit.value = id;

  isDialogEditContactShow.value = true;
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
              <VLabel>{{ $t('search') }}:</VLabel>
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
      </VCardText>

      <VDataTableServer
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
          <VChip
            v-if="item.label_template"
            class="uc-chip"
            size="small"
            :style="{
              backgroundColor: backgroundColor(item.label_template.color),
              color: textColor(item.label_template.color),
            }"
          >
            {{ item.label_template.label }}
          </VChip>

          <VChip v-else class="uc-chip uc-badge--muted" size="small">-</VChip>
        </template>

        <template #item.actions="{ item }">
          <div class="d-flex gap-1">
            <IconBtn
              v-if="
                $canPermission(permissionsEdit) &&
                (item?.contact_id || isAdministrator)
              "
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
              v-if="
                $canPermission(permissionsDelete) &&
                (item.contact_id || isAdministrator)
              "
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

      <VDialogHandler
        v-if="isDialogDeleterShow"
        v-model="isDialogDeleterShow"
        :title="$t('delete_contact')"
        :message="$t('delete_contact_confirmation')"
        @confirm="handleDelete"
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
      />
    </VCard>

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

<style lang="scss">
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
</style>
