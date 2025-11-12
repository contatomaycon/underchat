<script lang="ts" setup>
import { useContactStore } from '@/@webcore/stores/contact';
import { useContactGroupStore } from '@/@webcore/stores/contactGroup';
import { ListContactResponse } from '@core/schema/contact/listContact/response.schema';
import { VForm } from 'vuetify/components/VForm';
import { ref, computed, watch } from 'vue';
import { refDebounced } from '@vueuse/core';
import {
  EditContactGroupParamsRequest,
  UpdateContactGroupRequest,
} from '@core/schema/contactGroup/editContactGroup/request.schema';
import { EColor } from '@core/common/enums/EColor';

const contactGroupStore = useContactGroupStore();
const contactStore = useContactStore();

const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  contactGroupId: string | null;
}>();

function uniqueById(list: ListContactResponse[]): ListContactResponse[] {
  const seen = new Set<string>();
  const out: ListContactResponse[] = [];
  for (const c of list) {
    if (!seen.has(c.contact_id)) {
      seen.add(c.contact_id);
      out.push(c);
    }
  }
  return out;
}

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

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

const headers = [
  { title: t('name'), key: 'name' },
  { title: t('phone'), key: 'phone_partial' },
  { title: t('label'), key: 'label_template' },
];

const search = ref<string>('');
const searchDebounced = refDebounced(search, 500);
const onlyGroup = ref(false);
const groupContactIds = ref<Set<string>>(new Set());

const isSearching = computed(
  () => (searchDebounced.value ?? '').trim().length > 0
);

const contactGroupId = toRef(props, 'contactGroupId');

const contactItems = computed(() => {
  const base = contactStore.list;
  let items = base;

  if (onlyGroup.value) {
    items = items.filter((c) => groupContactIds.value.has(c.contact_id));
  }

  if (!isSearching.value) {
    items = uniqueById([...items, ...selectedContacts.value]);
  }

  return items;
});

const selectedContacts = ref<ListContactResponse[]>([]);
const name = ref<string | null>(null);
const description = ref<string | null>(null);

const refFormAddContactGroup = ref<VForm>();

const addContactGroup = async () => {
  const validateForm = await refFormAddContactGroup?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactGroupId.value || !name.value) {
    return;
  }

  const payload: EditContactGroupParamsRequest = {
    contact_group_id: contactGroupId.value,
  };

  const body: UpdateContactGroupRequest = {
    name: name.value,
    description: description.value ?? undefined,
    contacts: selectedContacts.value.map((contact) => ({
      contact_id: contact.contact_id,
    })),
  };

  const result = await contactGroupStore.updateContactGroup(payload, body);

  if (result) {
    isVisible.value = false;

    await contactGroupStore.listContactGroup();
  }
};

const resetForm = () => {
  name.value = null;
  description.value = null;
  search.value = '';
  selectedContacts.value = [];
  refFormAddContactGroup.value?.resetValidation();
};

onMounted(async () => {
  await contactStore.listContact();

  resetForm();
  if (!contactGroupId.value) return;

  const contactGroup = await contactGroupStore.getContactGroupById(
    contactGroupId.value
  );
  if (contactGroup) {
    name.value = contactGroup.name;
    description.value = contactGroup.description ?? null;

    const groupContacts = contactGroup.contacts ?? [];
    groupContactIds.value = new Set(groupContacts.map((gc) => gc.contact_id));

    selectedContacts.value = contactStore.list.filter((contact) =>
      groupContacts.some((cg) => cg.contact_id === contact.contact_id)
    );
  }
});

watch(isVisible, async (visible) => {
  if (!visible) return;

  resetForm();

  await contactStore.listContact({
    page: 1,
    per_page: 10,
    sort_by: [],
    search: undefined,
  });

  if (contactGroupId.value) {
    const contactGroup = await contactGroupStore.getContactGroupById(
      contactGroupId.value
    );

    if (contactGroup) {
      name.value = contactGroup.name;
      description.value = contactGroup.description ?? null;

      const groupContacts = contactGroup.contacts ?? [];
      groupContactIds.value = new Set(groupContacts.map((gc) => gc.contact_id));

      selectedContacts.value = contactStore.list.filter((contact) =>
        groupContacts.some((cg) => cg.contact_id === contact.contact_id)
      );
    }
  }
});

watch(searchDebounced, async (value) => {
  await contactStore.listContact({
    page: 1,
    per_page: 10,
    sort_by: [],
    search: value ?? undefined,
  });
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="contactGroupStore.loading">
      <VOverlay
        :model-value="contactGroupStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAddContactGroup" @submit.prevent>
      <VCard :title="$t('add_or_delete_contact_group')">
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

            <VCol cols="12">
              <AppTextField
                v-model="description"
                :label="$t('description') + ':'"
                :placeholder="$t('description')"
              />
            </VCol>
          </VRow>

          <VRow>
            <VCol cols="12">
              <VCardText
                class="d-flex align-center justify-space-between px-0 flex-wrap gap-4"
              >
                <VCheckbox
                  v-model="onlyGroup"
                  :label="`${$t('selected_contacts')} (${selectedContacts.length})`"
                  hide-details
                  density="compact"
                />

                <div class="invoice-list-filter d-flex align-center gap-2">
                  <VLabel>{{ $t('search') }}:</VLabel>
                  <AppTextField
                    v-model="search"
                    :placeholder="$t('search') + '...'"
                    append-inner-icon="tabler-search"
                    single-line
                    hide-details
                    dense
                    outlined
                  />
                </div>
              </VCardText>
            </VCol>
          </VRow>

          <VRow>
            <VCol cols="12">
              <VDataTable
                v-model="selectedContacts"
                :headers="headers"
                :items="contactItems"
                item-value="contact_id"
                show-select
                return-object
                :items-per-page="10"
              >
                <template #item.name="{ item }">
                  <span class="font-weight-medium">
                    {{ item.name }}
                  </span>
                </template>

                <template #item.phone_partial="{ item }">
                  <span>{{ item.phone_partial }}</span>
                </template>

                <template #item.label_template="{ item }">
                  <VChip
                    v-if="item.label_template"
                    class="uc-chip"
                    size="small"
                    :style="{
                      backgroundColor: backgroundColor(
                        item.label_template.color
                      ),
                      color: textColor(item.label_template.color),
                    }"
                  >
                    {{ item.label_template.label }}
                  </VChip>

                  <VChip v-else class="uc-chip uc-badge--muted" size="small"
                    >-</VChip
                  >
                </template>
              </VDataTable>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addContactGroup"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>

<style lang="scss">
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
