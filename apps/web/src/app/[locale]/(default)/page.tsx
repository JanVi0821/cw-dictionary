import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { HomeContent } from "./_components/HomeContent";
import { HomeSearch } from "./_components/HomeSearch";

export const revalidate = 60 * 60 * 24;
export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Home" });

  return {
    title: t("heading"),
    description: t("description"),
  };
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeContent />}>
      <HomeSearch />
    </Suspense>
  );
}
