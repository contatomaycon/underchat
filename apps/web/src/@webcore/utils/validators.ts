import { isEmpty, isEmptyArray, isNullOrUndefined } from './helpers';

export const requiredValidator = (value: unknown, message: string) => {
  if (isNullOrUndefined(value) || isEmptyArray(value) || value === false)
    return message;

  return !!String(value).trim().length || message;
};

export const emailValidator = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  const re = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

  if (Array.isArray(value))
    return value.every((val) => re.test(String(val))) || message;

  return re.test(String(value)) || message;
};

export const passwordValidator = (password: string, message: string) => {
  const regExp = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,}$/;

  const validPassword = regExp.test(password);

  return validPassword || message;
};

export const confirmedValidator = (
  value: string,
  target: string,
  message: string
) => value === target || message;

export const betweenValidator = (
  value: unknown,
  min: number,
  max: number,
  message: string
) => {
  const valueAsNumber = Number(value);

  return (
    (Number(min) <= valueAsNumber && Number(max) >= valueAsNumber) || message
  );
};

export const integerValidator = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  if (Array.isArray(value))
    return value.every((val) => /^-?\d+$/.test(String(val))) || message;

  return /^-?\d+$/.test(String(value)) || message;
};

export const regexValidator = (
  value: unknown,
  regex: RegExp | string,
  message: string
): string | boolean => {
  if (isEmpty(value)) return true;

  let regeX = regex;
  if (typeof regeX === 'string') regeX = new RegExp(regeX);

  if (Array.isArray(value))
    return value.every((val) => regexValidator(val, regeX, message));

  return regeX.test(String(value)) || message;
};

export const alphaValidator = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  return /^[A-Z]*$/i.test(String(value)) || message;
};

export const urlValidator = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  const re = /^(https?:\/\/)?[^\s/$.?#].[^\s]*$/i;

  return re.test(String(value)) || message;
};

export const lengthValidator = (
  value: unknown,
  length: number,
  message: string
) => {
  if (isEmpty(value)) return true;

  return String(value).length === length || message;
};

export const alphaDashValidator = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  const valueAsString = String(value);

  return /^[\w-]*$/.test(valueAsString) || message;
};

export const isValidIP = (value: unknown, message: string) => {
  if (isEmpty(value)) return true;

  const ip = String(value);

  const ipv4Regex =
    /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

  return ipv4Regex.test(ip) || message;
};
