"use client";

import { Dropdown } from "@douyinfe/semi-ui-19";
import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

export function LanguageSelector() {
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

  const label = locale === "en" ? t("english") : t("simplifiedChinese");

  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      showTick
      menu={routing.locales.map((item) => ({
        node: "item" as const,
        name: item === "en" ? t("english") : t("simplifiedChinese"),
        active: item === locale,
        disabled: isPending,
        onClick: () => handleChange(item),
      }))}
    >
      <button
        type="button"
        className="focus-ring h-auto min-h-touch w-auto min-w-max rounded-control bg-surface px-2 text-xs font-medium text-foreground shadow-control sm:px-3 sm:text-label"
        aria-label={t("label")}
        disabled={isPending}
      >
        {label}
      </button>
    </Dropdown>
  );
}
