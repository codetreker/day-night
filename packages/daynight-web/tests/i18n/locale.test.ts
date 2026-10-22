import { describe, expect, it, vi } from "vitest";
import { LOCALE_STORAGE_KEY, parseLocale, resolveBrowserLocale, resolveInitialLocale } from "../../src/i18n/locale";
import type { BrowserLanguages, LocaleStorage } from "../../src/i18n/locale";

describe("language resolution", () => {
  it.each<[BrowserLanguages, string]>([
    [{ languages: ["en-US"], language: "zh-CN" }, "en"],
    [{ languages: ["zh-CN"], language: "en" }, "zh-CN"],
    [{ languages: ["zh-TW"], language: "en" }, "zh-CN"],
    [{ languages: ["zh-Hant-HK"], language: "en" }, "zh-CN"],
    [{ languages: ["fr-FR", "zh-CN", "en"], language: "en" }, "zh-CN"],
    [{ languages: ["en", "zh-CN"], language: "zh-CN" }, "en"],
    [{ languages: ["fr-FR", "de"], language: "zh-CN" }, "en"],
    [{ languages: ["ZH-hant", "EN-us"], language: "en" }, "zh-CN"],
    [{ language: "zh-TW" }, "zh-CN"],
    [{ languages: [], language: "en-GB" }, "en"],
    [{ languages: [], language: "zh" }, "zh-CN"],
    [{ language: "fr" }, "en"],
  ])("resolves ordered browser preferences %j to %s", (browser, expected) => {
    expect(resolveBrowserLocale(browser)).toBe(expected);
  });

  it.each(["en", "zh-CN"])("reads raw explicit %s ahead of browser detection without writing", (saved) => {
    const storage: LocaleStorage = { getItem: vi.fn().mockReturnValue(saved), setItem: vi.fn() };
    expect(resolveInitialLocale({ getStorage: () => storage, languages: [saved === "en" ? "zh" : "en"], language: "fr" }))
      .toEqual({ locale: saved, issue: null });
    expect(storage.getItem).toHaveBeenCalledExactlyOnceWith(LOCALE_STORAGE_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("uses the browser environment by default and leaves automatic detection unpersisted", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr", "zh-TW"]);
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(resolveInitialLocale()).toEqual({ locale: "zh-CN", issue: null });
    expect(write).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it.each(["access", "read"])("retains the original %s failure and still resolves browser language", (failure) => {
    const cause = new Error("storage unavailable");
    const storage: LocaleStorage = { getItem: () => { throw cause; }, setItem: vi.fn() };
    const getStorage = () => { if (failure === "access") throw cause; return storage; };
    const initial = resolveInitialLocale({ getStorage, language: "zh-TW" });
    expect(initial).toEqual({ locale: "zh-CN", issue: { kind: "read", cause } });
    expect(initial.issue?.cause).toBe(cause);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each(["", "EN", '"en"', "zh", "fr", "{\"locale\":\"en\"}"])("surfaces invalid saved value %j without silently rewriting it", (saved) => {
    const storage: LocaleStorage = { getItem: () => saved, setItem: vi.fn() };
    const initial = resolveInitialLocale({ getStorage: () => storage, language: "zh-CN" });
    expect(initial.locale).toBe("zh-CN");
    expect(initial.issue?.kind).toBe("invalid");
    expect(initial.issue?.cause).toBeInstanceOf(Error);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("rejects unsupported values at the selector boundary", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("zh-CN")).toBe("zh-CN");
    expect(() => parseLocale("fr")).toThrow("Invalid saved language preference.");
  });
});
