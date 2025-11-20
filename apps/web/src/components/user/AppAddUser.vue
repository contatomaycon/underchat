<script lang="ts" setup>
import { computed, onMounted, nextTick } from 'vue';
import { useUsersStore } from '@/@webcore/stores/user';
import { useAccountStore } from '@/@webcore/stores/account';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ECountry } from '@core/common/enums/ECountry';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { getAdministrator, getUser } from '@/@webcore/localStorage/user';

const userStore = useUsersStore();
const accountStore = useAccountStore();
const { items: countryCodes } = useCountryCodes();
const { t } = useI18n();

const isAdministrator = computed(() => getAdministrator());
const currentUser = computed(() => getUser());
const accountId = ref<string | null>(null);
const accountsOptions = ref<{ account_id: string; name: string }[]>([]);

const countrySearchQuery = ref('');
const isCountryMenuOpen = ref(false);

const filteredCountryCodes = computed(() => {
  if (!countrySearchQuery.value) {
    return countryCodes.value;
  }
  const query = countrySearchQuery.value.toLowerCase();
  return countryCodes.value.filter((country) =>
    country.title.toLowerCase().includes(query)
  );
});

watch(isCountryMenuOpen, (isOpen) => {
  if (!isOpen) {
    countrySearchQuery.value = '';
  }
});

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

const phoneFormatted = computed({
  get: () => formatPhone(phone.value),
  set: (value: string) => {
    phone.value = value.replaceAll(/\D/g, '');
  },
});

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

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

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');
const cpfRegex = /^\d{11}$/;
const cnpjRegex = /^\d{14}$/;

const requiredMsg = (label: string) => t('field_required', { field: label });

const docRules = computed(() => [
  (v: string | null) =>
    (!!v && onlyDigits(v).length > 0) || requiredMsg(docLabel.value),
  (v: string | null) => {
    if (!v) return true;
    const digits = onlyDigits(v);
    if (isCPF.value) return cpfRegex.test(digits) || t('cpf_invalid');
    if (isCNPJ.value) return cnpjRegex.test(digits) || t('cnpj_invalid');
    return true;
  },
]);

const tab = ref('user_data');

const email = ref<string | null>(null);
const password = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
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

const isPasswordVisible = ref(false);
const refFormAddUser = ref<VForm>();
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

const addUser = async () => {
  const validateForm = await refFormAddUser?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !email.value ||
    !password.value ||
    !phone_ddi.value ||
    !phone.value ||
    !name.value ||
    !last_name.value ||
    !birth_date.value ||
    !user_document_type_id.value ||
    !document.value ||
    !country_id.value ||
    !zip_code.value ||
    !address1.value ||
    !city.value ||
    !state.value ||
    !district.value
  ) {
    return;
  }

  const phoneNumber = phone.value.replaceAll(/\D/g, '');

  const payload: CreateUserRequest = {
    email: email.value,
    password: password.value,
    account_id: isAdministrator.value && accountId.value ? accountId.value : undefined,
    user_info: {
      phone_ddi: phone_ddi.value,
      phone: phoneNumber,
      name: name.value,
      last_name: last_name.value,
      birth_date: birth_date.value,
    },
    user_document: {
      user_document_type_id: user_document_type_id.value,
      document: document.value,
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

  const result = await userStore.addUser(payload);

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

const resetForm = () => {
  name.value = null;
  accountId.value = null;
  if (!isAdministrator.value && currentUser.value?.account_id) {
    accountId.value = currentUser.value.account_id;
  }
  refFormAddUser.value?.resetValidation();
};

const loadAccounts = async () => {
  if (isAdministrator.value) {
    const accounts = await accountStore.listAllAccounts();
    if (accounts) {
      accountsOptions.value = accounts;
    }
  } else if (currentUser.value?.account_id) {
    accountId.value = currentUser.value.account_id;
  }
};

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    await loadAccounts();
  }
});

onMounted(async () => {
  await loadAccounts();
  if (!isAdministrator.value && currentUser.value?.account_id) {
    accountId.value = currentUser.value.account_id;
  }
});

let timer: number | null = null;
watch(zip_code, () => {
  if (!country_id.value || !zip_code.value || zip_code.value.length < 8) return;

  if (timer) (globalThis as Window & typeof globalThis).clearTimeout(timer);

  timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
    viewZipcode();
  }, 400);
});

onMounted(resetForm);
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
        <span>{{ $t('add_user') }}</span>
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
                <VRow class="mb-4">
                  <VCol v-if="isAdministrator" cols="12" md="6">
                    <AppTextField
                      v-model="email"
                      type="email"
                      :label="$t('email') + ':'"
                      :placeholder="$t('email')"
                      :rules="[
                        emailValidator,
                        requiredValidator(email, $t('email_required')),
                      ]"
                    />
                  </VCol>

                  <VCol v-if="!isAdministrator" cols="12">
                    <AppTextField
                      v-model="email"
                      type="email"
                      :label="$t('email') + ':'"
                      :placeholder="$t('email')"
                      :rules="[
                        emailValidator,
                        requiredValidator(email, $t('email_required')),
                      ]"
                    />
                  </VCol>

                  <VCol v-if="isAdministrator" cols="12" md="6">
                    <AppAutocomplete
                      v-model="accountId"
                      :items="accountsOptions"
                      item-title="name"
                      item-value="account_id"
                      :label="$t('account') + ':'"
                      :placeholder="$t('select_account')"
                      :rules="[requiredValidator(accountId, $t('account_required'))]"
                    />
                  </VCol>
                </VRow>
                <VRow class="mb-4">
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
                    <div>
                      <VLabel class="mb-1 text-body-2">{{ $t('phone_ddi') }}:</VLabel>
                      <VMenu v-model="isCountryMenuOpen">
                        <template #activator="{ props: menuProps }">
                          <VTextField
                            v-bind="menuProps"
                            :model-value="
                              countryCodes.find((c) => c.value === phone_ddi)
                                ?.title || ''
                            "
                            :placeholder="$t('select_phone_ddi')"
                            variant="outlined"
                            readonly
                            append-inner-icon="tabler-chevron-down"
                          />
                        </template>
                        <VCard>
                          <VCardText class="pa-2">
                            <AppTextField
                              v-model="countrySearchQuery"
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
                            <VListItem
                              v-for="(item, index) in filteredCountryCodes"
                              :key="index"
                              :value="item.value"
                              @click="
                                () => {
                                  phone_ddi = item.value;
                                  isCountryMenuOpen = false;
                                }
                              "
                              :active="phone_ddi === item.value"
                            >
                              <VListItemTitle>{{ item.title }}</VListItemTitle>
                            </VListItem>
                          </VList>
                        </VCard>
                      </VMenu>
                    </div>
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="phoneFormatted"
                      type="tel"
                      :label="$t('phone') + ':'"
                      :placeholder="$t('phone')"
                      :rules="[requiredValidator(phoneFormatted, $t('phone_required'))]"
                      maxlength="15"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="name"
                      :label="$t('name') + ':'"
                      :placeholder="$t('name')"
                      :rules="[requiredValidator(name, $t('name_required'))]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="last_name"
                      :label="$t('last_name') + ':'"
                      :placeholder="$t('last_name')"
                      :rules="[
                        requiredValidator(last_name, $t('last_name_required')),
                      ]"
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
                    <AppTextField
                      v-model="document"
                      :label="docLabel + ':'"
                      :placeholder="docPlaceholder"
                      v-maska="docMask"
                      inputmode="numeric"
                      :rules="docRules"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppDateTimePicker
                      v-model="birth_date"
                      :label="$t('birth_date') + ':'"
                      :placeholder="$t('birth_date')"
                      :rules="[
                        requiredValidator(
                          birth_date,
                          $t('birth_date_required')
                        ),
                      ]"
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
              <VForm class="mt-2" ref="refFormAddUser" @submit.prevent>
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
                      :label="$t('zip_code') + ':'"
                      :placeholder="$t('zip_code')"
                      :rules="[
                        requiredValidator(zip_code, $t('zip_code_required')),
                      ]"
                      :disabled="!country_id"
                      @blur="viewZipcode"
                      @keydown.enter.prevent="viewZipcode"
                      maxlength="8"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address1"
                      :disabled="!country_id"
                      :label="$t('address') + ':'"
                      :placeholder="$t('address')"
                      :rules="[
                        requiredValidator(address1, $t('address_required')),
                      ]"
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
                      :rules="[requiredValidator(city, $t('city_required'))]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="state"
                      :disabled="!country_id"
                      :label="$t('state') + ':'"
                      :placeholder="$t('state')"
                      :rules="[requiredValidator(state, $t('state_required'))]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="district"
                      :disabled="!country_id"
                      :label="$t('district') + ':'"
                      :placeholder="$t('district')"
                      :rules="[
                        requiredValidator(district, $t('district_required')),
                      ]"
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
                  <VBtn @click="addUser"> {{ $t('save') }} </VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>
          </VWindow>
        </VCardText>
      </VCard>
    </VCard>
  </VDialog>
</template>
