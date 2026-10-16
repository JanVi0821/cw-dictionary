"use client";

import { Tag } from "@douyinfe/semi-ui-19";

const TAG_COLORS = [
  "amber",
  "blue",
  "cyan",
  "green",
  "grey",
  "indigo",
  "light-blue",
  "light-green",
  "lime",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "violet",
  "yellow",
] as const;

export function tagColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++)
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

export function StringTags({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-copy-gap flex flex-col gap-2 font-bold overflow-hidden">
      {items.map((item) => (
        <li key={item}>
          <Tag
            color={tagColor(item)}
            className=" whitespace-pre word-break-all"
          >
            {item}
          </Tag>
        </li>
      ))}
    </ul>
  );
}
