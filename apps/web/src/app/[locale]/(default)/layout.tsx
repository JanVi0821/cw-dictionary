import type { ReactNode } from "react";
import { MobileNavigation } from "@/layouts/MobileNavigation";
import { SiteHeader } from "@/layouts/SiteHeader";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main>{children}</main>
      <MobileNavigation />
    </div>
  );
}
