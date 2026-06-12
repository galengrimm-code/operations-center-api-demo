"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Terrace } from "@/types/terrace";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const LOCKED_SOURCE = "locked-terraces";
const LOCKED_LAYER = "locked-terraces-line";
const BOUNDARY_SOURCE = "terr-boundary-source";
const BOUNDARY_LAYER = "terr-boundary-line";

// Color a terrace line: crest yellow (orange if it's a crest with no paired
// channel — a "suspect"), channel magenta, waterway gray.
export function terraceColor(t: Terrace): string {
  if (t.kind === "channel") return "#d946ef";
  if (t.kind === "waterway") return "#94a3b8";
  // crest
  if (t.channel_coverage !== null && t.channel_coverage < 0.3) return "#f97316"; // suspect
  return "#facc15";
}

const DRAW_STYLES = [
  {
    id: "gl-draw-line-inactive",
    type: "line",
    filter: ["all", ["==", "active", "false"], ["==", "$type", "LineString"]],
    paint: { "line-color": ["get", "user_color"], "line-width": 3, "line-opacity": 0.95 },
  },
  {
    id: "gl-draw-line-active",
    type: "line",
    filter: ["all", ["==", "active", "true"], ["==", "$type", "LineString"]],
    paint: { "line-color": "#ffffff", "line-width": 3, "line-dasharray": [0.4, 2] },
  },
  {
    id: "gl-draw-vertex-halo",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 6, "circle-color": "#ffffff" },
  },
  {
    id: "gl-draw-vertex",
    type: "circle",
    filter: ["all", ["==", "meta", "vertex"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 4, "circle-color": "#10b981" },
  },
  {
    id: "gl-draw-midpoint",
    type: "circle",
    filter: ["all", ["==", "meta", "midpoint"], ["==", "$type", "Point"]],
    paint: { "circle-radius": 3, "circle-color": "#fbbf24" },
  },
];

interface TerracesMapProps {
  terraces: Terrace[];
  boundary: GeoJSON.MultiPolygon | null;
  /** "select" lets the user pick/drag vertices; "draw" arms a new line. */
  mode: "select" | "draw";
  /** Bump to force a full reload of draw features (after add/delete/lock). */
  reloadKey: number;
  onSelect: (id: string | null) => void;
  onGeomUpdate: (id: string, geom: GeoJSON.LineString) => void;
  onCreate: (geom: GeoJSON.LineString) => void;
}

export function TerracesMap({
  terraces,
  boundary,
  mode,
  reloadKey,
  onSelect,
  onGeomUpdate,
  onCreate,
}: TerracesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Latest props for handlers/effects without re-binding listeners or
  // reloading Draw on every geometry save.
  const terracesRef = useRef(terraces);
  terracesRef.current = terraces;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onGeomUpdateRef = useRef(onGeomUpdate);
  onGeomUpdateRef.current = onGeomUpdate;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-95.7, 39.8],
      zoom: 12,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      // Expose our terraceId/color properties as `user_*` in styles and keep
      // them on the features returned by draw.* events (stripped otherwise).
      userProperties: true,
      styles: DRAW_STYLES,
    });
    map.addControl(draw);

    map.on("load", () => {
      map.resize();
      setMapReady(true);
    });

    map.on("draw.update", (e: { features: GeoJSON.Feature[] }) => {
      for (const f of e.features) {
        const id = (f.properties as { terraceId?: string })?.terraceId;
        if (id && f.geometry.type === "LineString") {
          onGeomUpdateRef.current(id, f.geometry as GeoJSON.LineString);
        }
      }
    });

    map.on("draw.create", (e: { features: GeoJSON.Feature[] }) => {
      const f = e.features[0];
      if (f?.geometry.type === "LineString") {
        // Remove draw's own copy; parent re-adds it as a persisted draft.
        draw.delete(f.id as string);
        onCreateRef.current(f.geometry as GeoJSON.LineString);
      }
    });

    map.on("draw.selectionchange", (e: { features: GeoJSON.Feature[] }) => {
      const f = e.features[0];
      const id = (f?.properties as { terraceId?: string })?.terraceId ?? null;
      onSelectRef.current(id);
    });

    mapRef.current = map;
    drawRef.current = draw;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  // Load draft lines into Draw + locked lines into a static layer. Keyed on
  // reloadKey (bumped on field switch / add / delete / lock), NOT on terraces —
  // a geometry save patches terraces but must not rebuild Draw mid-edit.
  useEffect(() => {
    const map = mapRef.current;
    const draw = drawRef.current;
    if (!map || !draw || !mapReady) return;
    const terraces = terracesRef.current;
    const boundary = boundaryRef.current;

    draw.deleteAll();
    const drafts = terraces.filter((t) => t.status === "draft");
    for (const t of drafts) {
      draw.add({
        type: "Feature",
        id: t.id,
        properties: { terraceId: t.id, color: terraceColor(t) },
        geometry: t.geom,
      });
    }

    const lockedFc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: terraces
        .filter((t) => t.status === "locked")
        .map((t) => ({
          type: "Feature" as const,
          properties: { color: terraceColor(t) },
          geometry: t.geom,
        })),
    };
    if (map.getSource(LOCKED_SOURCE)) {
      (map.getSource(LOCKED_SOURCE) as mapboxgl.GeoJSONSource).setData(lockedFc);
    } else {
      map.addSource(LOCKED_SOURCE, { type: "geojson", data: lockedFc });
      map.addLayer({
        id: LOCKED_LAYER,
        type: "line",
        source: LOCKED_SOURCE,
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.9 },
      });
    }

    // Field boundary outline
    if (boundary) {
      const bFc: GeoJSON.Feature = { type: "Feature", properties: {}, geometry: boundary };
      if (map.getSource(BOUNDARY_SOURCE)) {
        (map.getSource(BOUNDARY_SOURCE) as mapboxgl.GeoJSONSource).setData(bFc);
      } else {
        map.addSource(BOUNDARY_SOURCE, { type: "geojson", data: bFc });
        map.addLayer({
          id: BOUNDARY_LAYER,
          type: "line",
          source: BOUNDARY_SOURCE,
          paint: { "line-color": "#34d399", "line-width": 2, "line-opacity": 0.85 },
        });
      }
    }

    // Fit to all terrace + boundary coords
    const bounds = new mapboxgl.LngLatBounds();
    for (const t of terraces)
      for (const c of t.geom.coordinates) bounds.extend(c as [number, number]);
    if (boundary)
      for (const p of boundary.coordinates)
        for (const r of p) for (const c of r) bounds.extend(c as [number, number]);
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 50, maxZoom: 16, duration: 0 });
  }, [mapReady, reloadKey]);

  // Arm / disarm draw mode
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !mapReady) return;
    if (mode === "draw") draw.changeMode("draw_line_string");
    else draw.changeMode("simple_select");
  }, [mode, mapReady]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[640px] items-center justify-center bg-slate-950">
        <p className="text-sm text-slate-400">Mapbox token not configured</p>
      </div>
    );
  }
  return <div ref={containerRef} className="h-[640px] w-full" />;
}
