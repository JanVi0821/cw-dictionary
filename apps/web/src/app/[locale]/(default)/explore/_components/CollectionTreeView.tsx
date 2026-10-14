"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CollectionListItem } from "@/lib/collections";
import { cn } from "@/lib/utils";

type TreeCopy = {
  expand: string;
  loadFailed: string;
  loading: string;
};

function CollectionNode({
  copy,
  depth,
  locale,
  node,
}: {
  copy: TreeCopy;
  depth: number;
  locale: string;
  node: CollectionListItem;
}) {
  const [open, setOpen] = useState(false);
  const children = useQuery({
    queryKey: ["collections", locale, node.collectionId],
    enabled: open,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const response = await fetch(
        `/api/collections?locale=${encodeURIComponent(locale)}&parent=${node.collectionId}`,
      );
      if (!response.ok) throw new Error("Couldn't load collections");
      return response.json() as Promise<CollectionListItem[]>;
    },
  });

  const nameLink = (
    <Link
      href={`/explore/${node.collectionId}`}
      className={cn(
        "focus-ring flex min-h-touch min-w-0 flex-1 items-center font-semibold text-foreground",
        depth > 0 && "text-label font-medium",
      )}
    >
      <span className="truncate">{node.name}</span>
    </Link>
  );

  if (!node.hasChildren) {
    return (
      <li
        className={cn("border-t border-border", depth === 0 && "first:border-t-0")}
      >
        <div
          className="flex items-center pr-control-x hover:bg-surface-muted"
          style={{
            paddingInlineStart: `calc(var(--spacing-control-x) * ${depth} + var(--spacing-touch))`,
          }}
        >
          {nameLink}
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn("border-t border-border", depth === 0 && "first:border-t-0")}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="flex items-center pr-control-x hover:bg-surface-muted"
          style={{
            paddingInlineStart: `calc(var(--spacing-control-x) * ${depth})`,
          }}
        >
          <CollapsibleTrigger
            aria-label={copy.expand}
            className="group focus-ring grid size-touch shrink-0 place-items-center text-foreground-muted hover:text-foreground"
          >
            <ChevronRight
              className="size-nav-icon transition-transform duration-150 ease-out group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          {nameLink}
        </div>
        <CollapsibleContent>
          {children.isError ? (
            <p className="px-control-x py-2 text-label text-danger">{copy.loadFailed}</p>
          ) : children.data ? (
            <CollectionNodes
              copy={copy}
              depth={depth + 1}
              locale={locale}
              nodes={children.data}
            />
          ) : (
            <p className="px-control-x py-2 text-label text-foreground-muted">
              {copy.loading}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function CollectionNodes({
  copy,
  depth,
  locale,
  nodes,
}: {
  copy: TreeCopy;
  depth: number;
  locale: string;
  nodes: CollectionListItem[];
}) {
  return (
    <ul>
      {nodes.map((node) => (
        <CollectionNode
          key={node.collectionId}
          copy={copy}
          depth={depth}
          locale={locale}
          node={node}
        />
      ))}
    </ul>
  );
}

export function CollectionTreeView({
  copy,
  locale,
  nodes,
}: {
  copy: TreeCopy;
  locale: string;
  nodes: CollectionListItem[];
}) {
  return (
    <div className="mt-control-gap overflow-hidden rounded-control border border-border bg-surface">
      <CollectionNodes copy={copy} depth={0} locale={locale} nodes={nodes} />
    </div>
  );
}
