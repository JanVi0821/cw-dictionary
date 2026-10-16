"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

export function LanguageSelector({
  variant = "header",
}: {
  variant?: "header" | "settings";
}) {
  const t = useTranslations("Language");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(nextLocale: string) {
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale as AppLocale });
    });
  }

  const selectorId =
    variant === "settings" ? "settings-language-selector" : "language-selector";
  const isSettings = variant === "settings";

  return (
    <div className={isSettings ? "w-full sm:w-56" : "shrink-0"}>
      <label className="sr-only" htmlFor={selectorId}>
        {t("label")}
      </label>
      <Select value={locale} onValueChange={handleChange} disabled={isPending}>
        <SelectTrigger
          id={selectorId}
          aria-labelledby={isSettings ? "settings-language-title" : undefined}
          className={
            isSettings
              ? "focus-ring min-h-12 w-full bg-surface px-3 text-body font-medium text-foreground shadow-control"
              : "focus-ring h-auto min-h-touch w-auto min-w-max bg-surface px-2 text-xs font-medium text-foreground shadow-control sm:px-3 sm:text-label"
          }
          aria-busy={isPending}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {routing.locales.map((item) => (
            <SelectItem key={item} value={item} className="min-h-touch">
              {item === "en" ? t("english") : t("simplifiedChinese")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
