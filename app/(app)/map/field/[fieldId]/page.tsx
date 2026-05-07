"use client";

import { useEffect } from "react";
import { useMapContext } from "@/contexts/map-context";

export default function FieldDetailPage({ params }: { params: { fieldId: string } }) {
  const { setSelectedFieldId } = useMapContext();

  useEffect(() => {
    setSelectedFieldId(params.fieldId);
    return () => setSelectedFieldId(null);
  }, [params.fieldId, setSelectedFieldId]);

  // UI is rendered by FieldSidePanel in the map layout
  return null;
}
