import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function BrandLink() {
  const t = await getTranslations("Brand");

  return (
    <Link
      href="/"
      className="focus-ring flex min-h-touch min-w-0 items-center gap-2 rounded-control"
    >
      <span
        className="grid size-logo-mobile place-items-center rounded-control bg-primary text-label font-bold text-primary-foreground sm:size-logo"
        aria-hidden="true"
      >
        C
      </span>
      <span className="truncate text-label font-semibold">{t("name")}</span>
    </Link>
  );
}
