"use client";

import { createBrowserClient } from "@supabase/ssr";
import { create } from "zustand";
import type { Database } from "@/types/generated/database.types";

export const useSupabaseBrowserClient = create(() => ({
  client: createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ),
}));
