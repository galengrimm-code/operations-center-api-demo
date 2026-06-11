"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { FeatureCollection } from "geojson";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const BANDS_SOURCE = "elevation-bands-source";
const BANDS_LAYER = "elevation-bands-fill";
const LINES_SOURCE = "elevation-lines-source";
const LINES_LAYER = "elevation-lines";
const LABELS_LAYER = "elevation-labels";
const BOUNDARY_SOURCE = "elevation-boundary-source";
const BOUNDARY_LAYER = "elevation-boundary-line";

interface ElevationMapProps {
  boundary: GeoJSON.MultiPolygon | null;
  bands: FeatureCollection;
  lines: FeatureCollection;
}

export function ElevationMap({ boundary, bands, lines }: ElevationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-95.7, 39.8],
      zoom: 12,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.resize();
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    [LABELS_LAYER, LINES_LAYER, BANDS_LAYER, BOUNDARY_LAYER].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    [LINES_SOURCE, BANDS_SOURCE, BOUNDARY_SOURCE].forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });

    map.addSource(BANDS_SOURCE, { type: "geojson", data: bands });
    map.addLayer({
      id: BANDS_LAYER,
      type: "fill",
      source: BANDS_SOURCE,
      paint: {
        "fill-color": ["get", "fill"],
        "fill-opacity": 0.55,
      },
    });

    map.addSource(LINES_SOURCE, { type: "geojson", data: lines });
    map.addLayer({
      id: LINES_LAYER,
      type: "line",
      source: LINES_SOURCE,
      paint: {
        "line-color": "#ffffff",
        "line-width": 0.8,
        "line-opacity": 0.7,
      },
    });

    map.addLayer({
      id: LABELS_LAYER,
      type: "symbol",
      source: LINES_SOURCE,
      layout: {
        "symbol-placement": "line",
        "text-field": ["get", "label"],
        "text-size": 11,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "#1e293b",
        "text-halo-width": 1.2,
      },
    });

    if (boundary) {
      map.addSource(BOUNDARY_SOURCE, {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: boundary },
      });
      map.addLayer({
        id: BOUNDARY_LAYER,
        type: "line",
        source: BOUNDARY_SOURCE,
        paint: {
          "line-color": "#34d399",
          "line-width": 2,
          "line-opacity": 0.9,
        },
      });
    }

    // Fit to band extents (the actual data footprint)
    const bounds = new mapboxgl.LngLatBounds();
    for (const feature of bands.features) {
      if (feature.geometry.type !== "MultiPolygon") continue;
      for (const poly of feature.geometry.coordinates) {
        for (const ring of poly) {
          for (const coord of ring) {
            bounds.extend(coord as [number, number]);
          }
        }
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 40, maxZoom: 16 });
    }
  }, [bands, lines, boundary, mapReady]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-[600px] items-center justify-center bg-slate-950">
        <p className="text-sm text-slate-400">Mapbox token not configured</p>
      </div>
    );
  }

  return <div ref={mapContainerRef} className="h-[600px] w-full" />;
}
