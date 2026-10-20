"use client";

import { useSearchParams } from "next/navigation";
import { HomeContent } from "./HomeContent";

export function HomeSearch() {
  const searchParams = useSearchParams();
  const queries = searchParams.getAll("q");
  const query = queries.length === 1 ? queries[0] : "";

  return <HomeContent query={query} />;
}
