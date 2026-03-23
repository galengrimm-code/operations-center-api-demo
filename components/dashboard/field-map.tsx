'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useAuth } from '@/contexts/auth-context';
import { fetchStoredFields, importFieldsWithBoundaries } from '@/lib/john-deere-client';
import { Button } from '@/components/ui/button';
import { Loader as Loader2, Download, MapPin } from 'lucide-react';
import type { StoredField } from '@/types/john-deere';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const SOURCE_ID = 'fields-source';
const FILL_LAYER_ID = 'fields-fill';
const LINE_LAYER_ID = 'fields-line';

export function FieldMap() {
  const { johnDeereConnection } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);

  const [storedFields, setStoredFields] = useState<StoredField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const loadStoredFields = useCallback(async () => {
    if (!johnDeereConnection?.selected_org_id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchStoredFields();
      setStoredFields(data.fields || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fields');
    } finally {
      setIsLoading(false);
    }
  }, [johnDeereConnection?.selected_org_id]);

  const handleImport = async () => {
    setIsImporting(true);
    setError(null);
    try {
      const data = await importFieldsWithBoundaries();
      setStoredFields(data.fields || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import fields');
    } finally {
      setIsImporting(false);
    }
  };

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    (mapboxgl as any).config.EVENTS_URL = '';

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/standard-satellite',
      center: [-95.7, 39.8],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
      }
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    loadStoredFields();
  }, [loadStoredFields]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    const fieldsWithBoundaries = storedFields.filter(f => f.boundary_geojson);

    if (fieldsWithBoundaries.length === 0) return;

    const features = fieldsWithBoundaries.map(field => ({
      type: 'Feature' as const,
      properties: {
        name: field.name,
        area_value: field.boundary_area_value,
        area_unit: field.boundary_area_unit,
        jd_field_id: field.jd_field_id,
      },
      geometry: field.boundary_geojson!,
    }));

    const featureCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: featureCollection,
    });

    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': '#059669',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.45,
          0.25,
        ],
      },
    });

    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': '#059669',
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          3,
          2,
        ],
      },
    });

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

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    }

    map.on('mouseenter', FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
    });

    map.on('click', FILL_LAYER_ID, (e) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      if (!props) return;

      const name = props.name || 'Unnamed Field';
      const areaValue = props.area_value;
      const areaUnit = props.area_unit;

      let areaText = '';
      if (areaValue && areaUnit) {
        const formatted = Number(areaValue).toLocaleString(undefined, {
          maximumFractionDigits: 1,
        });
        areaText = `<div style="color:#94a3b8;font-size:12px;margin-top:2px;">${formatted} ${areaUnit}</div>`;
      }

      if (popupRef.current) {
        popupRef.current.remove();
      }

      popupRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: '200px',
      })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:system-ui,sans-serif;padding:2px 0;">
            <div style="font-weight:600;color:#0f172a;font-size:14px;">${name}</div>
            ${areaText}
          </div>
        `)
        .addTo(map);
    });
  }, [storedFields, mapReady]);

  const fieldsWithBoundaries = storedFields.filter(f => f.boundary_geojson);
  const withoutBoundaries = storedFields.length - fieldsWithBoundaries.length;
  const hasFields = storedFields.length > 0;

  if (!MAPBOX_TOKEN) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium">Mapbox token not configured</p>
        <p className="text-sm text-slate-400 mt-1">
          Add NEXT_PUBLIC_MAPBOX_TOKEN to your environment variables
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="relative" style={{ height: '600px' }}>
        <div ref={mapContainerRef} className="absolute inset-0" />

        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg border border-slate-200 shadow-lg p-3">
            <Button
              onClick={handleImport}
              disabled={isImporting || isLoading}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  {hasFields ? 'Re-import Fields' : 'Import Fields'}
                </>
              )}
            </Button>

            {hasFields && (
              <div className="mt-2 text-xs text-slate-600 text-center">
                <span className="font-medium">{storedFields.length}</span> field{storedFields.length !== 1 ? 's' : ''}
                {withoutBoundaries > 0 && (
                  <span className="text-slate-400">
                    {' '}&middot; {withoutBoundaries} without boundaries
                  </span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50/95 backdrop-blur-sm border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs max-w-[240px]">
              {error}
            </div>
          )}
        </div>

        {isLoading && !isImporting && storedFields.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-6 text-center pointer-events-auto">
              <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
              <p className="text-slate-600 text-sm">Loading fields...</p>
            </div>
          </div>
        )}

        {!isLoading && !hasFields && !error && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="bg-white/95 backdrop-blur-sm rounded-xl border border-slate-200 shadow-lg p-8 text-center max-w-sm pointer-events-auto">
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MapPin className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 mb-2">
                No fields imported yet
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                Import your fields from John Deere to see them on the map with their boundaries.
              </p>
              <Button
                onClick={handleImport}
                disabled={isImporting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Import Fields
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
