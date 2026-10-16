import { ImagePreview } from "@/components/ImagePreview";
import { Link } from "@/i18n/navigation";

export type ProductCardItem = {
  id: string;
  name: string;
  originalName: string | null;
  images: string[];
  href: string;
};

export function ProductCardGrid({
  emptyLabel,
  imageAlt,
  items,
}: {
  emptyLabel: string;
  imageAlt: (name: string) => string;
  items: ProductCardItem[];
}) {
  return (
    <ul className="mt-copy-gap grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.id} className="flex h-full flex-col overflow-hidden rounded-control border border-border bg-surface hover:bg-surface-muted">
          {item.images.length > 0 ? (
            <ImagePreview images={item.images} alt={imageAlt(item.name)} detailsHref={item.href} className="aspect-square p-2" />
          ) : (
            <div className="grid aspect-square place-items-center p-2">
              <span className="px-3 text-center text-label font-semibold text-foreground-muted">
                {emptyLabel}
              </span>
            </div>
          )}
          <Link href={item.href} className="focus-ring flex flex-1 flex-col gap-1 p-3">
            <p className="text-label font-semibold text-foreground underline">
              {item.name}
            </p>
            {item.originalName ? (
              <p className="text-sm text-foreground-muted">
                {item.originalName}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
