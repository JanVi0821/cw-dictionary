import { getTranslations } from "next-intl/server";
import { navigationItems } from "@/consts/navigation-items";
import { Link } from "@/i18n/navigation";

export async function DesktopNavigation() {
  const t = await getTranslations("Navigation");

  return (
    <nav className="hidden shrink-0 lg:flex">
      <ul className="flex items-center gap-control-gap">
        {navigationItems.map(({ href, label, icon: Icon }) => (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              className="focus-ring flex min-h-touch shrink-0 items-center gap-control-gap whitespace-nowrap rounded-pill px-control-x text-label font-semibold text-on-primary-muted hover:text-brand-yellow"
            >
              <Icon className="size-nav-icon shrink-0" aria-hidden="true" />
              <span>{t(label)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
