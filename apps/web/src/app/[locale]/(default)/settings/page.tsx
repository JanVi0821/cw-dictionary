import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Languages } from "lucide-react";
import { LanguageSelector } from "@/layouts/LanguageSelector";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/settings">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Settings" });

  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

export default async function SettingsPage() {
  const t = await getTranslations("Settings");

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto flex w-full max-w-content flex-col gap-section px-page-x py-section">
        <h1 className="text-heading font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <div className="flex flex-col gap-control-gap rounded-page border border-border bg-surface p-4 shadow-control sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-control-gap">
            <span className="grid size-12 shrink-0 place-items-center rounded-control bg-surface-muted text-foreground">
              <Languages className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p
                id="settings-language-title"
                className="text-body font-semibold text-foreground"
              >
                {t("languageTitle")}
              </p>
              <p className="mt-1 text-label text-foreground-muted">
                {t("languageDescription")}
              </p>
            </div>
          </div>
          <LanguageSelector variant="settings" />
        </div>
        <p className="text-body text-foreground-muted">{t("placeholder")}</p>
      </div>
    </section>
  );
}
