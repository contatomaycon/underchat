<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useChatStore } from '@/@webcore/stores/chat';
import { ListChatLabelTemplatesResponse } from '@core/schema/chat/listLabelTemplates/response.schema';
import { ListChatUsersResponse } from '@core/schema/chat/listChatUsers/response.schema';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import AppTextField from '@/@webcore/components/app-form-elements/AppTextField.vue';
import AppDateTimePicker from '@/@webcore/components/app-form-elements/AppDateTimePicker.vue';
import moment from 'moment-timezone';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { EContactDocumentType } from '@core/common/enums/EContactDocumentType';
import {
  formatCnpj,
  normalizeCnpj,
} from '@core/common/functions/validateCnpj';
import { cnpjAlphanumericMask } from '@/@webcore/utils/masks';

const { t } = useI18n();

interface Props {
  modelValue: boolean;
  filterLabel?: string | null;
  filterPhoneDdi?: string | null;
  filterPhone?: string | null;
  filterName?: string | null;
  filterLastName?: string | null;
  filterNickname?: string | null;
  filterEmail?: string | null;
  filterBirthday?: string | Date | null;
  filterDocument?: string | null;
  filterUserId?: string | null;
  sortField?: string | null;
  sortOrder?: string | null;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:filterLabel', value: string | null): void;
  (e: 'update:filterPhoneDdi', value: string | null): void;
  (e: 'update:filterPhone', value: string | null): void;
  (e: 'update:filterName', value: string | null): void;
  (e: 'update:filterLastName', value: string | null): void;
  (e: 'update:filterNickname', value: string | null): void;
  (e: 'update:filterEmail', value: string | null): void;
  (e: 'update:filterBirthday', value: string | null): void;
  (e: 'update:filterDocument', value: string | null): void;
  (e: 'update:filterUserId', value: string | null): void;
  (e: 'update:sortField', value: string | null): void;
  (e: 'update:sortOrder', value: string | null): void;
  (e: 'filtersUpdated'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const chatStore = useChatStore();
const { items: countryCodes } = useCountryCodes();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const tags = ref<ListChatLabelTemplatesResponse[]>([]);
const isLoadingTags = ref(false);

const users = ref<ListChatUsersResponse>([]);
const isLoadingUsers = ref(false);

const filterLabelTemplateId = ref<string | null>(props.filterLabel ?? null);
const filterPhoneDdi = ref<string | null>(props.filterPhoneDdi ?? null);
const filterPhone = ref<string | null>(props.filterPhone ?? null);
const filterName = ref<string | null>(props.filterName ?? null);
const filterLastName = ref<string | null>(props.filterLastName ?? null);
const filterNickname = ref<string | null>(props.filterNickname ?? null);
const filterEmail = ref<string | null>(props.filterEmail ?? null);
const filterBirthday = ref<Date | null>(
  props.filterBirthday ? new Date(props.filterBirthday) : null
);
const filterDocument = ref<string | null>(props.filterDocument ?? null);
const filterUserId = ref<string | null>(props.filterUserId ?? null);
const sortField = ref<string | null>(props.sortField ?? 'name');
const sortOrder = ref<string | null>(props.sortOrder ?? 'asc');

const itemsDocumentTypes = ref([
  { value: null, title: t('select_option') },
  { value: EContactDocumentType.cpf, title: t('cpf') },
  { value: EContactDocumentType.cnpj, title: t('cnpj') },
]);

const documentType = ref<EContactDocumentType | null>(null);

const isCPF = computed(() => documentType.value === EContactDocumentType.cpf);
const isCNPJ = computed(() => documentType.value === EContactDocumentType.cnpj);

const formatCpfDigits = (digits: string) => {
  const clean = digits.slice(0, 11);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9) {
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  }
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
};

const documentMask = computed(() => {
  const digits = (filterDocument.value || '').replaceAll(/\D/g, '');
  const cnpj = normalizeCnpj(filterDocument.value || '');
  if (cnpj.length === 0) return undefined;
  if (cnpj.length <= 11 && !/[A-Z]/.test(cnpj)) {
    return '###.###.###-##';
  }
  return cnpjAlphanumericMask;
});

const documentFormatted = computed({
  get: () => {
    if (!filterDocument.value) return '';
    const digits = filterDocument.value.replaceAll(/\D/g, '');
    const cnpj = normalizeCnpj(filterDocument.value);
    if (cnpj.length <= 11 && !/[A-Z]/.test(cnpj)) {
      return formatCpfDigits(digits);
    }
    return formatCnpj(filterDocument.value);
  },
  set: (value: string) => {
    const digits = value.replaceAll(/\D/g, '');
    const cnpj = normalizeCnpj(value);
    const shouldUseCnpj = cnpj.length > 11 || /[A-Z]/.test(cnpj);
    filterDocument.value = shouldUseCnpj ? cnpj || null : digits || null;

    if (!shouldUseCnpj) {
      documentType.value = EContactDocumentType.cpf;
    } else {
      documentType.value = EContactDocumentType.cnpj;
    }
  },
});

watch(filterDocument, (value) => {
  if (!value) {
    documentType.value = null;
    return;
  }
  const digits = value.replaceAll(/\D/g, '');
  const cnpj = normalizeCnpj(value);
  if (cnpj.length <= 11 && !/[A-Z]/.test(cnpj)) {
    documentType.value = EContactDocumentType.cpf;
  } else {
    documentType.value = EContactDocumentType.cnpj;
  }
});

const formatDateForApi = (date: Date | string | null): string | null => {
  if (!date) return null;

  const BRAZIL_TIMEZONE = 'America/Sao_Paulo';
  let dateMoment: moment.Moment;

  if (date instanceof Date) {
    dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
  } else if (typeof date === 'string' && date.includes('-')) {
    const parts = date.split('-');
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0], 10);
      const month = Number.parseInt(parts[1], 10);
      const day = Number.parseInt(parts[2], 10);
      dateMoment = moment.tz({ year, month: month - 1, day }, BRAZIL_TIMEZONE);
    } else {
      dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
    }
  } else {
    dateMoment = moment.tz(date, BRAZIL_TIMEZONE);
  }

  if (!dateMoment.isValid()) return null;

  dateMoment.startOf('day');

  return dateMoment.format('YYYY-MM-DD');
};

const sortFieldOptions = [
  { value: 'name', title: t('name', 'Nome') },
  { value: 'last_name', title: t('last_name', 'Sobrenome') },
  { value: 'nickname', title: t('nickname', 'Apelido') },
  { value: 'email', title: t('email', 'Email') },
  { value: 'phone', title: t('phone', 'Telefone') },
  { value: 'label', title: t('filter_by_tag', 'Etiqueta') },
  { value: 'birthday', title: t('birthday', 'Aniversário') },
];

const sortOrderOptions = [
  { value: 'asc', title: t('ascending', 'Crescente') },
  { value: 'desc', title: t('descending', 'Decrescente') },
];

const loadTags = async () => {
  if (isLoadingTags.value) return;

  isLoadingTags.value = true;
  try {
    const result = await chatStore.listLabelTemplates();
    tags.value = result ?? [];
  } catch (error) {
    console.error('Error loading tags:', error);
    tags.value = [];
  } finally {
    isLoadingTags.value = false;
  }
};

const loadUsers = async () => {
  if (isLoadingUsers.value) return;

  isLoadingUsers.value = true;
  try {
    const result = await chatStore.listChatUsers();
    users.value = result ?? [];
  } catch (error) {
    console.error('Error loading users:', error);
    users.value = [];
  } finally {
    isLoadingUsers.value = false;
  }
};

const isSaving = ref(false);

const handleSave = async () => {
  isSaving.value = true;
  try {
    emit('update:filterLabel', filterLabelTemplateId.value);
    emit('update:filterPhoneDdi', filterPhoneDdi.value);
    emit('update:filterPhone', filterPhone.value);
    emit('update:filterName', filterName.value);
    emit('update:filterLastName', filterLastName.value);
    emit('update:filterNickname', filterNickname.value);
    emit('update:filterEmail', filterEmail.value);
    emit('update:filterBirthday', formatDateForApi(filterBirthday.value));
    emit('update:filterDocument', filterDocument.value);
    emit('update:filterUserId', filterUserId.value);
    emit('update:sortField', sortField.value);
    emit('update:sortOrder', sortOrder.value);
    isVisible.value = false;
    emit('filtersUpdated');
  } finally {
    isSaving.value = false;
  }
};

watch(isVisible, (visible) => {
  if (visible) {
    loadTags();
    loadUsers();
    filterLabelTemplateId.value = props.filterLabel ?? null;
    filterPhoneDdi.value = props.filterPhoneDdi ?? null;
    filterPhone.value = props.filterPhone ?? null;
    filterName.value = props.filterName ?? null;
    filterLastName.value = props.filterLastName ?? null;
    filterNickname.value = props.filterNickname ?? null;
    filterEmail.value = props.filterEmail ?? null;
    filterBirthday.value = props.filterBirthday
      ? new Date(props.filterBirthday)
      : null;
    filterDocument.value = props.filterDocument ?? null;
    filterUserId.value = props.filterUserId ?? null;
    sortField.value = props.sortField ?? 'name';
    sortOrder.value = props.sortOrder ?? 'asc';
  }
});

watch(
  () => props.filterLabel,
  (newValue) => {
    filterLabelTemplateId.value = newValue ?? null;
  }
);

watch(
  () => props.filterPhoneDdi,
  (newValue) => {
    filterPhoneDdi.value = newValue ?? null;
  }
);

watch(
  () => props.filterPhone,
  (newValue) => {
    filterPhone.value = newValue ?? null;
  }
);

watch(
  () => props.filterName,
  (newValue) => {
    filterName.value = newValue ?? null;
  }
);

watch(
  () => props.filterLastName,
  (newValue) => {
    filterLastName.value = newValue ?? null;
  }
);

watch(
  () => props.filterNickname,
  (newValue) => {
    filterNickname.value = newValue ?? null;
  }
);

watch(
  () => props.filterEmail,
  (newValue) => {
    filterEmail.value = newValue ?? null;
  }
);

watch(
  () => props.filterBirthday,
  (newValue) => {
    filterBirthday.value = newValue ? new Date(newValue) : null;
  }
);

watch(
  () => props.filterDocument,
  (newValue) => {
    filterDocument.value = newValue ?? null;
  }
);

watch(
  () => props.filterUserId,
  (newValue) => {
    filterUserId.value = newValue ?? null;
  }
);

watch(
  () => props.sortField,
  (newValue) => {
    sortField.value = newValue ?? 'name';
  }
);

watch(
  () => props.sortOrder,
  (newValue) => {
    sortOrder.value = newValue ?? 'asc';
  }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600" persistent>
    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between">
        <span>{{ $t('advanced_filters') }}</span>
        <IconBtn @click="isVisible = false">
          <VIcon>tabler-x</VIcon>
        </IconBtn>
      </VCardTitle>

      <VDivider />

      <VCardText class="pt-6">
        <VRow>
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('filter_by_tag') }}:</VLabel>
            <template v-if="isLoadingTags">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterLabelTemplateId"
                :items="
                  tags.map((tag) => ({
                    value: tag.label_template_id,
                    title: tag.label,
                    color: tag.color,
                  }))
                "
                :placeholder="$t('select_tag_filter')"
                clearable
                item-value="value"
                item-title="title"
              >
                <template #item-prepend="{ item }">
                  <VAvatar
                    v-if="item.color"
                    :color="item.color"
                    size="24"
                    class="me-2"
                  />
                </template>
                <template #prepend-inner="{ item }">
                  <VAvatar
                    v-if="item && !Array.isArray(item) && item.color"
                    :color="item.color"
                    size="20"
                    class="me-2"
                  />
                </template>
              </AppSelectSearch>
            </template>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
            <AppTextField
              v-model="filterEmail"
              type="email"
              :placeholder="$t('email')"
            >
              <template #append-inner>
                <VIcon
                  v-if="filterEmail"
                  icon="tabler-x"
                  class="cursor-pointer"
                  @click.stop="filterEmail = null"
                />
              </template>
            </AppTextField>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('phone_ddi') }}:</VLabel>
            <AppSelectSearch
              v-model="filterPhoneDdi"
              :items="countryCodes"
              :placeholder="$t('select_phone_ddi')"
              clearable
              item-value="value"
              item-title="title"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('phone') }}:</VLabel>
            <AppTextField
              v-model="filterPhone"
              :placeholder="'(00) 00000-0000'"
              v-maska="'(##) #####-####'"
            >
              <template #append-inner>
                <VIcon
                  v-if="filterPhone"
                  icon="tabler-x"
                  class="cursor-pointer"
                  @click.stop="filterPhone = null"
                />
              </template>
            </AppTextField>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
            <AppTextField
              v-model="filterName"
              :placeholder="$t('name')"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('last_name') }}:</VLabel>
            <AppTextField
              v-model="filterLastName"
              :placeholder="$t('last_name')"
              clearable
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('nickname') }}:</VLabel>
            <AppTextField
              v-model="filterNickname"
              :placeholder="$t('nickname')"
            >
              <template #append-inner>
                <VIcon
                  v-if="filterNickname"
                  icon="tabler-x"
                  class="cursor-pointer"
                  @click.stop="filterNickname = null"
                />
              </template>
            </AppTextField>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('birthday') }}:</VLabel>
            <AppDateTimePicker
              v-model="filterBirthday"
              :placeholder="$t('birthday')"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">{{ $t('document') }}:</VLabel>
            <AppTextField
              v-model="documentFormatted"
              :placeholder="
                isCPF
                  ? '000.000.000-00'
                  : isCNPJ
                    ? '00.AAA.000/00AA-00'
                    : $t('document')
              "
              v-maska="documentMask"
              :inputmode="isCNPJ ? undefined : 'numeric'"
            >
              <template #append-inner>
                <VIcon
                  v-if="filterDocument"
                  icon="tabler-x"
                  class="cursor-pointer"
                  @click.stop="filterDocument = null"
                />
              </template>
            </AppTextField>
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('filter_by_attendant') }}:</VLabel
            >
            <template v-if="isLoadingUsers">
              <VSkeletonLoader type="text" width="100%" height="40" />
            </template>
            <template v-else>
              <AppSelectSearch
                v-model="filterUserId"
                :items="
                  users.map((user) => ({
                    value: user.user_id,
                    title: user.name ?? user.user_id,
                  }))
                "
                :placeholder="$t('select_attendant_filter')"
                clearable
                item-value="value"
                item-title="title"
              />
            </template>
          </VCol>
        </VRow>

        <VRow>
          <VCol cols="12" class="mt-6">
            <VDivider />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1"
              >{{ $t('sort_by', 'Ordenar por') }}:</VLabel
            >
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
            <VLabel class="text-body-2 mb-1"
              >{{ $t('sort_order', 'Ordem') }}:</VLabel
            >
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
        <VBtn variant="tonal" color="secondary" @click="isVisible = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn :loading="isSaving" @click="handleSave">
          {{ $t('filter') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
