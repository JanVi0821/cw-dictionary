import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function BrandLink() {
  const t = await getTranslations("Brand");

  return (
    <Link
      href="/"
      className="focus-ring flex min-h-touch min-w-0 items-center gap-2 rounded-control"
    >
      <img
        src="/favicon.png"
        alt=""
        className="size-logo-mobile rounded-control sm:size-logo"
      />
      <span className="truncate text-label font-semibold text-on-canvas">{t("name")}</span>
    </Link>
  );
}
