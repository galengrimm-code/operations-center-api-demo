// supabase/functions/john-deere-import/shared/validation.ts
// Zod schemas for query params and request bodies — validated before use.

import { z } from "npm:zod@3.22.4";

export const ImportApplicationsQuery = z.object({
  action: z.literal("import-applications"),
  fieldId: z.string().uuid().optional(),
  seasons: z
    .string()
    .regex(/^\d{4}(,\d{4})*$/, "comma-separated 4-digit years")
    .default("2024,2025,2026"),
});

export type ImportApplicationsQueryT = z.infer<typeof ImportApplicationsQuery>;

export function parseSeasons(input: string): string[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}
