"use client";

// Discover map — Leaflet over free OpenStreetMap tiles (no API key required).
// Markers are HTML divIcons (not image assets) so there are no broken-icon
// issues under bundling, and golden pins / recommended pins get their own
// styling. Hover shows a tooltip; click selects (detail renders in the sidebar).

import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Place } from "@eynis/shared";

export const CATEGORY_COLOR: Record<string, string> = {
  restaurant: "#ef4444",
  cafe: "#d97706",
  attraction: "#8b5cf6",
  shopping: "#ec4899",
  nightlife: "#6366f1",
  hotel: "#0ea5e9",
  service: "#14b8a6",
  outdoors: "#22c55e",
  other: "#64748b",
};

export const CATEGORY_EMOJI: Record<string, string> = {
  restaurant: "🍽️",
  cafe: "☕",
  attraction: "📸",
  shopping: "🛍️",
  nightlife: "🎶",
  hotel: "🏨",
  service: "💆",
  outdoors: "🌴",
  other: "📍",
};

function pinHtml(place: Place, selected: boolean, recommended: boolean): string {
  const emoji = CATEGORY_EMOJI[place.category] ?? "📍";
  const color = CATEGORY_COLOR[place.category] ?? CATEGORY_COLOR.other;
  const size = place.isGolden ? 42 : 34;
  const ring = recommended
    ? "box-shadow:0 0 0 4px rgba(56,189,248,0.45),0 0 0 8px rgba(56,189,248,0.18);"
    : selected
    ? "box-shadow:0 0 0 4px rgba(15,23,42,0.25);"
    : "box-shadow:0 4px 10px rgba(0,0,0,0.28);";
  const bg = place.isGolden
    ? "background:linear-gradient(145deg,#fbbf24,#f59e0b);border:2px solid #fff7e0;"
    : `background:${color};border:2px solid #fff;`;
  const crown = place.isGolden
    ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);font-size:13px;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))">👑</div>`
    : "";
  return `
    <div style="position:relative;width:${size}px;height:${size}px">
      ${crown}
      <div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);${bg}${ring};display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .12s">
        <span style="transform:rotate(45deg);font-size:${place.isGolden ? 18 : 15}px;line-height:1">${emoji}</span>
      </div>
    </div>`;
}

function makeIcon(place: Place, selected: boolean, recommended: boolean): L.DivIcon {
  const size = place.isGolden ? 42 : 34;
  return L.divIcon({
    html: pinHtml(place, selected, recommended),
    className: "discover-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    tooltipAnchor: [0, -size],
  });
}

// Imperatively fit the map to the visible places, and fly to a selection.
function MapController({ places, selectedId }: { places: Place[]; selectedId: string | null }) {
  const map = useMap();

  useEffect(() => {
    if (selectedId) return; // don't refit while a selection is driving the view
    if (places.length === 0) return;
    if (places.length === 1) {
      const p = places[0]!;
      map.setView([p.lat, p.lng], 14);
      return;
    }
    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places.map((p) => p.id).join(","), selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const p = places.find((x) => x.id === selectedId);
    if (p) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  return null;
}

export interface DiscoverMapProps {
  places: Place[];
  selectedId: string | null;
  recommendedIds: string[];
  onSelect: (place: Place) => void;
}

export default function DiscoverMap({ places, selectedId, recommendedIds, onSelect }: DiscoverMapProps) {
  const recommended = useMemo(() => new Set(recommendedIds), [recommendedIds]);

  const center = useMemo<[number, number]>(() => {
    if (places.length === 0) return [15.54, 73.76]; // default: North Goa
    const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
    const lng = places.reduce((s, p) => s + p.lng, 0) / places.length;
    return [lat, lng];
  }, [places]);

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      style={{ width: "100%", height: "100%", background: "#e2e8f0" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapController places={places} selectedId={selectedId} />
      {places.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lng]}
          icon={makeIcon(p, p.id === selectedId, recommended.has(p.id))}
          zIndexOffset={p.isGolden ? 1000 : recommended.has(p.id) ? 500 : 0}
          eventHandlers={{ click: () => onSelect(p) }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            <div style={{ fontWeight: 700, fontSize: 12 }}>
              {p.isGolden ? "👑 " : ""}{p.name}
            </div>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "capitalize" }}>
              {p.category}{p.rating ? ` · ★ ${p.rating}` : ""}
            </div>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
