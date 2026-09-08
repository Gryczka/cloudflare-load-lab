import type { AssignmentState } from "../../shared/api";
import { REGIONS, type RegionCode } from "../../shared/types";
import { COLO_COORDINATES } from "../data/colo-coordinates";

export type MapAssignment = Omit<AssignmentState, "token">;
export type MarkerStatus = "active" | "complete" | "error" | "idle";
export type TrafficLevel = "none" | "low" | "medium" | "high" | "surge";

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
  requestRate: number;
  trafficIntensity: number;
  trafficLevel: TrafficLevel;
  usesRegionalFallback: boolean;
}

interface AssignmentGroup {
  code: RegionCode;
  location?: string;
  assignments: MapAssignment[];
}

export function requestTrafficLevel(requestRate: number): TrafficLevel {
  if (requestRate <= 0) return "none";
  if (requestRate < 10) return "low";
  if (requestRate < 50) return "medium";
  if (requestRate < 200) return "high";
  return "surge";
}

export function requestTrafficIntensity(requestRate: number): number {
  if (requestRate <= 0) return 0;
  return Math.min(1, Math.log2(requestRate + 1) / 10);
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
    const metroCode = group.location?.match(/^[A-Z]{3}/)?.[0];
    const coordinates = metroCode ? COLO_COORDINATES[metroCode] : undefined;
    const requestRate = group.assignments.reduce(
      (sum, assignment) => sum + Math.max(0, assignment.requestRate ?? 0),
      0,
    );
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
      requestRate,
      trafficIntensity: requestTrafficIntensity(requestRate),
      trafficLevel: requestTrafficLevel(requestRate),
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
      const traffic =
        marker.requestRate > 0
          ? `; ${marker.requestRate.toLocaleString()} requests per second`
          : "";
      return `${marker.code}${placement}: ${marker.count} generator${marker.count === 1 ? "" : "s"}${fallback}${traffic}`;
    })
    .join(". ");
}
