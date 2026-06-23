import { supabase } from "./supabase";

// PostgREST encodes `.in(col, ids)` as `col=in.(id1,id2,...)` in the URL. With a
// full dataset (hundreds–thousands of ids) that single request line exceeds the
// server's length limit and returns 400 (Bad Request). Any client-side join that
// filters by a large, data-sized id list must batch it into chunks small enough to
// keep each URL well under the limit (and each chunk's row count modest).
//
// Chunks run in parallel and results concatenate in chunk order, so an ordered
// query stays ordered within any single id's rows (a given id lands in exactly one
// chunk). 100 ids per chunk keeps the `in.(...)` segment well under ~4KB.
const IN_CHUNK_SIZE = 100;

export async function selectInChunks(
  table: string,
  column: string,
  ids: string[],
  applyQuery: (q: any) => any,
): Promise<any[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + IN_CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map(async (slice) => {
      const { data, error } = await applyQuery(supabase.from(table) as any).in(column, slice);
      if (error) throw error;
      return (data ?? []) as any[];
    }),
  );
  return results.flat();
}
