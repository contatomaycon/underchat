<script lang="ts" setup>
import { useUsersStore } from '@/@webcore/stores/user';
import { ECountry } from '@core/common/enums/ECountry';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { VForm } from 'vuetify/components/VForm';

const userStore = useUsersStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  userId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function formatPhone(e: Event) {
  const input = e.target as HTMLInputElement;
  let value = input.value.replace(/\D/g, '').slice(0, 9);

  if (value.length > 4 && value.length <= 8) {
    value = `${value.slice(0, value.length - 4)}-${value.slice(-4)}`;
  } else if (value.length > 8) {
    value = `${value.slice(0, 5)}-${value.slice(5)}`;
  }

  input.value = value;
}

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const itemsStatus = ref([
  { id: EUserStatus.active, text: t('active') },
  { id: EUserStatus.inactive, text: t('inactive') },
  { id: EUserStatus.blocked, text: t('blocked') },
]);

const itemsDocuments = ref([
  { value: EUserDocumentType.CPF, title: t('cpf') },
  { value: EUserDocumentType.CNPJ, title: t('cnpj') },
]);

const itemsCountry = ref([{ value: ECountry.Brasil, title: t('brazil') }]);

const isCPF = computed(
  () => user_document_type_id.value === EUserDocumentType.CPF
);
const isCNPJ = computed(
  () => user_document_type_id.value === EUserDocumentType.CNPJ
);

const docConfig = {
  cpf: {
    mask: '###.###.###-##',
    label: t('cpf'),
    placeholder: '000.000.000-00',
  },
  cnpj: {
    mask: '##.###.###/####-##',
    label: t('cnpj'),
    placeholder: '00.000.000/0000-00',
  },
};

const currentType = computed<'cpf' | 'cnpj' | null>(
  () => (isCPF.value && 'cpf') || (isCNPJ.value && 'cnpj') || null
);

const docMask = computed(() =>
  currentType.value ? docConfig[currentType.value].mask : ''
);
const docLabel = computed(() =>
  currentType.value ? docConfig[currentType.value].label : ''
);
const docPlaceholder = computed(() =>
  currentType.value ? docConfig[currentType.value].placeholder : ''
);

const onlyDigits = (s: string) => s.replace(/\D+/g, '');
const isPartialMasked = (v: string | null) => !!v && v.includes('*');

const docEditing = ref(false);
const showingPartial = computed(() => isPartialMasked(document.value));

function startEditDoc() {
  docEditing.value = true;
  document.value = '';
}

const cpfRegex = /^\d{11}$/;
const cnpjRegex = /^\d{14}$/;

const docRules = computed(() => [
  (v: string | null) =>
    showingPartial.value || (!!v && onlyDigits(v).length > 0) || 'Obrigatório',
  (v: string | null) => {
    if (!v || showingPartial.value) return true;
    const digits = onlyDigits(v);
    if (isCPF.value) return cpfRegex.test(digits) || t('cpf_invalid');
    if (isCNPJ.value) return cnpjRegex.test(digits) || t('cnpj_invalid');
    return true;
  },
]);

function toYmd(v: unknown): string | null {
  if (v == null) {
    return null;
  }

  if (typeof v === 'string') {
    return v.split('T')[0];
  }

  return new Date(v as any).toISOString().slice(0, 10);
}

const tab = ref('user_data');

const userId = toRef(props, 'userId');
const username = ref<string | null>(null);
const email = ref<string | null>(null);
const password = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);
const phone_ddi = ref<string | null>(null);
const phone = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const birth_date = ref<string | null>(null);
const user_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const address1 = ref<string | null>(null);
const address2 = ref<string | null>(null);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const district = ref<string | null>(null);
const user_status_id = ref<string | null>(null);
const account = ref<string | null>(null);

const refFormEditUser = ref<VForm>();

const isPasswordVisible = ref(false);
const isConfirmVisible = ref(false);

const refFormStep1 = ref<VForm>();
const refFormStep2 = ref<VForm>();

const zipInputRef = ref<HTMLInputElement | null>(null);

async function goNext() {
  if (tab.value === 'user_data') {
    const v = await refFormStep1.value?.validate();
    if (!v?.valid) return;
    tab.value = 'additional_info';
  } else if (tab.value === 'additional_info') {
    const v = await refFormStep2.value?.validate();
    if (!v?.valid) return;
    tab.value = 'address';
  }
}

function goPrev() {
  if (tab.value === 'additional_info') tab.value = 'user_data';
  else if (tab.value === 'address') tab.value = 'additional_info';
}

const rules = {
  passwordMinIfFilled: (v: string | null) =>
    !v || v.length >= 8 || t('minimum_eight_characters'),

  confirmRequiredIfPassword: (v: string | null) =>
    !password.value || !!v || t('confirm_password'),

  confirmMatches: (v: string | null) =>
    !password.value || v === password.value || t('the_password_do_not_match'),
};

const viewZipcode = async () => {
  if (!country_id.value || !zip_code.value) {
    return;
  }

  const params: ViewZipcodeRequest = {
    country_id: country_id.value,
    zipcode: zip_code.value,
  };

  const response = await userStore.viewZipcode(params);
  if (response) {
    address1.value = response.address_1;
    address2.value = response.address_2;
    city.value = response.city;
    state.value = response.state;
    district.value = response.district;
  }
};

const updateUser = async () => {
  const validateForm = await refFormEditUser?.value?.validate();
  if (!validateForm?.valid) return;

  if (!userId.value) {
    return;
  }

  const payload: EditUserParamsRequest = {
    user_id: userId.value,
  };

  const body: UpdateUserRequest = {
    username: username.value,
    email: email.value,
    password: password.value,
    user_status_id: user_status_id.value,
    user_info: {
      phone_ddi: phone_ddi.value,
      phone: phone.value,
      name: name.value,
      last_name: last_name.value,
      birth_date: toYmd(birth_date.value),
    },
    user_document: {
      user_document_type_id: user_document_type_id.value,
      document: document.value ?? '',
    },
    user_address: {
      country_id: country_id.value,
      zip_code: zip_code.value,
      address1: address1.value,
      address2: address2.value,
      city: city.value,
      state: state.value,
      district: district.value,
    },
  };

  const result = await userStore.updateUser(payload, body);

  if (result) {
    isVisible.value = false;

    await userStore.listUsers();
  }
};

const onCountryChange = async (val: number | null) => {
  country_id.value = val;

  address1.value = '';
  address2.value = '';
  city.value = '';
  state.value = '';
  district.value = '';

  if (country_id.value && zip_code.value) {
    await viewZipcode();
  } else {
    await nextTick();
    zipInputRef.value?.focus?.();
  }
};

onMounted(async () => {
  if (!userId.value) return;

  const responseUser = await userStore.viewUserById(userId.value);
  if (responseUser) {
    username.value = responseUser.username;
    email.value = responseUser.email_partial;
    phone_ddi.value = responseUser.user_info?.phone_ddi ?? null;
    phone.value = responseUser.user_info?.phone_partial ?? null;
    name.value = responseUser.user_info?.name ?? null;
    last_name.value = responseUser.user_info?.last_name ?? null;
    birth_date.value = responseUser.user_info?.birth_date ?? null;
    user_document_type_id.value =
      responseUser.user_document?.user_document_type?.user_document_type_id ??
      null;
    document.value = responseUser.user_document?.document_partial ?? null;
    country_id.value = responseUser.user_address?.country?.country_id ?? null;
    zip_code.value = responseUser.user_address?.zip_code ?? null;
    address1.value = responseUser.user_address?.address1_partial ?? null;
    address2.value = responseUser.user_address?.address2_partial ?? null;
    city.value = responseUser.user_address?.city ?? null;
    state.value = responseUser.user_address?.state ?? null;
    district.value = responseUser.user_address?.district ?? null;
    user_status_id.value = responseUser.user_status?.user_status_id ?? null;
    account.value = responseUser.account?.name ?? null;
  }
});

watch(password, () => {
  confirmPassword.value = null;
});

let timer: number | null = null;
watch(zip_code, () => {
  if (!country_id.value || !zip_code.value || zip_code.value.length < 8) return;

  if (timer) window.clearTimeout(timer);

  timer = window.setTimeout(() => {
    viewZipcode();
  }, 400);
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="1200">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="userStore.loading">
      <VOverlay
        :model-value="userStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('edit_user') }}</span>
        <DialogCloseBtn @click="isVisible = false" />
      </VCardTitle>

      <VTabs v-model="tab">
        <VTab value="user_data">{{ t('user_data') }}</VTab>
        <VTab value="additional_info">{{ t('additional_info') }}</VTab>
        <VTab value="address">{{ t('address') }}</VTab>
      </VTabs>

      <VCard flat>
        <VCardText>
          <VWindow v-model="tab" class="disable-tab-transition">
            <VWindowItem value="user_data">
              <VForm class="mt-2" ref="refFormStep1" @submit.prevent>
                <VRow>
                  <VCol md="6" cols="12">
                    <AppTextField
                      v-model="username"
                      :label="$t('username') + ':'"
                      :placeholder="$t('username')"
                    />
                  </VCol>

                  <VCol md="6" cols="12">
                    <AppTextField
                      v-model="email"
                      :label="$t('email') + ':'"
                      :placeholder="$t('email')"
                      :rules="[
                        emailValidator,
                        requiredValidator(email, $t('email_required')),
                      ]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      id="new-password"
                      name="new-password"
                      v-model="password"
                      :label="$t('password') + ':'"
                      :placeholder="$t('password')"
                      :type="isPasswordVisible ? 'text' : 'password'"
                      :autocomplete="isPasswordVisible ? 'off' : 'new-password'"
                      autocapitalize="off"
                      autocorrect="off"
                      spellcheck="false"
                      :append-inner-icon="
                        isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                      "
                      :rules="[
                        rules.passwordMinIfFilled,
                        requiredValidator(password, $t('password_required')),
                      ]"
                      @click:append-inner="
                        isPasswordVisible = !isPasswordVisible
                      "
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      id="confirm-new-password"
                      name="new-password"
                      v-model="confirmPassword"
                      :label="$t('confirm_password') + ':'"
                      :placeholder="$t('confirm_password')"
                      :type="isConfirmVisible ? 'text' : 'password'"
                      :autocomplete="isConfirmVisible ? 'off' : 'new-password'"
                      autocapitalize="off"
                      autocorrect="off"
                      spellcheck="false"
                      :append-inner-icon="
                        isConfirmVisible ? 'tabler-eye-off' : 'tabler-eye'
                      "
                      :rules="[
                        rules.confirmRequiredIfPassword,
                        rules.confirmMatches,
                      ]"
                      @click:append-inner="isConfirmVisible = !isConfirmVisible"
                    />
                  </VCol>
                  <VCol md="6" cols="12">
                    <VLabel>{{ $t('status') }}:</VLabel>
                    <AppAutocomplete
                      item-title="text"
                      item-value="id"
                      :items="itemsStatus"
                      v-model="user_status_id"
                      :placeholder="$t('select_state')"
                    />
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3">
                  <VBtn
                    variant="tonal"
                    color="secondary"
                    @click="isVisible = false"
                  >
                    {{ $t('cancel') }}
                  </VBtn>
                  <VBtn @click="goNext">{{ $t('next') }}</VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>

            <VWindowItem value="additional_info">
              <VForm class="mt-2" ref="refFormStep2" @submit.prevent>
                <VRow>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="phone_ddi"
                      type="tel"
                      :label="$t('phone_ddi') + ':'"
                      :placeholder="$t('phone_ddi')"
                      maxlength="2"
                      @input="
                        phone_ddi = phone_ddi
                          ? phone_ddi.replace(/\D/g, '').slice(0, 2)
                          : null
                      "
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="phone"
                      type="tel"
                      :label="$t('phone') + ':'"
                      :placeholder="$t('phone')"
                      @input="formatPhone"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="name"
                      :label="$t('name') + ':'"
                      :placeholder="$t('name')"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="last_name"
                      :label="$t('last_name') + ':'"
                      :placeholder="$t('last_name')"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppSelect
                      :model-value="user_document_type_id"
                      :items="itemsDocuments"
                      :label="$t('document_type') + ':'"
                      :placeholder="$t('document_type')"
                      @update:model-value="
                        user_document_type_id = $event;
                        document = null;
                      "
                    />
                  </VCol>

                  <VCol v-if="isCPF || isCNPJ" cols="12" md="6">
                    <template v-if="showingPartial && !docEditing">
                      <AppTextField
                        :model-value="document"
                        :label="docLabel + ':'"
                        readonly
                        :rules="docRules"
                        :placeholder="docPlaceholder"
                        append-inner-icon="tabler-edit"
                        @click:append-inner="startEditDoc"
                        @focus="startEditDoc"
                      />
                    </template>

                    <template v-else>
                      <AppTextField
                        v-model="document"
                        :label="docLabel + ':'"
                        :placeholder="docPlaceholder"
                        v-maska="docMask"
                        inputmode="numeric"
                        :rules="docRules"
                      />
                    </template>
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppDateTimePicker
                      v-model="birth_date"
                      :label="$t('birth_date') + ':'"
                      :placeholder="$t('birth_date')"
                    />
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3">
                  <VBtn variant="tonal" color="secondary" @click="goPrev">
                    {{ $t('previous') }}
                  </VBtn>
                  <VBtn @click="goNext">{{ $t('next') }}</VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>

            <VWindowItem value="address">
              <VForm class="mt-2" ref="refFormEditUser" @submit.prevent>
                <VRow>
                  <VCol cols="12" md="6">
                    <AppSelect
                      :label="$t('country') + ':'"
                      :placeholder="$t('country')"
                      :model-value="country_id"
                      :items="itemsCountry"
                      @update:model-value="onCountryChange"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      ref="zipInputRef"
                      v-model="zip_code"
                      :disabled="!country_id"
                      :label="$t('zip_code') + ':'"
                      :placeholder="$t('zip_code')"
                      maxlength="8"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address1"
                      :disabled="!country_id"
                      :label="$t('address') + ':'"
                      :placeholder="$t('address')"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address2"
                      :disabled="!country_id"
                      :label="$t('address_secondary') + ':'"
                      :placeholder="$t('address_secondary')"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="city"
                      :disabled="!country_id"
                      :label="$t('city') + ':'"
                      :placeholder="$t('city')"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="state"
                      :disabled="!country_id"
                      :label="$t('state') + ':'"
                      :placeholder="$t('state')"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="district"
                      :disabled="!country_id"
                      :label="$t('district') + ':'"
                      :placeholder="$t('district')"
                    />
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3">
                  <VBtn variant="tonal" color="secondary" @click="goPrev">
                    {{ $t('previous') }}
                  </VBtn>
                  <VBtn
                    variant="tonal"
                    color="secondary"
                    @click="isVisible = false"
                  >
                    {{ $t('cancel') }}
                  </VBtn>
                  <VBtn @click="updateUser"> {{ $t('save') }} </VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>
          </VWindow>
        </VCardText>
      </VCard>
    </VCard>
  </VDialog>
</template>
