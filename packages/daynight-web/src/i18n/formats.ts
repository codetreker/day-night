import type { Locale } from "./locale";

type DateValue = Date | string | number;

export type Formats = {
  readonly date: (value: DateValue) => string;
  readonly time: (value: DateValue) => string;
  readonly dateTime: (value: DateValue) => string;
  readonly number: (value: number | bigint) => string;
  readonly bytes: (value: number | bigint) => string;
  readonly plural: (value: number) => Intl.LDMLPluralRule;
};

const createFormats = (locale: Locale): Formats => {
  const date = new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric" });
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false });
  const dateTime = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const number = new Intl.NumberFormat(locale);
  const plural = new Intl.PluralRules(locale);
  return {
    date: (value) => date.format(new Date(value)),
    time: (value) => time.format(new Date(value)),
    dateTime: (value) => dateTime.format(new Date(value)),
    number: (value) => number.format(value),
    bytes: (value) => `${number.format(value)} B`,
    plural: (value) => plural.select(value),
  };
};

const formatsByLocale: Readonly<Record<Locale, Formats>> = {
  en: createFormats("en"),
  "zh-CN": createFormats("zh-CN"),
};

export const getFormats = (locale: Locale): Formats => formatsByLocale[locale];
