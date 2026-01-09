<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, useAttrs } from 'vue';
import type { PropType } from 'vue';
import type {
  Options as FlatpickrOptions,
  DateOption,
} from 'flatpickr/dist/types/options';
import FlatPickr from 'vue-flatpickr-component';
import { useTheme } from 'vuetify';
import { makeVFieldProps } from 'vuetify/lib/components/VField/VField';
import { makeVInputProps } from 'vuetify/lib/components/VInput/VInput';
import { VField, VInput, VLabel } from 'vuetify/components';
import { filterInputAttrs } from 'vuetify/lib/util/helpers';
import { useConfigStore } from '@webcore/stores/config';
import { Portuguese } from 'flatpickr/dist/l10n/pt';

defineOptions({
  inheritAttrs: false,
});

type DateModelValue = DateOption | DateOption[] | null;

const props = defineProps({
  modelValue: {
    type: null as unknown as PropType<DateModelValue>,
    default: null,
  },
  autofocus: Boolean,
  counter: [Boolean, Number, String] as PropType<true | number | string>,
  counterValue: Function as PropType<(value: any) => number>,
  prefix: String,
  placeholder: String,
  persistentPlaceholder: Boolean,
  persistentCounter: Boolean,
  suffix: String,
  type: {
    type: String,
    default: 'text',
  },
  modelModifiers: Object as PropType<Record<string, boolean>>,
  ...makeVInputProps({
    density: 'comfortable',
    hideDetails: 'auto',
  }),
  ...makeVFieldProps({
    variant: 'outlined',
    color: 'primary',
  }),
});

const emit = defineEmits<Emit>();

interface Emit {
  (e: 'update:modelValue', val: DateOption | DateOption[] | null): void;
  (e: 'click:clear', el: MouseEvent): void;
}

const configStore = useConfigStore();
const attrs = useAttrs();
const [rootAttrs, compAttrsRaw] = filterInputAttrs(attrs);
type CompAttrs = Partial<FlatpickrOptions> & {
  config?: FlatpickrOptions & { inline?: boolean };
} & Record<string, unknown>;
const compAttrs = compAttrsRaw as CompAttrs;

const inputProps = ref(VInput.filterProps(props));
const fieldProps = ref(VField.filterProps(props));

const refFlatPicker = ref();

const { focused } = useFocus(refFlatPicker);
const isCalendarOpen = ref(false);
const isInlinePicker = ref(false);

if (compAttrs.config && compAttrs.config.inline) {
  isInlinePicker.value = compAttrs.config.inline;
  Object.assign(compAttrs, { altInputClass: 'inlinePicker' });
}

const isValidDateValue = (
  day: number,
  month: number,
  year: number
): boolean => {
  if (day < 1 || day > 31) return false;
  if (month < 1 || month > 12) return false;
  if (year < 1900 || year > 2100) return false;

  const date = new Date(year, month - 1, day);
  return (
    date.getDate() === day &&
    date.getMonth() === month - 1 &&
    date.getFullYear() === year
  );
};

const isValidTime = (hours: number, minutes: number): boolean => {
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
};

const areAllNumbersValid = (
  day: number,
  month: number,
  year: number,
  hours?: number,
  minutes?: number
): boolean => {
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) {
    return false;
  }

  if (hours !== undefined && minutes !== undefined) {
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return false;
    }
    return isValidTime(hours, minutes);
  }

  return true;
};

const parseDateTimeWithSlash = (trimmed: string): Date | null => {
  const dateTimeMatch = trimmed.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/
  );

  if (!dateTimeMatch) {
    return null;
  }

  const day = Number.parseInt(dateTimeMatch[1], 10);
  const month = Number.parseInt(dateTimeMatch[2], 10);
  const year = Number.parseInt(dateTimeMatch[3], 10);
  const hours = Number.parseInt(dateTimeMatch[4], 10);
  const minutes = Number.parseInt(dateTimeMatch[5], 10);

  if (
    !areAllNumbersValid(day, month, year, hours, minutes) ||
    !isValidDateValue(day, month, year)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes);
};

const parseDateTimeWithDash = (trimmed: string): Date | null => {
  const dateTimeDashMatch = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/
  );

  if (!dateTimeDashMatch) {
    return null;
  }

  const year = Number.parseInt(dateTimeDashMatch[1], 10);
  const month = Number.parseInt(dateTimeDashMatch[2], 10);
  const day = Number.parseInt(dateTimeDashMatch[3], 10);
  const hours = Number.parseInt(dateTimeDashMatch[4], 10);
  const minutes = Number.parseInt(dateTimeDashMatch[5], 10);

  if (
    !areAllNumbersValid(day, month, year, hours, minutes) ||
    !isValidDateValue(day, month, year)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes);
};

const parseDateOnlyWithSlash = (trimmed: string): Date | null => {
  const partsSlash = trimmed.split('/');

  if (partsSlash.length !== 3) {
    return null;
  }

  const day = Number.parseInt(partsSlash[0], 10);
  const month = Number.parseInt(partsSlash[1], 10);
  const year = Number.parseInt(partsSlash[2], 10);

  if (
    !areAllNumbersValid(day, month, year) ||
    !isValidDateValue(day, month, year)
  ) {
    return null;
  }

  return new Date(year, month - 1, day);
};

const parseDateOnlyWithDash = (trimmed: string): Date | null => {
  const partsDash = trimmed.split('-');

  if (partsDash.length !== 3) {
    return null;
  }

  const year = Number.parseInt(partsDash[0], 10);
  const month = Number.parseInt(partsDash[1], 10);
  const day = Number.parseInt(partsDash[2], 10);

  if (
    !areAllNumbersValid(day, month, year) ||
    !isValidDateValue(day, month, year)
  ) {
    return null;
  }

  return new Date(year, month - 1, day);
};

const emitModelValue = (val: DateOption | DateOption[] | null) => {
  emit('update:modelValue', val);
};

const updateAltInputFormat = (selectedDates: Date[], instance: any): void => {
  const altInput = instance.altInput as HTMLInputElement;
  if (!altInput) return;

  if (selectedDates.length > 0) {
    const date = selectedDates[0];
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hasTime = instance.config.enableTime;
    if (hasTime) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      altInput.value = `${day}/${month}/${year} ${hours}:${minutes}`;
    } else {
      altInput.value = `${day}/${month}/${year}`;
    }
  }

  const originalInput = instance.input as HTMLInputElement;
  if (originalInput) {
    originalInput.style.display = 'none';
  }
};

const defaultConfig: FlatpickrOptions = {
  locale: Portuguese,
  dateFormat: 'Y-m-d',
  altInput: true,
  altFormat: 'd/m/Y',
  allowInput: true,
  clickOpens: true,
  onOpen: (selectedDates, dateStr, instance) => {
    if (!props.modelValue && selectedDates.length === 0) {
      const now = new Date();
      instance.setDate(now, false);
      emitModelValue(now);
      updateAltInputFormat(instance.selectedDates, instance);
    }
  },
  onReady: (selectedDates, dateStr, instance) => {
    const originalInput = instance.input as HTMLInputElement;
    if (originalInput) {
      originalInput.style.display = 'none';
    }
    updateAltInputFormat(selectedDates, instance);
    nextTick(() => {
      enableYearEditing();
      setupInputMask();
      setupTimeInputAutoUpdate();
      updateAltInputFormat(selectedDates, instance);
    });
  },
  onChange: (selectedDates, dateStr, instance) => {
    updateAltInputFormat(selectedDates, instance);
    nextTick(() => {
      setupInputMask();
    });
  },
  onValueUpdate: (selectedDates, dateStr, instance) => {
    updateAltInputFormat(selectedDates, instance);
  },
  onClose: (selectedDates, dateStr, instance) => {
    updateAltInputFormat(selectedDates, instance);
    nextTick(() => {
      updateAltInputFormat(selectedDates, instance);
    });
  },
  parseDate: (datestr: string, format: string): Date => {
    if (!datestr || typeof datestr !== 'string') {
      return new Date();
    }

    const trimmed = datestr.trim();
    const hasTime =
      format.includes('H') || format.includes('h') || trimmed.includes(':');

    if (hasTime) {
      const dateTimeWithSlash = parseDateTimeWithSlash(trimmed);
      if (dateTimeWithSlash) {
        return dateTimeWithSlash;
      }

      const dateTimeWithDash = parseDateTimeWithDash(trimmed);
      if (dateTimeWithDash) {
        return dateTimeWithDash;
      }
    }

    const dateOnlyWithSlash = parseDateOnlyWithSlash(trimmed);
    if (dateOnlyWithSlash) {
      return dateOnlyWithSlash;
    }

    const dateOnlyWithDash = parseDateOnlyWithDash(trimmed);
    if (dateOnlyWithDash) {
      return dateOnlyWithDash;
    }

    return new Date();
  },
  formatDate: (date: Date, format: string): string => {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime()))
      return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hasTime = format.includes('H') || format.includes('h');
    if (hasTime) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
    return `${year}-${month}-${day}`;
  },
  prevArrow:
    '<i class="tabler-chevron-left v-icon" style="font-size: 20px; height: 20px; width: 20px;"></i>',
  nextArrow:
    '<i class="tabler-chevron-right v-icon" style="font-size: 20px; height: 20px; width: 20px;"></i>',
};

compAttrs.config = {
  ...defaultConfig,
  ...compAttrs.config,
};

const onClear = (el: MouseEvent) => {
  el.stopPropagation();

  nextTick(() => {
    emit('update:modelValue', null);
    emit('click:clear', el);
  });
};

const normalizeDay = (day: string): string => {
  const dayNum = Number.parseInt(day, 10);
  return dayNum > 31 ? '31' : day;
};

const normalizeMonth = (month: string): string => {
  const monthNum = Number.parseInt(month, 10);
  return monthNum > 12 ? '12' : month;
};

const formatPartialDate = (
  digits: string,
  day: string,
  month: string
): string => {
  if (digits.length === 1) {
    const d = Number.parseInt(digits[0], 10);
    return d > 3 ? '' : digits;
  }

  if (digits.length === 2) {
    return normalizeDay(day);
  }

  if (digits.length === 3) {
    return `${normalizeDay(day)}/${digits[2]}`;
  }

  if (digits.length === 4) {
    return `${normalizeDay(day)}/${normalizeMonth(month)}`;
  }

  return '';
};

const extractDigits = (value: string): string => {
  return Array.from(value)
    .filter((char) => /\d/.test(char))
    .join('');
};

const applyDateMask = (value: string): string => {
  const digits = extractDigits(value).slice(0, 8);
  if (digits.length === 0) return '';

  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);

  if (digits.length < 5) {
    return formatPartialDate(digits, day, month);
  }

  return `${normalizeDay(day)}/${normalizeMonth(month)}/${year}`;
};

const validateDateInput = (value: string): boolean => {
  const parts = value.split('/');
  if (parts.length !== 3) return true;

  const day = Number.parseInt(parts[0], 10);
  const month = Number.parseInt(parts[1], 10);
  const year = Number.parseInt(parts[2], 10);

  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year))
    return true;

  if (parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
    return isValidDateValue(day, month, year);
  }

  if (parts[0].length === 2 && Number.parseInt(parts[0], 10) > 31) return false;
  if (parts[1].length === 2 && Number.parseInt(parts[1], 10) > 12) return false;

  return true;
};

const enableYearEditing = () => {
  if (!refFlatPicker.value?.fp) return;

  const calendarContainer = refFlatPicker.value.fp.calendarContainer;
  if (!calendarContainer) return;

  const yearInput = calendarContainer.querySelector(
    '.numInput.cur-year'
  ) as HTMLInputElement;

  if (!yearInput) return;

  yearInput.readOnly = false;
  yearInput.removeAttribute('readonly');
  yearInput.setAttribute('contenteditable', 'true');
  yearInput.style.pointerEvents = 'auto';
  yearInput.style.cursor = 'text';
  yearInput.style.userSelect = 'text';
  yearInput.style.webkitUserSelect = 'text';

  const handleYearClick = (e: MouseEvent) => {
    e.stopPropagation();
    yearInput.focus();
    setTimeout(() => {
      yearInput.select();
    }, 10);
  };

  const handleYearFocus = () => {
    setTimeout(() => {
      yearInput.select();
    }, 10);
  };

  const handleYearMouseDown = (e: MouseEvent) => {
    e.stopPropagation();
  };

  yearInput.removeEventListener('click', handleYearClick);
  yearInput.removeEventListener('focus', handleYearFocus);
  yearInput.removeEventListener('mousedown', handleYearMouseDown);

  yearInput.addEventListener('click', handleYearClick, true);
  yearInput.addEventListener('focus', handleYearFocus, true);
  yearInput.addEventListener('mousedown', handleYearMouseDown, true);
};

const setupTimeInputAutoUpdate = () => {
  if (!refFlatPicker.value?.fp) return;

  const instance = refFlatPicker.value.fp;
  if (!instance.config.enableTime) return;

  const originalInput = instance.input as HTMLInputElement;
  if (originalInput) {
    originalInput.style.display = 'none';
  }

  const calendarContainer = instance.calendarContainer;
  if (!calendarContainer) return;

  const hourInput = calendarContainer.querySelector(
    '.flatpickr-hour'
  ) as HTMLInputElement;
  const minuteInput = calendarContainer.querySelector(
    '.flatpickr-minute'
  ) as HTMLInputElement;

  if (!hourInput || !minuteInput) return;

  const updateTime = () => {
    const selectedDates = instance.selectedDates;
    if (selectedDates.length === 0) return;

    const currentDate = selectedDates[0];
    const hourValue = Number.parseInt(hourInput.value, 10);
    const minuteValue = Number.parseInt(minuteInput.value, 10);

    if (
      !Number.isNaN(hourValue) &&
      !Number.isNaN(minuteValue) &&
      hourValue >= 0 &&
      hourValue < 24 &&
      minuteValue >= 0 &&
      minuteValue < 60
    ) {
      const newDate = new Date(currentDate);
      newDate.setHours(hourValue);
      newDate.setMinutes(minuteValue);

      instance.setDate(newDate, false);
      emitModelValue(newDate);
      updateAltInputFormat(instance.selectedDates, instance);
    }
  };

  const handleHourInput = () => {
    updateTime();
  };

  const handleMinuteInput = () => {
    updateTime();
  };

  hourInput.removeEventListener('input', handleHourInput);
  minuteInput.removeEventListener('input', handleMinuteInput);

  hourInput.addEventListener('input', handleHourInput);
  minuteInput.addEventListener('input', handleMinuteInput);
};

const onCalendarOpen = () => {
  isCalendarOpen.value = true;

  nextTick(() => {
    if (refFlatPicker.value?.fp) {
      const instance = refFlatPicker.value.fp;

      if (!props.modelValue && instance.selectedDates.length === 0) {
        const now = new Date();
        instance.setDate(now, false);
        emitModelValue(now);
        updateAltInputFormat(instance.selectedDates, instance);
      }

      enableYearEditing();
      setupInputMask();
      setupTimeInputAutoUpdate();

      const calendarContainer = instance.calendarContainer;
      if (calendarContainer) {
        const observer = new MutationObserver(() => {
          enableYearEditing();
          setupTimeInputAutoUpdate();
        });

        observer.observe(calendarContainer, {
          childList: true,
          subtree: true,
        });

        setTimeout(() => {
          observer.disconnect();
        }, 1000);
      }
    }
  });
};

const vuetifyTheme = useTheme();
const vuetifyThemesName = Object.keys(vuetifyTheme.themes.value);

const updateThemeClassInCalendar = () => {
  const container = refFlatPicker.value.fp.calendarContainer;
  if (!container) return;

  for (const t of vuetifyThemesName) {
    container.classList.remove(`v-theme--${t}`);
  }
  container.classList.add(`v-theme--${vuetifyTheme.global.name.value}`);
};

watch(() => configStore.theme, updateThemeClassInCalendar);

let inputMaskHandlers: {
  handleInput: ((e: Event) => void) | null;
  handleKeyDown: ((e: KeyboardEvent) => void) | null;
  handlePaste: ((e: ClipboardEvent) => void) | null;
} = {
  handleInput: null,
  handleKeyDown: null,
  handlePaste: null,
};

const setupInputMask = () => {
  if (!refFlatPicker.value?.fp) return;

  const instance = refFlatPicker.value.fp;
  const input = (instance.altInput || instance.input) as HTMLInputElement;
  if (!input) return;

  const hasTime = instance.config.enableTime || false;

  if (inputMaskHandlers.handleInput) {
    input.removeEventListener('input', inputMaskHandlers.handleInput);
  }
  if (inputMaskHandlers.handleKeyDown) {
    input.removeEventListener('keydown', inputMaskHandlers.handleKeyDown);
  }
  if (inputMaskHandlers.handlePaste) {
    input.removeEventListener('paste', inputMaskHandlers.handlePaste);
  }

  if (hasTime) {
    return;
  }

  const findDigitPosition = (value: string, targetDigit: number): number => {
    let digitCount = 0;
    for (let i = 0; i < value.length; i++) {
      if (/\d/.test(value[i])) {
        digitCount++;
        if (digitCount === targetDigit) {
          return i + 1;
        }
      }
    }
    return value.length;
  };

  const calculateCursorPosition = (
    maskedValue: string,
    maskedDigits: string,
    digitsBeforeCursor: number,
    digitsAfter: number
  ): number => {
    if (digitsAfter > digitsBeforeCursor) {
      const digitsAdded = digitsAfter - digitsBeforeCursor;
      const newDigitPosition = digitsBeforeCursor + digitsAdded;

      if (newDigitPosition === 2 && maskedDigits.length >= 2) {
        return 3;
      }
      if (newDigitPosition === 4 && maskedDigits.length >= 4) {
        return 6;
      }
      return findDigitPosition(maskedValue, newDigitPosition);
    }

    return findDigitPosition(maskedValue, digitsBeforeCursor);
  };

  const updateCursorPosition = (
    target: HTMLInputElement,
    maskedValue: string,
    maskedDigits: string,
    digitsBeforeCursor: number,
    digitsAfter: number
  ): void => {
    const newCursorPos = Math.min(
      calculateCursorPosition(
        maskedValue,
        maskedDigits,
        digitsBeforeCursor,
        digitsAfter
      ),
      maskedValue.length
    );

    nextTick(() => {
      target.setSelectionRange(newCursorPos, newCursorPos);
    });
  };

  const validateAndSetError = (
    target: HTMLInputElement,
    maskedValue: string
  ): void => {
    if (maskedValue.length === 10 && !validateDateInput(maskedValue)) {
      target.setCustomValidity('Data inválida');
      target.reportValidity();
      setTimeout(() => {
        target.setCustomValidity('');
      }, 2000);
      return;
    }

    if (maskedValue.length < 10) {
      target.setCustomValidity('');
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const originalValue = target.value;
    const cursorPosBefore = target.selectionStart || 0;

    const digitsBeforeCursor = extractDigits(
      originalValue.slice(0, cursorPosBefore)
    ).length;
    const allDigits = extractDigits(originalValue);
    const digitsAfter = allDigits.length;

    const maskedValue = applyDateMask(originalValue);
    const maskedDigits = extractDigits(maskedValue);

    if (maskedValue !== originalValue) {
      target.value = maskedValue;
      updateCursorPosition(
        target,
        maskedValue,
        maskedDigits,
        digitsBeforeCursor,
        digitsAfter
      );
    }

    validateAndSetError(target, maskedValue);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLInputElement;
    const key = e.key;

    if (key === 'Backspace' || key === 'Delete') {
      return;
    }

    if (key === 'v' && (e.ctrlKey || e.metaKey)) {
      return;
    }

    if (
      !/\d/.test(key) &&
      !['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(key)
    ) {
      e.preventDefault();
      return;
    }

    const currentValue = target.value;
    const selectionStart = target.selectionStart || 0;
    const selectionEnd = target.selectionEnd || 0;
    const hasSelection = selectionStart !== selectionEnd;

    if (hasSelection && /\d/.test(key)) {
      e.preventDefault();
      const beforeSelection = currentValue.slice(0, selectionStart);
      const afterSelection = currentValue.slice(selectionEnd);
      const newValue = beforeSelection + key + afterSelection;
      target.value = applyDateMask(newValue);

      const digitsBeforeCursor = extractDigits(beforeSelection).length + 1;
      const newCursorPos = findDigitPosition(target.value, digitsBeforeCursor);
      target.setSelectionRange(newCursorPos, newCursorPos);

      const event = new Event('input', { bubbles: true });
      target.dispatchEvent(event);
      return;
    }

    const digits = extractDigits(currentValue);

    if (digits.length >= 8 && /\d/.test(key) && !hasSelection) {
      e.preventDefault();
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData?.getData('text') || '';
    const maskedValue = applyDateMask(pastedText);
    if (maskedValue) {
      const target = e.target as HTMLInputElement;
      target.value = maskedValue;
      const event = new Event('input', { bubbles: true });
      target.dispatchEvent(event);

      if (maskedValue.length === 10 && !validateDateInput(maskedValue)) {
        target.setCustomValidity('Data inválida');
        target.reportValidity();
        setTimeout(() => {
          target.setCustomValidity('');
        }, 2000);
      }
    }
  };

  inputMaskHandlers.handleInput = handleInput;
  inputMaskHandlers.handleKeyDown = handleKeyDown;
  inputMaskHandlers.handlePaste = handlePaste;

  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', handleKeyDown);
  input.addEventListener('paste', handlePaste);
};

onMounted(() => {
  updateThemeClassInCalendar();
  nextTick(() => {
    setupInputMask();
  });
});

watch(
  () => props,
  () => {
    fieldProps.value = VField.filterProps(props);
    inputProps.value = VInput.filterProps(props);
  },
  {
    deep: true,
    immediate: true,
  }
);

watch(
  () => props.modelValue,
  () => {
    if (refFlatPicker.value?.fp) {
      const instance = refFlatPicker.value.fp;
      const originalInput = instance.input as HTMLInputElement;
      if (originalInput) {
        originalInput.style.display = 'none';
      }
      nextTick(() => {
        updateAltInputFormat(instance.selectedDates, instance);
      });
    }
  }
);

const elementId = computed(() => {
  const _elementIdToken =
    fieldProps.value.id || fieldProps.value.label || inputProps.value.id;

  const _id = useId();

  return _elementIdToken ? `app-picker-field-${_elementIdToken}` : _id;
});
</script>

<template>
  <div class="app-picker-field">
    <VLabel
      v-if="fieldProps.label"
      class="mb-1 text-body-2"
      :for="elementId"
      :text="fieldProps.label"
    />

    <VInput
      v-bind="{ ...inputProps, ...rootAttrs }"
      :model-value="props.modelValue"
      :hide-details="props.hideDetails"
      :class="[
        {
          'v-text-field--prefixed': props.prefix,
          'v-text-field--suffixed': props.suffix,
          'v-text-field--flush-details': ['plain', 'underlined'].includes(
            props.variant
          ),
        },
        props.class,
      ]"
      class="position-relative v-text-field"
      :style="props.style"
    >
      <template
        #default="{ id, isDirty, isValid, isDisabled, isReadonly, validate }"
      >
        <VField
          v-bind="{ ...fieldProps, label: undefined }"
          :id="id.value"
          :active="focused || isDirty.value || isCalendarOpen"
          :focused="focused || isCalendarOpen"
          :dirty="isDirty.value || props.dirty"
          :error="isValid.value === false"
          :disabled="isDisabled.value"
          @click:clear="onClear"
        >
          <template #default="{ props: vFieldProps }">
            <div v-bind="vFieldProps">
              <FlatPickr
                v-if="!isInlinePicker"
                v-bind="compAttrs"
                ref="refFlatPicker"
                :model-value="props.modelValue"
                :placeholder="props.placeholder"
                :readonly="isReadonly.value"
                class="flat-picker-custom-style h-100 w-100"
                :disabled="isReadonly.value"
                @on-open="onCalendarOpen"
                @on-close="
                  isCalendarOpen = false;
                  validate();
                "
                @update:model-value="emitModelValue"
              />

              <input
                v-if="isInlinePicker"
                :value="props.modelValue"
                :placeholder="props.placeholder"
                :readonly="isReadonly.value"
                class="flat-picker-custom-style h-100 w-100"
                type="text"
              />
            </div>
          </template>
        </VField>
      </template>
    </VInput>

    <FlatPickr
      v-if="isInlinePicker"
      v-bind="compAttrs"
      ref="refFlatPicker"
      :model-value="props.modelValue"
      @update:model-value="emitModelValue"
      @on-open="isCalendarOpen = true"
      @on-close="isCalendarOpen = false"
    />
  </div>
</template>

<style lang="scss">
@use '@webcore/scss/template/mixins' as templateMixins;
@use 'flatpickr/dist/flatpickr.css';
@use '@webcore/scss/base/mixins';

.flat-picker-custom-style {
  position: absolute;
  color: inherit;
  inline-size: 100%;
  inset: 0;
  outline: none;
  padding-block: 0;
  padding-inline: var(--v-field-padding-start);
}

$heading-color: rgba(
  var(--v-theme-on-background),
  var(--v-high-emphasis-opacity)
);
$body-color: rgba(var(--v-theme-on-background), var(--v-high-emphasis-opacity));

input[altinputclass='inlinePicker'] {
  display: none;
}

.flatpickr-time input.flatpickr-hour {
  font-weight: 400;
}

.flatpickr-calendar {
  @include mixins.elevation(6);

  background-color: rgb(var(--v-theme-surface));
  inline-size: 16.875rem;

  .flatpickr-day:focus {
    border-color: rgba(var(--v-border-color), var(--v-border-opacity));
    background: rgba(var(--v-border-color), var(--v-border-opacity));
  }

  .flatpickr-rContainer {
    .flatpickr-weekdays {
      block-size: 1.25rem;
      padding-inline: 0.5625rem;
    }

    .flatpickr-days {
      min-inline-size: 16.875rem;

      .dayContainer {
        justify-content: center !important;
        inline-size: 16.875rem;
        min-inline-size: 16.875rem;
        padding-block: 0.75rem 0.5rem;

        .flatpickr-day {
          block-size: 2.25rem;
          font-size: 0.9375rem;
          line-height: 2.25rem;
          margin-block-start: 0 !important;
          max-inline-size: 2.25rem;
        }
      }
    }
  }

  .flatpickr-day {
    color: $body-color;

    &.today {
      &:not(.selected) {
        border: none !important;
        background: rgba(var(--v-theme-primary), 0.24);
        color: rgb(var(--v-theme-primary));
      }

      &:hover {
        border: none !important;
        background: rgba(var(--v-theme-primary), 0.24);
        color: rgb(var(--v-theme-primary));
      }
    }

    &.selected,
    &.selected:hover {
      border-color: rgb(var(--v-theme-primary));
      background: rgb(var(--v-theme-primary));
      color: rgb(var(--v-theme-on-primary));

      @include templateMixins.custom-elevation(var(--v-theme-primary), 'sm');
    }

    &.inRange,
    &.inRange:hover {
      border: none;
      background: rgba(
        var(--v-theme-primary),
        var(--v-activated-opacity)
      ) !important;
      box-shadow: none !important;
      color: rgb(var(--v-theme-primary));
    }

    &.startRange {
      @include templateMixins.custom-elevation(var(--v-theme-primary), 'sm');
    }

    &.endRange {
      @include templateMixins.custom-elevation(var(--v-theme-primary), 'sm');
    }

    &.startRange,
    &.endRange,
    &.startRange:hover,
    &.endRange:hover {
      border-color: rgb(var(--v-theme-primary));
      background: rgb(var(--v-theme-primary));
      color: rgb(var(--v-theme-on-primary));
    }

    &.selected.startRange + .endRange:not(:nth-child(7n + 1)),
    &.startRange.startRange + .endRange:not(:nth-child(7n + 1)),
    &.endRange.startRange + .endRange:not(:nth-child(7n + 1)) {
      box-shadow: -10px 0 0 rgb(var(--v-theme-primary));
    }

    &.flatpickr-disabled,
    &.prevMonthDay:not(.startRange, .inRange),
    &.nextMonthDay:not(.endRange, .inRange) {
      opacity: var(--v-disabled-opacity);
    }

    &:hover {
      border-color: transparent;
      background: rgba(var(--v-theme-on-surface), 0.06);
    }
  }

  .flatpickr-weekday {
    color: $heading-color;
    font-size: 0.8125rem;
    font-weight: 400;
    inline-size: 2.25rem;
    line-height: 1.25rem;
  }

  .flatpickr-days {
    inline-size: 16.875rem;
  }

  &::after,
  &::before {
    display: none;
  }

  .flatpickr-months {
    .flatpickr-prev-month,
    .flatpickr-next-month {
      color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
      fill: $body-color;

      &:hover {
        color: rgba(var(--v-theme-on-surface), var(--v-high-emphasis-opacity));
      }

      &:hover i,
      &:hover svg {
        fill: $body-color;
      }
    }
  }

  .flatpickr-current-month span.cur-month {
    font-weight: 300;
  }

  &.open {
    z-index: 2401;
  }

  &.hasTime.open {
    .flatpickr-innerContainer + .flatpickr-time {
      block-size: auto;
      border-block-start: 1px solid
        rgba(var(--v-border-color), var(--v-border-opacity));
    }

    .flatpickr-time {
      border-block-start: none;
    }

    .flatpickr-hour,
    .flatpickr-minute,
    .flatpickr-am-pm {
      font-size: 0.9375rem;
    }
  }
}

.v-theme--dark .flatpickr-calendar {
  box-shadow: 0 3px 14px 0 rgb(15 20 34 / 38%);
}

.flatpickr-time input:hover,
.flatpickr-time .flatpickr-am-pm:hover,
.flatpickr-time input:focus,
.flatpickr-time .flatpickr-am-pm:focus {
  background: transparent;
}

.flatpickr-time {
  .flatpickr-am-pm,
  .flatpickr-time-separator,
  input {
    color: $body-color;
  }

  .numInputWrapper {
    span {
      &.arrowUp {
        &::after {
          border-block-end-color: rgb(var(--v-border-color));
        }
      }

      &.arrowDown {
        &::after {
          border-block-start-color: rgb(var(--v-border-color));
        }
      }
    }
  }
}

.flatpickr-input[readonly],
.flatpickr-input ~ .form-control[readonly],
.flatpickr-human-friendly[readonly] {
  background-color: inherit;
}

.flatpickr-input {
  display: none !important;
}

.flatpickr-weekdays {
  margin-block: 0.375rem;
}

.flatpickr-current-month {
  .flatpickr-monthDropdown-months {
    appearance: none;
  }

  .flatpickr-monthDropdown-months,
  .numInputWrapper {
    padding: 2px;
    border-radius: 4px;
    color: $heading-color;
    font-size: 0.9375rem;
    font-weight: 400;
    line-height: 1.375rem;
    transition: all 0.15s ease-out;

    span {
      display: none;
    }

    .flatpickr-monthDropdown-month {
      background-color: rgb(var(--v-theme-surface));
    }

    .numInput.cur-year {
      font-weight: 400;
    }
  }
}

.flatpickr-day.flatpickr-disabled,
.flatpickr-day.flatpickr-disabled:hover {
  color: $body-color;
}

.flatpickr-months {
  padding-block: 0.75rem;
  padding-inline: 1rem;

  .flatpickr-prev-month,
  .flatpickr-next-month {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 5rem;
    background: rgba(var(--v-theme-on-surface), var(--v-selected-opacity));
    block-size: 1.875rem;
    inline-size: 1.875rem;
    inset-block-start: 15px !important;

    &.flatpickr-disabled {
      display: inline;
      opacity: var(--v-disabled-opacity);
      pointer-events: none;
    }
  }

  .flatpickr-next-month {
    inset-inline-end: 1.05rem !important;
  }

  .flatpickr-prev-month {
    right: 3.65rem;
    left: unset !important;
  }

  .flatpickr-month {
    display: flex;
    align-items: center;
    block-size: 2.125rem;

    .flatpickr-current-month {
      display: flex;
      align-items: center;
      padding: 0;
      block-size: 1.75rem;
      inset-inline-start: 0;
      text-align: start;
    }
  }
}
</style>
