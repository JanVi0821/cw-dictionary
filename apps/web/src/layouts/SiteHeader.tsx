import { BrandLink } from "./BrandLink";
import { DesktopNavigation } from "./DesktopNavigation";
import { LanguageSelector } from "./LanguageSelector";

export async function SiteHeader() {
  return (
    <header className="border-b-4 border-brand-yellow bg-brand-blue text-on-canvas">
      <div className="mx-auto flex h-header w-full max-w-content items-center gap-2 px-page-x sm:gap-page-x">
        <div className="flex min-w-0 flex-1 items-center">
          <BrandLink />
        </div>
        <DesktopNavigation />
        <div className="flex flex-none items-center justify-end gap-1 sm:flex-1 sm:gap-control-gap">
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
}
