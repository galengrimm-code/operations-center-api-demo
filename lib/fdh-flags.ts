// Track 2 (fdh migration) — browser read flag.
// When on, browser reads point at the operations_center.fdh_* reverse views
// (fdh core + farm_overlay) instead of the legacy tables. The views are
// parity-proven byte-exact and expose the LEGACY id, so writes-by-id still
// round-trip (the write-sync triggers propagate them back into fdh).
//
// Resolution order: localStorage override (for in-app A/B testing without a
// rebuild) -> NEXT_PUBLIC_FDH_READ_OPS build-time env -> off.
// Toggle live in the browser console: localStorage.setItem('fdh_read_ops','true')
export function fdhReadOps(): boolean {
  if (typeof window !== "undefined") {
    try {
      const ls = window.localStorage?.getItem("fdh_read_ops");
      if (ls === "true") return true;
      if (ls === "false") return false;
    } catch {
      /* localStorage unavailable (SSR/private mode) — fall through to env */
    }
  }
  return process.env.NEXT_PUBLIC_FDH_READ_OPS === "true";
}

/** Legacy table -> fdh reverse view name, chosen by the flag. */
export function opsTable(legacy: string): string {
  if (!fdhReadOps()) return legacy;
  const map: Record<string, string> = {
    fields: "fdh_fields",
    field_operations: "fdh_field_operations",
    field_operation_products: "fdh_field_operation_products",
    products: "fdh_products",
    product_prices: "fdh_product_prices",
  };
  return map[legacy] ?? legacy;
}
