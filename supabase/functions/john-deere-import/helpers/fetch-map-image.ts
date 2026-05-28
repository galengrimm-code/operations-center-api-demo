import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { JOHN_DEERE_API_BASE } from "../../_shared/john-deere.ts";
import { MEASUREMENT_TYPE_MAP } from "./fetch-measurement-data.ts";

export interface MapImageResult {
  map_image_path?: string;
  map_image_extent?: unknown;
  map_image_legends?: unknown;
}

export async function fetchAndStoreMapImage(
  supabase: SupabaseClient,
  accessToken: string,
  userId: string,
  operationId: string,
  operationType: string,
): Promise<MapImageResult> {
  const measurementType = MEASUREMENT_TYPE_MAP[operationType];
  if (!measurementType) return {};

  try {
    const response = await fetch(
      `${JOHN_DEERE_API_BASE}/fieldOperations/${operationId}/measurementTypes/${measurementType}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.deere.axiom.v3.image+json",
          "Accept-UOM-System": "ENGLISH",
        },
      },
    );
    if (!response.ok) return {};

    const data = await response.json();
    const imageValue = data.value || data;
    const imageDataUri: string = imageValue.image || "";
    const extent = imageValue.extent || null;
    const legend = imageValue.legend || null;

    if (!imageDataUri) return {};

    // Strip data URI prefix and decode base64 to bytes
    const base64Data = imageDataUri.replace(/^data:image\/png;base64,/, "");
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Upload to Supabase Storage
    const storagePath = `${userId}/${operationId}.png`;
    const { error: uploadError } = await supabase.storage
      .from("operation-images")
      .upload(storagePath, bytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error(`[import] Failed to upload map image: ${uploadError.message}`);
      return {};
    }

    return {
      map_image_path: storagePath,
      map_image_extent: extent,
      map_image_legends: legend?.ranges || null,
    };
  } catch (err) {
    console.error(`[import] Map image fetch error:`, err);
    return {};
  }
}
