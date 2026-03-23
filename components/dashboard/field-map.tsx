'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import { useAuth } from '@/contexts/auth-context';
import { formatArea } from '@/lib/area-utils';
import { Button } from '@/components/ui/button';
import { Loader as Loader2, Download, MapPin } from 'lucide-react';
import type { StoredField } from '@/types/john-deere';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

const SOURCE_ID = 'fields-source';
const FILL_LAYER_ID = 'fields-fill';
const LINE_LAYER_ID = 'fields-line';

interface FieldMapProps {
  fields: StoredField[];
  selectedClient: string | null;
  selectedFarm: string | null;
  isLoading: boolean;
  error: string | null;
  onImport: () => Promise<void>;
  isImporting: boolean;
}

export function FieldMap({
  fields,
  selectedClient,
  selectedFarm,
  isLoading,
  error,
  onImport,
  isImporting,
}: FieldMapProps) {
  const { johnDeereConnection } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const preferredUnitRef = useRef(johnDeereConnection?.preferred_area_unit || 'ac');

  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    preferredUnitRef.current = johnDeereConnection?.preferred_area_unit || 'ac';
  }, [johnDeereConnection?.preferred_area_unit]);

  const filtered = useMemo(() => {
    let result = fields;
    if (selectedClient) result = result.filter(f => f.client_name === selectedClient);
    if (selectedFarm) result = result.filter(f => f.farm_name === selectedFarm);
    return result;
  }, [fields, selectedClient, selectedFarm]);

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-95.7, 39.8],
      zoom: 4,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    map.on('load', () => {
      map.resize();
      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      if (popupRef.current) {
        popupRef.current.remove();
      }
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
    if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

    const fieldsWithBoundaries = filtered.filter(f => f.boundary_geojson);

    if (fieldsWithBoundaries.length === 0) return;

    const features = fieldsWithBoundaries.map(field => ({
      type: 'Feature' as const,
      properties: {
        name: field.name,
        area_value: field.boundary_area_value,
        area_unit: field.boundary_area_unit,
        jd_field_id: field.jd_field_id,
        client_name: field.client_name || '',
        farm_name: field.farm_name || '',
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
      const areaDisplay = formatArea(
        props.area_value ? Number(props.area_value) : null,
        props.area_unit || null,
        preferredUnitRef.current
      );
      const clientName = props.client_name || '';
      const farmName = props.farm_name || '';

      const areaText = areaDisplay
        ? `<div style="color:#94a3b8;font-size:12px;margin-top:2px;">${areaDisplay}</div>`
        : '';

      const clientText = clientName
        ? `<div style="color:#0369a1;font-size:11px;margin-top:4px;">Client: ${clientName}</div>`
        : '';

      const farmText = farmName
        ? `<div style="color:#b45309;font-size:11px;margin-top:1px;">Farm: ${farmName}</div>`
        : '';

      if (popupRef.current) {
        popupRef.current.remove();
      }

      popupRef.current = new mapboxgl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: '220px',
      })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:system-ui,sans-serif;padding:2px 0;">
            <div style="font-weight:600;color:#0f172a;font-size:14px;">${name}</div>
            ${areaText}
            ${clientText}
            ${farmText}
          </div>
        `)
        .addTo(map);
    });
  }, [filtered, mapReady]);

  const fieldsWithBoundaries = filtered.filter(f => f.boundary_geojson);
  const withoutBoundaries = filtered.length - fieldsWithBoundaries.length;
  const hasFields = fields.length > 0;

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
        <div ref={mapContainerRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} />

        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg border border-slate-200 shadow-lg p-3">
            <Button
              onClick={onImport}
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
                <span className="font-medium">{filtered.length}</span> field{filtered.length !== 1 ? 's' : ''}
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

        {isLoading && !isImporting && fields.length === 0 && (
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
                onClick={onImport}
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
