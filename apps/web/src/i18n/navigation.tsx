import { createNavigation } from "next-intl/navigation";
import type { ComponentProps } from "react";
import { routing } from "./routing";

const {
  Link: IntlLink,
  redirect,
  usePathname,
  useRouter,
} = createNavigation(routing);

function Link({ prefetch = false, ...props }: ComponentProps<typeof IntlLink>) {
  return <IntlLink prefetch={prefetch} {...props} />;
}

export { Link, redirect, usePathname, useRouter };
