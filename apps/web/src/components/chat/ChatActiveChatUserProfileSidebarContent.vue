<script lang="ts" setup>
import { nextTick } from 'vue';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useChatStore } from '@/@webcore/stores/chat';
import { useContactStore } from '@/@webcore/stores/contact';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { VForm } from 'vuetify/components/VForm';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { requiredValidator } from '@/@webcore/utils/validators';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';

const chatStore = useChatStore();
const contactStore = useContactStore();
const labelTemplateStore = useLabelTemplateStore();
const { items: countryCodes } = useCountryCodes();

const { t } = useI18n();

const emit = defineEmits<{
  close: [];
}>();

const countrySearchQuery = ref('');
const isCountryMenuOpen = ref(false);

const viewerOpen = ref(false);
const viewerSrc = ref<string>('');
const viewerDownloadName = ref<string>('');

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

const isContact = computed(() => !!chatStore.activeChat?.contact?.id);
const contactId = computed(() => chatStore.activeChat?.contact?.id ?? null);

const phone_ddi = ref<string | null>('55');
const phone = ref<string | null>(null);
const phonePartialOriginal = ref<string | null>(null);
const emailPartialOriginal = ref<string | null>(null);
const isPhoneDecrypted = ref(false);
const isLoadingPhone = ref(false);
const isEmailDecrypted = ref(false);
const isLoadingEmail = ref(false);

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
    if (isContact.value && isPhoneDecrypted.value && phone.value) {
      return formatPhone(phone.value);
    }
    if (isContact.value && phone.value) {
      return formatPhone(phone.value);
    }
    if (isContact.value) {
      return phonePartialOriginal.value ?? '';
    }
    return formatPhone(phone.value);
  },
  set: (value: string) => {
    if (isContact.value && isPhoneDecrypted.value) {
      phone.value = value.replaceAll(/\D/g, '');
      return;
    }
    if (isContact.value) {
      const numbers = value.replaceAll(/\D/g, '');
      phone.value = numbers;
      phonePartialOriginal.value = value;
      return;
    }
    phone.value = value.replaceAll(/\D/g, '');
  },
});

const emailFormatted = computed({
  get: () => {
    if (isContact.value && isEmailDecrypted.value) {
      return email.value ?? '';
    }
    if (isContact.value) {
      return emailPartialOriginal.value ?? '';
    }
    return email.value ?? '';
  },
  set: (value: string) => {
    if (isContact.value && isEmailDecrypted.value) {
      email.value = value;
      return;
    }
    if (isContact.value) {
      emailPartialOriginal.value = value;
      email.value = value;
      return;
    }
    email.value = value;
  },
});

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

const label_template_id = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const nickname = ref<string | null>(null);
const birthday = ref<string | null>(null);
const notes = ref<string | null>(null);
const isValided = ref<boolean>(false);

const refFormContact = ref<VForm>();

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

const determineEmailToSave = (): string | null | undefined => {
  const emailValue = email.value?.trim() || '';
  const emailPartialOriginalTrimmed = emailPartialOriginal.value?.trim() || '';

  if (isEmailDecrypted.value) {
    return emailValue || null;
  }

  if (
    !isEmailDecrypted.value &&
    emailValue &&
    emailValue !== emailPartialOriginalTrimmed
  ) {
    return emailValue;
  }

  if (!emailValue && emailPartialOriginalTrimmed) {
    return null;
  }

  if (
    !isEmailDecrypted.value &&
    emailValue &&
    !emailPartialOriginalTrimmed.includes('*')
  ) {
    return emailValue;
  }

  return undefined;
};

const determinePhoneToSave = (): string | null | undefined => {
  const phoneValue = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phonePartialOriginalNumbers = phonePartialOriginal.value
    ? phonePartialOriginal.value.replaceAll(/\D/g, '')
    : '';

  if (isPhoneDecrypted.value && phoneValue) {
    return phoneValue;
  }

  if (
    !isPhoneDecrypted.value &&
    phoneValue &&
    !phonePartialOriginal.value?.includes('*') &&
    phoneValue !== phonePartialOriginalNumbers
  ) {
    return phoneValue;
  }

  return undefined;
};

const loadContactData = async () => {
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
    isValided.value = contact.is_valided ?? false;
  }
};

const loadChatData = () => {
  if (!chatStore.activeChat) return;

  const activeChat = chatStore.activeChat;

  if (isContact.value && contactId.value) {
    void loadContactData();
    return;
  }

  name.value = activeChat.contact?.name ?? activeChat.name ?? null;
  last_name.value = null;

  phone.value = null;
  phone_ddi.value = '55';
  email.value = null;
  nickname.value = null;
  birthday.value = null;
  notes.value = null;
  label_template_id.value = null;

  if (activeChat.contact?.phone) {
    const phoneStr = activeChat.contact.phone_ddi
      ? `+${activeChat.contact.phone_ddi} ${activeChat.contact.phone}`
      : activeChat.contact.phone;
    const phoneAndDdi = extractPhoneAndDdi(phoneStr);
    if (phoneAndDdi) {
      phone.value = phoneAndDdi.phone;
      if (phoneAndDdi.phone_ddi) {
        phone_ddi.value = phoneAndDdi.phone_ddi;
      }
    }
  } else if (activeChat.phone) {
    const phoneStr = activeChat.phone.startsWith('+')
      ? activeChat.phone
      : `+${activeChat.phone}`;
    const phoneAndDdi = extractPhoneAndDdi(phoneStr);
    if (phoneAndDdi) {
      phone.value = phoneAndDdi.phone;
      if (phoneAndDdi.phone_ddi) {
        phone_ddi.value = phoneAndDdi.phone_ddi;
      }
    }
  }
};

const addContact = async () => {
  const validateForm = await refFormContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) return;

  const phoneNumber = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phoneDdi = phone_ddi.value ?? '55';

  const payload: CreateContactRequest = {
    label_template_id: label_template_id.value ?? null,
    name: name.value,
    last_name: last_name.value ?? null,
    email: email.value ?? null,
    phone_ddi: phoneDdi,
    phone: phoneNumber,
    nickname: nickname.value ?? null,
    birthday: birthday.value ?? null,
    notes: notes.value ?? null,
  };

  const result = await contactStore.addContact(payload, null);

  if (result && chatStore.activeChat?.chat_id && phoneNumber && phoneDdi) {
    await chatStore.updateChatContact(
      chatStore.activeChat.chat_id,
      phoneNumber,
      phoneDdi
    );
  }

  if (result) {
    await nextTick();
    emit('close');
  }
};

const updateContact = async () => {
  const validateForm = await refFormContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactId.value) {
    return;
  }

  const payload: EditContactParamsRequest = {
    contact_id: contactId.value,
  };

  const emailToSave = determineEmailToSave();
  const phoneToSave = determinePhoneToSave();

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

  const result = await contactStore.updateContact(payload, body, null);

  if (result) {
    await nextTick();
    emit('close');
  }
};

const saveContact = async () => {
  if (isContact.value) {
    await updateContact();
  } else {
    await addContact();
  }
};

watch(
  () => chatStore.activeChat,
  () => {
    loadChatData();
  },
  { immediate: true, deep: true }
);

const openPhotoPreview = () => {
  if (!chatStore.activeChat?.photo) return;
  viewerSrc.value = chatStore.activeChat.photo;
  viewerDownloadName.value =
    chatStore.activeChat.contact?.name ??
    chatStore.activeChat.name ??
    'profile-photo.jpg';
  viewerOpen.value = true;
};

const downloadPreviewImage = async (url: string, filename?: string | null) => {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const blobUrl = globalThis.URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename || 'image.jpg';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      globalThis.URL.revokeObjectURL(blobUrl);
    }, 100);
  } catch (error) {
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.target = '_blank';
    anchor.download = filename || 'image.jpg';
    anchor.rel = 'noopener';
    anchor.click();
  }
};

const downloadViewerMedia = () => {
  if (!viewerSrc.value) return;
  downloadPreviewImage(viewerSrc.value, viewerDownloadName.value);
};

onMounted(async () => {
  await labelTemplateStore.listLabelTemplateAll();
  loadChatData();
});
</script>

<template>
  <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
    <div
      class="pt-6 px-6 d-flex align-center justify-space-between flex-shrink-0"
      :class="$vuetify.locale.isRtl ? 'text-left' : 'text-right'"
    >
      <VChip
        v-if="isContact"
        :color="isValided ? 'success' : 'error'"
        size="small"
      >
        {{ isValided ? $t('validated') : $t('not_validated') }}
      </VChip>
      <div v-else />
      <IconBtn @click="$emit('close')">
        <VIcon icon="tabler-x" class="text-medium-emphasis" />
      </IconBtn>
    </div>

    <!-- User Avatar -->
    <div class="text-center px-6 pb-4 flex-shrink-0">
      <VAvatar
        size="120"
        :variant="!chatStore.activeChat.photo ? 'tonal' : undefined"
        :class="['mb-4', chatStore.activeChat.photo ? 'cursor-pointer' : '']"
        @click="chatStore.activeChat?.photo ? openPhotoPreview() : null"
      >
        <VImg
          v-if="chatStore.activeChat.photo"
          :src="chatStore.activeChat.photo"
          :alt="
            chatStore.activeChat.contact?.name ??
            chatStore.activeChat.name ??
            ''
          "
        />
        <VImg
          v-else
          :src="'/images/svg/avatar-default.svg'"
          :alt="
            chatStore.activeChat.contact?.name ??
            chatStore.activeChat.name ??
            ''
          "
        />
      </VAvatar>
    </div>

    <!-- Contact Form -->
    <PerfectScrollbar
      class="ps-chat-user-profile-sidebar-content pb-6 px-6 flex-grow-1"
      :options="{ wheelPropagation: false }"
    >
      <VForm ref="refFormContact" @submit.prevent="saveContact">
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
              <template v-if="isContact" #append-inner>
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
              <VMenu v-model="isCountryMenuOpen" :disabled="isContact">
                <template #activator="{ props: menuProps }">
                  <VTextField
                    v-bind="menuProps"
                    :model-value="
                      countryCodes.find((c) => c.value === phone_ddi)?.title ||
                      ''
                    "
                    :placeholder="$t('select_phone_ddi')"
                    variant="outlined"
                    :disabled="isContact"
                    :readonly="isContact"
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
            <div class="phone-field-wrapper">
              <AppTextField
                v-model="phoneFormatted"
                type="tel"
                :label="$t('phone') + ':'"
                :placeholder="$t('phone')"
                maxlength="15"
                :disabled="isContact"
                :readonly="isContact"
              />
              <VIcon
                v-if="isContact"
                size="17"
                :icon="isPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                class="cursor-pointer phone-eye-icon"
                :class="{ 'opacity-50': isLoadingPhone }"
                @click="togglePhoneVisibility"
              />
            </div>
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

        <VCardText class="d-flex justify-end flex-wrap gap-3 pa-0 mt-4">
          <VBtn variant="tonal" color="secondary" @click="$emit('close')">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="saveContact">
            {{ isContact ? $t('save') : $t('add') }}
          </VBtn>
        </VCardText>
      </VForm>
    </PerfectScrollbar>

    <VDialog
      v-model="viewerOpen"
      fullscreen
      scrim="rgba(0,0,0,.9)"
      :scrollable="false"
    >
      <div class="viewer-wrap" @click="viewerOpen = false">
        <div class="viewer-box" @click.stop>
          <div class="viewer-media-container">
            <img
              v-if="viewerSrc"
              :src="viewerSrc"
              alt=""
              class="viewer-img"
              loading="eager"
              decoding="async"
            />

            <div class="viewer-actions">
              <VBtn
                v-if="viewerSrc"
                class="viewer-download"
                icon
                size="36"
                variant="text"
                @click.stop="downloadViewerMedia"
              >
                <VIcon size="20">tabler-download</VIcon>
              </VBtn>
              <VBtn
                class="viewer-close"
                icon
                size="36"
                variant="text"
                @click="viewerOpen = false"
              >
                <VIcon size="20">tabler-x</VIcon>
              </VBtn>
            </div>
          </div>
        </div>
      </div>
    </VDialog>
  </div>
</template>

<style scoped>
.phone-field-wrapper {
  position: relative;
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
}

.viewer-close:hover,
.viewer-download:hover {
  background: rgba(0, 0, 0, 0.7) !important;
}

.phone-eye-icon {
  position: absolute;
  right: 12px;
  bottom: 10px;
  z-index: 1;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
