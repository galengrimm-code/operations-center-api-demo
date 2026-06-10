// supabase/functions/john-deere-import/__tests__/import-applications.test.ts
// Run with: deno test --allow-net --allow-env --allow-read supabase/functions/john-deere-import/__tests__/import-applications.test.ts

import { assertEquals, assertExists } from "https://deno.land/std@0.215.0/assert/mod.ts";
import { importApplications } from "../actions/import-applications.ts";

const FIXTURE_DIR = new URL("../../../../__fixtures__/jd/", import.meta.url);

async function loadFixture(name: string): Promise<unknown> {
  const text = await Deno.readTextFile(new URL(name, FIXTURE_DIR));
  return JSON.parse(text);
}

function makeMockSupabase(state: {
  fields: Array<{ jd_field_id: string; name: string }>;
  fieldOpsByJdId: Map<string, { id: string; application_name_user_edited: boolean }>;
  productsByJdId: Map<
    string,
    { id: string; product_category: string | null; product_category_source: string | null }
  >;
  existingFop: Map<
    string,
    Array<{
      id: string;
      line_index: number;
      product_id: string;
      is_user_edited: boolean;
      deleted_at: string | null;
    }>
  >;
  seeds: Array<{ name_pattern: string; match_type: string; product_category: string }>;
  inserts: Record<string, unknown[]>;
  updates: Record<string, unknown[]>;
}) {
  function table(name: string) {
    return {
      select: (_cols: string) => ({
        eq: (col: string, val: unknown) => {
          if (name === "product_category_seeds") {
            return Promise.resolve({ data: state.seeds, error: null });
          }
          if (name === "fields") {
            return {
              eq: (_c2: string, _v2: unknown) =>
                Promise.resolve({ data: state.fields, error: null }),
            };
          }
          if (name === "field_operations") {
            return {
              eq: (_c2: string, _v2: unknown) => ({
                eq: (_c3: string, jdOpId: string) => ({
                  maybeSingle: () => {
                    const row = state.fieldOpsByJdId.get(jdOpId);
                    return Promise.resolve({ data: row ?? null, error: null });
                  },
                }),
              }),
            };
          }
          if (name === "field_operation_products") {
            return Promise.resolve({
              data: state.existingFop.get(val as string) ?? [],
              error: null,
            });
          }
          if (name === "products") {
            return {
              eq: (_c2: string, _v2: unknown) => ({
                eq: (_c3: string, jdPid: string) => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: state.productsByJdId.get(jdPid) ?? null, error: null }),
                }),
              }),
            };
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
      insert: (rows: unknown) => ({
        select: (_c: string) => ({
          single: () => {
            const id = crypto.randomUUID();
            (state.inserts[name] ??= []).push(rows);
            return Promise.resolve({ data: { id }, error: null });
          },
        }),
      }),
      update: (patch: unknown) => ({
        eq: (_c: string, _v: unknown) => {
          (state.updates[name] ??= []).push(patch);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
  }
  // deno-lint-ignore no-explicit-any
  return { from: table } as any;
}

Deno.test(
  "import-applications: happy path inserts products + lines from single-tankmix fixture",
  async () => {
    const single = await loadFixture("application-rate-result-single-tankmix.json");

    const origFetch = globalThis.fetch;
    globalThis.fetch = (url: string | URL | Request, _init?: RequestInit) => {
      const s = url.toString();
      if (s.includes("fieldOperations?fieldOperationType=APPLICATION")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              values: [
                {
                  id: "op-1",
                  fieldOperationType: "application",
                  cropSeason: "2025",
                  startDate: "2025-06-03T22:01:57.473Z",
                },
              ],
              links: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (s.includes("/measurementTypes/ApplicationRateResult")) {
        return Promise.resolve(
          new Response(JSON.stringify(single), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    };

    const supabase = makeMockSupabase({
      fields: [{ jd_field_id: "field-1", name: "Test Field" }],
      fieldOpsByJdId: new Map(),
      productsByJdId: new Map(),
      existingFop: new Map(),
      seeds: [],
      inserts: {},
      updates: {},
    });

    const url = new URL("https://example.com/?action=import-applications&seasons=2025,2026");
    const ctx = {
      supabase,
      accessToken: "test-token",
      user: { id: "00000000-0000-0000-0000-00000000U0U0" } as never,
      orgId: "600550",
      url,
    };

    const resp = await importApplications(ctx);
    assertEquals(resp.status, 200);
    const body = await resp.json();
    assertExists(body.operations_processed);
    assertEquals(body.operations_processed, 1);
    assertEquals(body.product_lines_written, 2);
    assertEquals(body.measurements_not_found, 0);

    globalThis.fetch = origFetch;
  },
);

Deno.test(
  "import-applications: 404 on measurement -> measurement_status='not_found', no product lines",
  async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes("fieldOperations?fieldOperationType=APPLICATION")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              values: [{ id: "op-404", fieldOperationType: "application", cropSeason: "2026" }],
              links: [],
            }),
            { status: 200 },
          ),
        );
      }
      if (s.includes("/measurementTypes/ApplicationRateResult")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(new Response("", { status: 200 }));
    };

    const supabase = makeMockSupabase({
      fields: [{ jd_field_id: "field-1", name: "Test Field" }],
      fieldOpsByJdId: new Map(),
      productsByJdId: new Map(),
      existingFop: new Map(),
      seeds: [],
      inserts: {},
      updates: {},
    });

    const url = new URL("https://example.com/?action=import-applications&seasons=2025,2026");
    const resp = await importApplications({
      supabase,
      accessToken: "t",
      user: { id: "u" } as never,
      orgId: "o",
      url,
    });
    const body = await resp.json();
    assertEquals(body.measurements_not_found, 1);
    assertEquals(body.product_lines_written, 0);

    globalThis.fetch = origFetch;
  },
);
