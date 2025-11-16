<script lang="ts" setup>
import { VForm } from 'vuetify/components/VForm';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { useContactStore } from '@/@webcore/stores/contact';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { useCountryCodes } from '@/composables/useCountryCodes';

const contactStore = useContactStore();
const labelTemplateStore = useLabelTemplateStore();
const { items: countryCodes } = useCountryCodes();

const { t } = useI18n();

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
  contactId: string | null;
}>();

const phone_ddi = ref<string | null>(null);
const phone = ref<string | null>(null);
const phonePartialOriginal = ref<string | null>(null);

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
  get: () => {
    if (isPhoneDecrypted.value && phone.value) {
      return formatPhone(phone.value);
    }
    if (phone.value) {
      return formatPhone(phone.value);
    }
    return phonePartialOriginal.value ?? '';
  },
  set: (value: string) => {
    if (isPhoneDecrypted.value) {
      phone.value = value.replaceAll(/\D/g, '');
      return;
    }
    const numbers = value.replaceAll(/\D/g, '');
    phone.value = numbers;
    phonePartialOriginal.value = value;
  },
});

const emailFormatted = computed({
  get: () => {
    if (isEmailDecrypted.value) {
      return email.value ?? '';
    }
    const partial = emailPartialOriginal.value ?? '';
    return partial;
  },
  set: (value: string) => {
    if (isEmailDecrypted.value) {
      email.value = value;
      return;
    }
    emailPartialOriginal.value = value;
    email.value = value;
  },
});

const togglePhoneVisibility = async () => {
  if (!contactId.value) return;

  if (isPhoneDecrypted.value) {
    if (phonePartialOriginal.value?.includes('*')) {
      phone.value = null;
    }
    if (!phonePartialOriginal.value?.includes('*')) {
      phone.value = phonePartialOriginal.value?.replaceAll(/\D/g, '') ?? null;
    }
    isPhoneDecrypted.value = false;
    return;
  }

  isLoadingPhone.value = true;
  const decryptedPhone = await contactStore.getContactPhoneDecrypted(
    contactId.value
  );
  isLoadingPhone.value = false;

  if (decryptedPhone) {
    phone.value = decryptedPhone.replaceAll(/\D/g, '');
    isPhoneDecrypted.value = true;
  }
};

const toggleEmailVisibility = async () => {
  if (!contactId.value) return;

  if (isEmailDecrypted.value) {
    email.value = emailPartialOriginal.value;
    isEmailDecrypted.value = false;
    return;
  }

  isLoadingEmail.value = true;
  const decryptedEmail = await contactStore.getContactEmailDecrypted(
    contactId.value
  );
  isLoadingEmail.value = false;

  if (decryptedEmail) {
    email.value = decryptedEmail;
    isEmailDecrypted.value = true;
  }
};

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const itemsLabel = computed(() =>
  (labelTemplateStore.listAll ?? []).map((item) => ({
    value: item.label_template_id,
    title: item.label,
  }))
);

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const contactId = toRef(props, 'contactId');

const label_template_id = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const emailPartialOriginal = ref<string | null>(null);
const isEmailDecrypted = ref(false);
const isLoadingEmail = ref(false);
const isPhoneDecrypted = ref(false);
const isLoadingPhone = ref(false);
const nickname = ref<string | null>(null);
const birthday = ref<string | null>(null);
const notes = ref<string | null>(null);

const refFormEditContact = ref<VForm>();

const updateContact = async () => {
  const validateForm = await refFormEditContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactId.value) {
    return;
  }

  const payload: EditContactParamsRequest = {
    contact_id: contactId.value,
  };

  let emailToSave: string | null | undefined = undefined;
  const emailValue = email.value?.trim() || '';
  const emailPartialOriginalTrimmed = emailPartialOriginal.value?.trim() || '';

  if (isEmailDecrypted.value && emailValue) {
    emailToSave = emailValue;
  }
  if (
    !isEmailDecrypted.value &&
    emailValue &&
    !emailPartialOriginalTrimmed.includes('*')
  ) {
    if (emailValue !== emailPartialOriginalTrimmed) {
      emailToSave = emailValue;
    }
  }

  let phoneToSave: string | null | undefined = undefined;
  const phoneValue = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phonePartialOriginalNumbers = phonePartialOriginal.value
    ? phonePartialOriginal.value.replaceAll(/\D/g, '')
    : '';

  if (isPhoneDecrypted.value && phoneValue) {
    phoneToSave = phoneValue;
  }
  if (
    !isPhoneDecrypted.value &&
    phoneValue &&
    !phonePartialOriginal.value?.includes('*')
  ) {
    if (phoneValue !== phonePartialOriginalNumbers) {
      phoneToSave = phoneValue;
    }
  }

  const body: UpdateContactRequest = {
    label_template_id: label_template_id.value,
    name: name.value,
    last_name: last_name.value,
    email: emailToSave,
    phone_ddi: phone_ddi.value,
    phone: phoneToSave,
    nickname: nickname.value,
    birthday: birthday.value,
    notes: notes.value,
  };

  const result = await contactStore.updateContact(payload, body);

  if (result) {
    isVisible.value = false;

    await contactStore.listContact();
  }
};

onMounted(async () => {
  if (!contactId.value) return;

  const contact = await contactStore.getContactById(contactId.value);
  if (contact) {
    label_template_id.value = contact.label_template?.label_template_id ?? null;
    name.value = contact.name;
    last_name.value = contact.last_name ?? null;

    const emailPartial = contact.email_partial ?? '';
    emailPartialOriginal.value = emailPartial;
    email.value = emailPartial;
    isEmailDecrypted.value = false;

    phone_ddi.value = contact.phone_ddi ?? '55';

    const phonePartial = contact.phone_partial ?? '';
    phonePartialOriginal.value = phonePartial;
    if (phonePartial.includes('*')) {
      phone.value = null;
    }
    if (!phonePartial.includes('*')) {
      phone.value = phonePartial.replaceAll(/\D/g, '');
    }
    isPhoneDecrypted.value = false;

    nickname.value = contact.nickname ?? null;
    birthday.value = contact.birthday ?? null;
    notes.value = contact.notes ?? null;
  }
  await labelTemplateStore.listLabelTemplateAll();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="contactStore.loading">
      <VOverlay
        :model-value="contactStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditContact" @submit.prevent>
      <VCard :title="$t('edit_contact')">
        <VCardText>
          <VRow>
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
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="nickname"
                :label="$t('nickname') + ':'"
                :placeholder="$t('nickname')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppTextField
                v-model="emailFormatted"
                type="email"
                :label="$t('email') + ':'"
                :placeholder="$t('email')"
                :rules="[emailValidator]"
              >
                <template #append-inner>
                  <VIcon
                    :icon="isEmailDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                    class="cursor-pointer"
                    :class="{ 'opacity-50': isLoadingEmail }"
                    @click="toggleEmailVisibility"
                  />
                </template>
              </AppTextField>
            </VCol>
          </VRow>
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
                maxlength="15"
              >
                <template #append-inner>
                  <VIcon
                    :icon="isPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                    class="cursor-pointer"
                    :class="{ 'opacity-50': isLoadingPhone }"
                    @click="togglePhoneVisibility"
                  />
                </template>
              </AppTextField>
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <AppDateTimePicker
                v-model="birthday"
                :label="$t('birthday') + ':'"
                :placeholder="$t('birthday')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <AppSelect
                v-model="label_template_id"
                :items="itemsLabel"
                item-title="title"
                item-value="value"
                :label="$t('label') + ':'"
                :placeholder="$t('select_label')"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12">
              <label class="text-body-2 mb-1" for="notes-textarea">
                {{ $t('notes') }}:
              </label>
              <VTextarea v-model="notes" :placeholder="$t('notes')" />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateContact"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
