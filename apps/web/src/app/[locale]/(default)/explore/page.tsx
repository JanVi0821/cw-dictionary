import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CollectionTreeView } from "./_components/CollectionTreeView";
import { listCollectionChildren } from "@/lib/collections";
import { supabase } from "@/lib/supabase/server";

export const revalidate = 60 * 60 * 24;
export async function generateMetadata({
  params,
}: PageProps<"/[locale]/explore">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Explore" });

  return {
    title: t("title"),
  };
}

export default async function ExplorePage() {
  const t = await getTranslations("Explore");
  const locale = await getLocale();
  let nodes;
  let failed = false;

  try {
    nodes = await listCollectionChildren(supabase, null, locale);
  } catch {
    failed = true;
  }

  return (
    <section className="min-h-home bg-background pb-bottom-nav lg:pb-section">
      <div className="mx-auto w-full max-w-content px-page-x py-section">
        <h1 className="text-heading font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        {failed ? (
          <p
            className="mt-copy-gap rounded-control bg-danger-background px-3 py-2 text-body text-danger-foreground"
            role="alert"
          >
            {t("loadFailed")}
          </p>
        ) : nodes && nodes.length === 0 ? (
          <p className="mt-copy-gap text-body text-foreground-muted">
            {t("empty")}
          </p>
        ) : nodes ? (
          <CollectionTreeView
            copy={{
              expand: t("expand"),
              loadFailed: t("loadFailed"),
              loading: t("loading"),
            }}
            locale={locale}
            nodes={nodes}
          />
        ) : null}
      </div>
    </section>
  );
}
