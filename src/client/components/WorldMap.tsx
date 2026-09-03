import { useId } from "react";
import { REGIONS, type RegionCode } from "../../shared/types";
import type { AssignmentState } from "../../shared/api";

type MapAssignment = Omit<AssignmentState, "token">;
type MarkerStatus = "active" | "complete" | "error" | "idle";

interface WorldMapProps {
  assignments: MapAssignment[];
  compact?: boolean;
}

function markerStatus(items: MapAssignment[]): MarkerStatus {
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => ["ready", "running"].includes(item.status)))
    return "active";
  if (items.every((item) => item.status === "complete")) return "complete";
  return "idle";
}

function actualLocations(items: MapAssignment[]): string[] {
  return [
    ...new Set(
      items
        .map((item) => item.placement?.location)
        .filter((location): location is string => Boolean(location)),
    ),
  ];
}

export function WorldMap({ assignments, compact = false }: WorldMapProps) {
  const id = useId().replaceAll(":", "");
  const titleId = `globe-title-${id}`;
  const descriptionId = `globe-description-${id}`;
  const glowId = `globe-node-glow-${id}`;
  const grouped = new Map<RegionCode, MapAssignment[]>();
  for (const assignment of assignments) {
    const existing = grouped.get(assignment.region) ?? [];
    existing.push(assignment);
    grouped.set(assignment.region, existing);
  }

  const placementDescription = [...grouped.entries()]
    .map(([code, items]) => {
      const locations = actualLocations(items);
      const suffix = locations.length > 0 ? ` at ${locations.join(", ")}` : "";
      return `${code}: ${items.length} generator${items.length === 1 ? "" : "s"}${suffix}`;
    })
    .join(". ");

  return (
    <div className={`world-map ${compact ? "world-map-compact" : ""}`}>
      <div className="globe-stage">
        <svg
          viewBox="0 0 100 57.11"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>Regional generator placement globe</title>
          <desc id={descriptionId}>
            {placementDescription || "No regional generators are assigned."}
          </desc>
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0" stopColor="currentColor" stopOpacity=".42" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          {[...grouped.entries()].map(([code, items]) => {
            const region = REGIONS[code];
            const status = markerStatus(items);
            const locations = actualLocations(items);
            return (
              <g
                key={code}
                className={`region-node region-${status}`}
                transform={`translate(${region.mapX} ${region.mapY})`}
              >
                <title>
                  {region.label}: {items.length} generator
                  {items.length === 1 ? "" : "s"}
                  {locations.length > 0
                    ? `; actual location ${locations.join(", ")}`
                    : ""}
                </title>
                {status === "active" && (
                  <circle
                    r="3.7"
                    className="region-pulse"
                    fill={`url(#${glowId})`}
                  />
                )}
                <circle r="1.45" className="region-dot" />
                <circle r=".55" className="region-core" />
                {!compact && (
                  <text y="3.25" textAnchor="middle">
                    {code}
                  </text>
                )}
              </g>
            );
          })}
          {!compact && (
            <g className="map-control" transform="translate(52 28.5)">
              <circle r="2.2" />
              <path d="M-1 0h2M0-1v2" />
              <text y="3.9" textAnchor="middle">
                CONTROL
              </text>
            </g>
          )}
        </svg>
      </div>
      <div className="map-legend">
        <span>
          <i className="legend-dot legend-active" /> Running
        </span>
        <span>
          <i className="legend-dot legend-complete" /> Ready / complete
        </span>
        <span>
          <i className="legend-dot legend-idle" /> Waiting / stopped
        </span>
        <a
          className="map-attribution"
          href="https://www.cloudflare.com/network/"
          target="_blank"
          rel="noreferrer"
        >
          Cloudflare network globe ↗
        </a>
      </div>
    </div>
  );
}
