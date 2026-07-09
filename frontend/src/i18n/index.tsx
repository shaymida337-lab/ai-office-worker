"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, getToken } from "@/lib/api";
import en from "./en.json";
import he from "./he.json";

type AppLanguage = "he" | "en";
type AppDirection = "rtl" | "ltr";
type TranslationTree = Record<string, unknown>;

type I18nContextValue = {
  language: AppLanguage;
  dir: AppDirection;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const dictionaries: Record<AppLanguage, TranslationTree> = { he, en };
const I18nContext = createContext<I18nContextValue>({
  language: "he",
  dir: "rtl",
  setLanguage: () => undefined,
  t: (key) => key,
});

function getNestedValue(obj: TranslationTree, key: string): string | null {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : null;
}

function formatTemplate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey) => {
    const key = String(rawKey).trim();
    return key in vars ? String(vars[key]) : "";
  });
}

function directionFor(language: AppLanguage): AppDirection {
  return language === "he" ? "rtl" : "ltr";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>("he");

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let mounted = true;
    void apiFetch<{ language?: string; locale?: string }>("/api/organization/settings")
      .then((settings) => {
        const candidate = (settings.language ?? settings.locale ?? "he").toLowerCase();
        const next = candidate === "en" ? "en" : "he";
        if (mounted) setLanguage(next);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const dir = directionFor(language);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = dictionaries[language];
    return {
      language,
      dir,
      setLanguage,
      t: (key, vars) => formatTemplate(getNestedValue(dictionary, key) ?? key, vars),
    };
  }, [language, dir]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
