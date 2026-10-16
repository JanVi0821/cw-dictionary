"use client";

import { IconChevronRight } from "@douyinfe/semi-icons";
import { ImagePreview as SemiImagePreview } from "@douyinfe/semi-ui-19";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "cn";

export function ImagePreview({
  images,
  alt,
  className,
  detailsHref,
  thumbnails = false,
}: {
  images: string[];
  alt: string;
  className?: string;
  detailsHref?: string;
  thumbnails?: boolean;
}) {
  const t = useTranslations("ImagePreview");
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const imageKey = images.join("\n");
  const current = images.length === 0 ? 0 : Math.min(index, images.length - 1);
  const src = images[current];
  const showThumbs = thumbnails && images.length > 1;

  useEffect(() => {
    setIndex(0);
    setVisible(false);
  }, [imageKey]);

  if (!src) return null;

  return (
    <div className={showThumbs ? "flex w-full flex-col gap-2" : "contents"}>
      <button
        type="button"
        className={cn(
          "focus-ring block w-full cursor-zoom-in overflow-hidden",
          className,
        )}
        onClick={() => setVisible(true)}
      >
        <img src={src} alt={alt} className="size-full object-contain" />
      </button>
      <SemiImagePreview
        // @ts-expect-error
        className="hidden"
        src={images}
        visible={visible}
        currentIndex={current}
        onVisibleChange={setVisible}
        onChange={setIndex}
        renderPreviewMenu={(props) => {
          const { menuItems } = props as typeof props & {
            menuItems?: ReactNode;
          };
          return (
            <div
              className={cn(
                "semi-image-preview-footer semi-image-preview-footer-content",
                "[&_.semi-icon-large]:!hidden",
              )}
            >
              {menuItems}
              {detailsHref ? (
                <Link
                  href={detailsHref}
                  className={cn(
                    "focus-ring flex w-fit shrink-0 items-center gap-1 whitespace-nowrap",
                    "min-h-touch rounded-control",
                    "text-label font-semibold !text-white shadow-lg",
                  )}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {t("details")}
                  <IconChevronRight />
                </Link>
              ) : null}
            </div>
          );
        }}
      />
      {showThumbs ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, imageIndex) => (
            <li key={`${image}-${imageIndex}`}>
              <button
                type="button"
                aria-current={imageIndex === current ? "true" : undefined}
                className={cn(
                  "focus-ring size-20 overflow-hidden rounded-control border bg-surface p-1",
                  imageIndex === current
                    ? "border-brand-blue"
                    : "border-separator",
                )}
                onClick={() => setIndex(imageIndex)}
              >
                <img src={image} alt="" className="size-full object-contain" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
