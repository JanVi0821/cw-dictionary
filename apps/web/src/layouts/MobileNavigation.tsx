import { getTranslations } from "next-intl/server";
import { navigationItems } from "@/consts/navigation-items";
import { Link } from "@/i18n/navigation";

export async function MobileNavigation() {
  const t = await getTranslations("Navigation");

  return (
    <nav className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface lg:hidden">
      <ul className="mx-auto grid w-full max-w-content grid-cols-3 px-page-x pt-bottom-nav-y">
        {navigationItems.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="focus-ring flex min-h-touch flex-col items-center justify-center gap-bottom-nav-gap rounded-control text-bottom-nav font-semibold text-foreground-muted hover:text-foreground"
            >
              <Icon className="size-bottom-nav-icon" aria-hidden="true" />
              <span>{t(label)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
