import { render } from "@testing-library/react";
import type { RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { LocaleProvider } from "../../src/i18n/LocaleProvider";
import type { InitialLocale, Locale, LocaleStorage } from "../../src/i18n/locale";

type LocaleRenderOptions = Omit<RenderOptions, "wrapper"> & {
  readonly locale: Locale;
  readonly issue?: InitialLocale["issue"];
  readonly getStorage?: () => LocaleStorage;
};

export const renderWithLocale = (ui: ReactElement, { locale, issue = null, getStorage, ...options }: LocaleRenderOptions) => {
  const wrapper = ({ children }: { children: ReactNode }) => <LocaleProvider initial={{ locale, issue }}
    {...(getStorage === undefined ? {} : { getStorage })}>{children}</LocaleProvider>;
  return render(ui, { ...options, wrapper });
};
