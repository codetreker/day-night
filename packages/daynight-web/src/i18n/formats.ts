import type { Locale } from "./locale";

type DateValue = Date | string | number;

export type Formats = {
  readonly date: (value: DateValue) => string;
  readonly time: (value: DateValue) => string;
  readonly dateTime: (value: DateValue) => string;
  readonly number: (value: number | bigint) => string;
  readonly bytes: (value: number | bigint) => string;
  readonly plural: (value: number) => Intl.LDMLPluralRule;
  readonly duration: (milliseconds: number) => string;
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
    duration: (milliseconds) => {
      if (milliseconds < 60_000) return locale === "en" ? "< 1 min" : "不足 1 分钟";
      const minutes = Math.floor(milliseconds / 60_000);
      const parts = [Math.floor(minutes / 1440), Math.floor(minutes % 1440 / 60), minutes % 60];
      const units = locale === "en" ? ["d", "h", "min"] : [" 天", " 小时", " 分钟"];
      return parts.flatMap((value, index) => value === 0 ? [] : [`${number.format(value)}${units[index]}`]).join(" ");
    },
  };
};

const formatsByLocale: Readonly<Record<Locale, Formats>> = {
  en: createFormats("en"),
  "zh-CN": createFormats("zh-CN"),
};

export const getFormats = (locale: Locale): Formats => formatsByLocale[locale];
