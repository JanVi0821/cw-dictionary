import { Compass, Search, Settings } from "lucide-react";

export const navigationItems = [
  { href: "/", label: "search", icon: Search },
  { href: "/explore", label: "explore", icon: Compass },
  { href: "/settings", label: "settings", icon: Settings },
] as const;
