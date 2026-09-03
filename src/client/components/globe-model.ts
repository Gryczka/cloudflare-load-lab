import type { AssignmentState } from "../../shared/api";
import { REGIONS, type RegionCode } from "../../shared/types";
import { COLO_COORDINATES } from "../data/colo-coordinates";

export type MapAssignment = Omit<AssignmentState, "token">;
export type MarkerStatus = "active" | "complete" | "error" | "idle";

export interface GlobeMarker {
  id: string;
  code: RegionCode;
  displayCode: string;
  label: string;
  latitude: number;
  longitude: number;
  fallbackX: number;
  fallbackY: number;
  count: number;
  locations: string[];
  status: MarkerStatus;
  usesRegionalFallback: boolean;
}

interface AssignmentGroup {
  code: RegionCode;
  location?: string;
  assignments: MapAssignment[];
}

function markerStatus(items: MapAssignment[]): MarkerStatus {
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => item.status === "running")) return "active";
  if (items.some((item) => ["ready", "complete"].includes(item.status)))
    return "complete";
  return "idle";
}

export function createGlobeMarkers(
  assignments: MapAssignment[],
): GlobeMarker[] {
  const grouped = new Map<string, AssignmentGroup>();
  for (const assignment of assignments) {
    const location = assignment.placement?.location?.trim().toUpperCase();
    const id = `${assignment.region}:${location || "requested"}`;
    const group = grouped.get(id) ?? {
      code: assignment.region,
      location: location || undefined,
      assignments: [],
    };
    group.assignments.push(assignment);
    grouped.set(id, group);
  }

  return [...grouped.entries()].map(([id, group]) => {
    const region = REGIONS[group.code];
    const coordinates = group.location
      ? COLO_COORDINATES[group.location]
      : undefined;
    return {
      id,
      code: group.code,
      displayCode: group.location ?? group.code,
      label: region.label,
      latitude: coordinates?.[0] ?? region.globeLatitude,
      longitude: coordinates?.[1] ?? region.globeLongitude,
      fallbackX: region.mapX,
      fallbackY: region.mapY,
      count: group.assignments.length,
      locations: group.location ? [group.location] : [],
      status: markerStatus(group.assignments),
      usesRegionalFallback: Boolean(group.location && !coordinates),
    };
  });
}

export function describeGlobeMarkers(markers: GlobeMarker[]): string {
  if (markers.length === 0) return "No regional generators are assigned.";
  return markers
    .map((marker) => {
      const placement = marker.locations[0]
        ? `, actual location ${marker.locations[0]}`
        : ", awaiting actual location";
      const fallback = marker.usesRegionalFallback
        ? "; shown at the regional representative point"
        : "";
      return `${marker.code}${placement}: ${marker.count} generator${marker.count === 1 ? "" : "s"}${fallback}`;
    })
    .join(". ");
}
