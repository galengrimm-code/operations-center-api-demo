"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { useMapContext } from "@/contexts/map-context";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { formatArea } from "@/lib/area-utils";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";
const SOURCE_ID = "fields-source";
const FILL_LAYER_ID = "fields-fill";
const LINE_LAYER_ID = "fields-line";
const IRRIGATED_SOURCE_ID = "irrigated-fields-source";
const IRRIGATED_FILL_LAYER_ID = "irrigated-fields-fill";
const IRRIGATED_LINE_LAYER_ID = "irrigated-fields-line";
const OP_IMAGE_SOURCE = "op-image-source";
const OP_IMAGE_LAYER = "op-image-layer";

export function FullMap() {
  const router = useRouter();
  const { johnDeereConnection } = useAuth();
  const { filteredFields, selectedFieldId, setMapInstance, selectedOperation } = useMapContext();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const preferredUnitRef = useRef(johnDeereConnection?.preferred_area_unit || "ac");

  useEffect(() => {
    preferredUnitRef.current = johnDeereConnection?.preferred_area_unit || "ac";
  }, [johnDeereConnection?.preferred_area_unit]);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/satellite-streets-v12",
      center: [-95.7, 39.8],
      zoom: 4,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      map.resize();
      setMapReady(true);
    });

    mapRef.current = map;
    setMapInstance(map);

    return () => {
      setMapReady(false);
      setMapInstance(null);
      map.remove();
      mapRef.current = null;
    };
  }, [setMapInstance]);

  // Render field boundaries
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clean up existing layers
    [IRRIGATED_LINE_LAYER_ID, IRRIGATED_FILL_LAYER_ID, LINE_LAYER_ID, FILL_LAYER_ID].forEach(
      (id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      },
    );
    if (map.getSource(IRRIGATED_SOURCE_ID)) map.removeSource(IRRIGATED_SOURCE_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    const fieldsWithBoundaries = filteredFields.filter((f) => f.boundary_geojson);
    if (fieldsWithBoundaries.length === 0) return;

    const features = fieldsWithBoundaries.map((field) => ({
      type: "Feature" as const,
      properties: {
        name: field.name,
        area_value: field.boundary_area_value,
        area_unit: field.boundary_area_unit,
        jd_field_id: field.jd_field_id,
        client_name: field.client_name || "",
        farm_name: field.farm_name || "",
        id: field.id,
        is_selected: field.jd_field_id === selectedFieldId ? "true" : "false",
      },
      geometry: field.boundary_geojson!,
    }));

    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };

    map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection, generateId: true });

    // Base fill layer
    map.addLayer({
      id: FILL_LAYER_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": "#10b981",
        "fill-opacity": [
          "case",
          ["==", ["get", "is_selected"], "true"],
          0.35,
          ["boolean", ["feature-state", "hover"], false],
          0.3,
          0.15,
        ],
      },
    });

    // Base line layer
    map.addLayer({
      id: LINE_LAYER_ID,
      type: "line",
      source: SOURCE_ID,
      paint: {
        "line-color": ["case", ["==", ["get", "is_selected"], "true"], "#34d399", "#10b981"],
        "line-width": [
          "case",
          ["==", ["get", "is_selected"], "true"],
          3,
          ["boolean", ["feature-state", "hover"], false],
          2.5,
          1.5,
        ],
        "line-opacity": 0.9,
      },
    });

    // Irrigated boundary layers
    const fieldsWithIrrigated = filteredFields.filter((f) => f.irrigated_boundary_geojson);
    if (fieldsWithIrrigated.length > 0) {
      const irrigatedFeatures = fieldsWithIrrigated.map((field) => ({
        type: "Feature" as const,
        properties: {
          name: field.name,
          jd_field_id: field.jd_field_id,
          is_selected: field.jd_field_id === selectedFieldId ? "true" : "false",
        },
        geometry: field.irrigated_boundary_geojson!,
      }));

      map.addSource(IRRIGATED_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: irrigatedFeatures },
      });

      map.addLayer({
        id: IRRIGATED_FILL_LAYER_ID,
        type: "fill",
        source: IRRIGATED_SOURCE_ID,
        paint: {
          "fill-color": "#06b6d4",
          "fill-opacity": ["case", ["==", ["get", "is_selected"], "true"], 0.3, 0.15],
        },
      });

      map.addLayer({
        id: IRRIGATED_LINE_LAYER_ID,
        type: "line",
        source: IRRIGATED_SOURCE_ID,
        paint: {
          "line-color": "#22d3ee",
          "line-width": ["case", ["==", ["get", "is_selected"], "true"], 2.5, 1.5],
          "line-opacity": 0.9,
          "line-dasharray": [4, 3],
        },
      });
    }

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    for (const field of fieldsWithBoundaries) {
      const geojson = field.boundary_geojson!;
      for (const polygon of geojson.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            bounds.extend(coord as [number, number]);
          }
        }
      }
    }
    for (const field of fieldsWithIrrigated) {
      const geojson = field.irrigated_boundary_geojson!;
      for (const polygon of geojson.coordinates) {
        for (const ring of polygon) {
          for (const coord of ring) {
            bounds.extend(coord as [number, number]);
          }
        }
      }
    }
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 15 });
    }

    // Hover interactions
    let hoveredFeatureId: string | number | undefined;

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredFeatureId }, { hover: false });
        hoveredFeatureId = undefined;
      }
    };
    const handleMouseMove = (
      e: mapboxgl.MapMouseEvent & { features?: mapboxgl.GeoJSONFeature[] },
    ) => {
      if (!e.features || e.features.length === 0) return;
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredFeatureId }, { hover: false });
      }
      hoveredFeatureId = e.features[0].id;
      if (hoveredFeatureId !== undefined) {
        map.setFeatureState({ source: SOURCE_ID, id: hoveredFeatureId }, { hover: true });
      }
    };

    // Click → navigate to field detail
    const handleClick = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.GeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      if (!props) return;
      const fieldId = props.jd_field_id;
      if (fieldId) {
        router.push(`/map/field/${fieldId}`);
      }
    };

    map.on("mouseenter", FILL_LAYER_ID, handleMouseEnter);
    map.on("mouseleave", FILL_LAYER_ID, handleMouseLeave);
    map.on("mousemove", FILL_LAYER_ID, handleMouseMove);
    map.on("click", FILL_LAYER_ID, handleClick);

    return () => {
      map.off("mouseenter", FILL_LAYER_ID, handleMouseEnter);
      map.off("mouseleave", FILL_LAYER_ID, handleMouseLeave);
      map.off("mousemove", FILL_LAYER_ID, handleMouseMove);
      map.off("click", FILL_LAYER_ID, handleClick);
    };
  }, [filteredFields, mapReady, selectedFieldId, router]);

  // Fly to selected field
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedFieldId) return;

    const field = filteredFields.find((f) => f.jd_field_id === selectedFieldId);
    if (!field?.boundary_geojson) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const polygon of field.boundary_geojson.coordinates) {
      for (const ring of polygon) {
        for (const coord of ring) {
          bounds.extend(coord as [number, number]);
        }
      }
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: 80, left: 80, right: 460 },
        maxZoom: 16,
        duration: 1200,
      });
    }
  }, [selectedFieldId, filteredFields, mapReady]);

  // Operation image overlay
  const overlayUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clean up previous overlay
    if (map.getLayer(OP_IMAGE_LAYER)) map.removeLayer(OP_IMAGE_LAYER);
    if (map.getSource(OP_IMAGE_SOURCE)) map.removeSource(OP_IMAGE_SOURCE);
    if (overlayUrlRef.current) {
      URL.revokeObjectURL(overlayUrlRef.current);
      overlayUrlRef.current = null;
    }

    if (!selectedOperation?.map_image_path || !selectedOperation?.map_image_extent) return;

    const extent = selectedOperation.map_image_extent;
    const imagePath = selectedOperation.map_image_path;
    let cancelled = false;

    (async () => {
      try {
        const { data: blob } = await supabase.storage.from("operation-images").download(imagePath);
        if (!blob || cancelled) return;

        const objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        overlayUrlRef.current = objectUrl;

        // Mapbox image source coordinates: [topLeft, topRight, bottomRight, bottomLeft]
        const coordinates: [
          [number, number],
          [number, number],
          [number, number],
          [number, number],
        ] = [
          [extent.minimumLongitude, extent.maximumLatitude], // top-left
          [extent.maximumLongitude, extent.maximumLatitude], // top-right
          [extent.maximumLongitude, extent.minimumLatitude], // bottom-right
          [extent.minimumLongitude, extent.minimumLatitude], // bottom-left
        ];

        map.addSource(OP_IMAGE_SOURCE, {
          type: "image",
          url: objectUrl,
          coordinates,
        });

        // Insert below the field line layer so boundaries stay visible
        map.addLayer(
          {
            id: OP_IMAGE_LAYER,
            type: "raster",
            source: OP_IMAGE_SOURCE,
            paint: {
              "raster-opacity": 0.85,
              "raster-fade-duration": 300,
            },
          },
          FILL_LAYER_ID,
        );
      } catch {
        // Image download failed silently — overlay just won't show
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedOperation, mapReady]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <p className="text-sm text-slate-400">Mapbox token not configured</p>
          <p className="mt-1 text-xs text-slate-600">
            Add NEXT_PUBLIC_MAPBOX_TOKEN to your environment
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
