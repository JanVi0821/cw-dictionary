"use client";

import { Pagination } from "@douyinfe/semi-ui-19";
import { useRouter } from "@/i18n/navigation";
import { COLLECTION_PAGE_SIZE } from "@/lib/products";

export function CollectionPagination({
  collectionId,
  page,
  total,
}: {
  collectionId: string;
  page: number;
  total: number;
}) {
  const router = useRouter();

  return (
    <Pagination
      className="w-full justify-center !pt-section"
      total={total}
      pageSize={COLLECTION_PAGE_SIZE}
      currentPage={page}
      hideOnSinglePage
      onPageChange={(next) => {
        router.push(next <= 1 ? `/explore/${collectionId}` : `/explore/${collectionId}?page=${next}`);
      }}
    />
  );
}
