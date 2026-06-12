"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mountain, Lock, Pencil, MousePointer2, Trash2, LockOpen } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useFields } from "@/hooks/use-fields";
import {
  deleteTerrace,
  fetchTerraces,
  insertTerrace,
  lockField,
  nextTerraceNo,
  setTerraceStatus,
  updateTerraceGeom,
} from "@/lib/terraces-client";
import type { Terrace, TerraceKind } from "@/types/terrace";
import { TerracesMap, terraceColor } from "./terraces-map";

/** Set each crest's channel_coverage = paired channel length / crest length. */
function withCoverage(terraces: Terrace[]): Terrace[] {
  const byNo = new Map<number, Terrace[]>();
  for (const t of terraces) {
    const arr = byNo.get(t.terrace_no) || [];
    arr.push(t);
    byNo.set(t.terrace_no, arr);
  }
  return terraces.map((t) => {
    if (t.kind !== "crest") return t;
    const group = byNo.get(t.terrace_no) || [];
    const chLen = group
      .filter((g) => g.kind === "channel")
      .reduce((s, g) => s + (g.length_ft ?? 0), 0);
    const coverage = t.length_ft ? chLen / t.length_ft : 0;
    return { ...t, channel_coverage: coverage };
  });
}

export function TerracesView() {
  const { johnDeereConnection } = useAuth();
  const orgId = johnDeereConnection?.selected_org_id;
  const { fields: farmFields, loading: fieldsLoading } = useFields();

  const fields = useMemo(
    () => farmFields.filter((f) => f.boundary_geojson).sort((a, b) => a.name.localeCompare(b.name)),
    [farmFields],
  );
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const selectedField = fields.find((f) => f.jd_field_id === selectedFieldId) || null;

  const [terraces, setTerraces] = useState<Terrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"select" | "draw">("select");
  const [drawKind, setDrawKind] = useState<TerraceKind>("crest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // Guards against a slow fetch for a previous field overwriting the current.
  const loadSeq = useRef(0);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  // Clear the field selection if the farm filter hides it.
  useEffect(() => {
    if (selectedFieldId && !fields.some((f) => f.jd_field_id === selectedFieldId)) {
      setSelectedFieldId("");
    }
  }, [fields, selectedFieldId]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!orgId || !selectedFieldId) {
      setTerraces([]);
      setReloadKey((k) => k + 1);
      return;
    }
    setLoading(true);
    try {
      const rows = await fetchTerraces(orgId, selectedFieldId);
      if (seq !== loadSeq.current) return; // a newer load superseded this one
      setTerraces(withCoverage(rows));
      setReloadKey((k) => k + 1); // tell the map to repopulate Draw
    } catch (e) {
      if (seq === loadSeq.current)
        setStatus(e instanceof Error ? e.message : "Failed to load terraces");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [orgId, selectedFieldId]);

  useEffect(() => {
    setMode("select");
    setSelectedId(null);
    load();
  }, [load]);

  // load() bumps reloadKey itself, so reload is just a re-fetch.
  const reload = () => {
    load();
  };

  const handleGeomUpdate = async (id: string, geom: GeoJSON.LineString) => {
    // Persist + patch local state without a reload (don't interrupt editing).
    try {
      await updateTerraceGeom(id, geom);
      setTerraces((prev) =>
        withCoverage(prev.map((t) => (t.id === id ? { ...t, geom, source: "edited" } : t))),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save edit");
    }
  };

  const handleCreate = async (geom: GeoJSON.LineString) => {
    if (!orgId || !selectedFieldId) return;
    // A crest starts a new terrace. A channel joins the selected terrace (so
    // it pairs with that crest); with nothing selected it starts its own.
    let terraceNo = nextTerraceNo(terraces);
    if (drawKind === "channel" && selectedIdRef.current) {
      const sel = terraces.find((t) => t.id === selectedIdRef.current);
      if (sel) terraceNo = sel.terrace_no;
    }
    try {
      await insertTerrace({ orgId, jdFieldId: selectedFieldId, terraceNo, kind: drawKind, geom });
      setMode("select");
      reload();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to add line");
    }
  };

  const handleLockGroup = async (terraceNo: number) => {
    const group = terraces.filter((t) => t.terrace_no === terraceNo && t.status === "draft");
    await Promise.all(group.map((t) => setTerraceStatus(t.id, "locked")));
    reload();
  };

  const handleUnlockGroup = async (terraceNo: number) => {
    const group = terraces.filter((t) => t.terrace_no === terraceNo && t.status === "locked");
    await Promise.all(group.map((t) => setTerraceStatus(t.id, "draft")));
    reload();
  };

  const handleDelete = async (id: string) => {
    await deleteTerrace(id);
    setSelectedId(null);
    reload();
  };

  const handleLockField = async () => {
    if (!orgId || !selectedFieldId) return;
    const n = await lockField(orgId, selectedFieldId);
    setStatus(`Locked ${n} line${n === 1 ? "" : "s"}.`);
    reload();
  };

  // Roster grouped by terrace_no
  const groups = useMemo(() => {
    const byNo = new Map<number, Terrace[]>();
    for (const t of terraces) {
      const arr = byNo.get(t.terrace_no) || [];
      arr.push(t);
      byNo.set(t.terrace_no, arr);
    }
    return Array.from(byNo.entries())
      .map(([no, lines]) => {
        const crest = lines.find((l) => l.kind === "crest");
        const channels = lines.filter((l) => l.kind === "channel");
        const locked = lines.every((l) => l.status === "locked");
        const anyLocked = lines.some((l) => l.status === "locked");
        return { no, lines, crest, channels, locked, anyLocked };
      })
      .sort((a, b) => a.no - b.no);
  }, [terraces]);

  const draftCount = terraces.filter((t) => t.status === "draft").length;
  const lockedCount = terraces.filter((t) => t.status === "locked").length;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Mountain className="h-7 w-7 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Terraces</h1>
          <p className="text-sm text-slate-500">
            Review detected terrace lines, correct them, and lock them in
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[240px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">Field</label>
          {fieldsLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading fields...
            </div>
          ) : (
            <select
              value={selectedFieldId}
              onChange={(e) => setSelectedFieldId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">Choose a field...</option>
              {fields.map((f) => (
                <option key={f.jd_field_id} value={f.jd_field_id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {selectedFieldId && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                setMode("select");
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === "select" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              <MousePointer2 className="h-4 w-4" /> Select / edit
            </button>
            <button
              onClick={() => {
                setDrawKind("crest");
                setMode("draw");
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === "draw" && drawKind === "crest" ? "border-yellow-500 bg-yellow-50 text-yellow-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              <Pencil className="h-4 w-4" /> Draw crest
            </button>
            <button
              onClick={() => {
                setDrawKind("channel");
                setMode("draw");
              }}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${mode === "draw" && drawKind === "channel" ? "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-700" : "border-slate-300 text-slate-600 hover:bg-slate-50"}`}
            >
              <Pencil className="h-4 w-4" /> Draw channel
            </button>
          </div>
        )}

        {selectedFieldId && terraces.length > 0 && (
          <button
            onClick={handleLockField}
            disabled={draftCount === 0}
            className="ml-auto flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lock className="h-4 w-4" /> Lock field ({draftCount} draft)
          </button>
        )}
      </div>

      {status && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          {status}
        </div>
      )}

      {mode === "draw" &&
        (() => {
          const sel = selectedId ? terraces.find((t) => t.id === selectedId) : null;
          const target =
            drawKind === "channel" && sel ? ` for Terrace ${sel.terrace_no}` : " as a new terrace";
          return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
              Drawing a {drawKind}
              {drawKind === "channel" ? target : ""}. Click to place points along the line,
              double-click to finish. Esc to cancel.
              {drawKind === "channel" && !sel && " (Select a crest first to pair the channel.)"}
            </div>
          );
        })()}

      {selectedFieldId && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="overflow-hidden rounded-xl border border-slate-200 lg:flex-1">
            <TerracesMap
              terraces={terraces}
              boundary={selectedField?.boundary_geojson || null}
              mode={mode}
              reloadKey={reloadKey}
              onSelect={setSelectedId}
              onGeomUpdate={handleGeomUpdate}
              onCreate={handleCreate}
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white lg:w-[360px]">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {loading ? "Loading..." : `${groups.length} terraces`}
              </p>
              <p className="text-xs text-slate-500">
                {lockedCount} locked · {draftCount} draft
              </p>
            </div>
            <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {groups.map((g) => {
                const coverage = g.crest?.channel_coverage ?? null;
                const suspect = g.crest && coverage !== null && coverage < 0.3;
                return (
                  <div
                    key={g.no}
                    className={`px-4 py-3 ${g.lines.some((l) => l.id === selectedId) ? "bg-emerald-50" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-sm"
                        style={{ background: g.crest ? terraceColor(g.crest) : "#94a3b8" }}
                      />
                      <span className="flex-1 text-sm font-medium text-slate-800">
                        Terrace {g.no}
                      </span>
                      {g.locked ? (
                        <button
                          onClick={() => handleUnlockGroup(g.no)}
                          className="flex items-center gap-1 rounded-full border border-emerald-400 px-2 py-0.5 text-xs text-emerald-600"
                        >
                          <Lock className="h-3 w-3" /> locked
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLockGroup(g.no)}
                          className="flex items-center gap-1 rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-500 hover:border-emerald-400 hover:text-emerald-600"
                        >
                          <LockOpen className="h-3 w-3" /> lock
                        </button>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-3 pl-[18px] text-xs text-slate-500">
                      {g.crest ? (
                        <span>crest {Math.round(g.crest.length_ft ?? 0).toLocaleString()} ft</span>
                      ) : (
                        <span className="text-slate-400">no crest</span>
                      )}
                      <span>
                        {g.channels.length} channel{g.channels.length === 1 ? "" : "s"}
                      </span>
                      {suspect ? (
                        <span className="font-medium text-orange-600">no paired channel</span>
                      ) : coverage !== null ? (
                        <span>{Math.round(coverage * 100)}% cover</span>
                      ) : null}
                    </div>
                    {selectedId && g.lines.some((l) => l.id === selectedId) && (
                      <button
                        onClick={() => handleDelete(selectedId)}
                        className="mt-2 flex items-center gap-1 pl-[18px] text-xs text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-3 w-3" /> Delete selected line
                      </button>
                    )}
                  </div>
                );
              })}
              {!loading && groups.length === 0 && (
                <p className="px-4 py-6 text-sm text-slate-500">
                  No terraces for this field yet. Draw lines, or import detected lines.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
