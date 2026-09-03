import { REGIONS, type RegionCode } from "../../shared/types";
import type { AssignmentState } from "../../shared/api";

interface WorldMapProps {
  assignments: Array<Omit<AssignmentState, "token">>;
  compact?: boolean;
}

const land = [
  "M8 29l7-13 14-7 15 5 2 10-8 7-8 17-11 2-7-10z",
  "M28 54l9 3 8 12-3 23-7-5-3-17z",
  "M45 20l9-8 17 2 4 9 11 2 9 14-6 10-15-2-8 10-9-8-11-2-5-12z",
  "M54 53l13 3 8 12-5 22-12-3-8-18z",
  "M78 57l8 2 5 7-4 6-10-4z",
];

export function WorldMap({ assignments, compact = false }: WorldMapProps) {
  const grouped = new Map<RegionCode, Omit<AssignmentState, "token">[]>();
  for (const assignment of assignments) {
    const existing = grouped.get(assignment.region) ?? [];
    existing.push(assignment);
    grouped.set(assignment.region, existing);
  }

  return (
    <div className={`world-map ${compact ? "world-map-compact" : ""}`}>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label="Regional generator placement map"
      >
        <defs>
          <radialGradient id="mapGlow">
            <stop offset="0" stopColor="currentColor" stopOpacity=".35" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <pattern
            id="mapGrid"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 5 0 L 0 0 0 5"
              fill="none"
              className="map-grid-line"
              strokeWidth=".15"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" rx="4" fill="url(#mapGrid)" />
        <g className="map-land">
          {land.map((path) => (
            <path d={path} key={path} />
          ))}
        </g>
        {[...grouped.entries()].map(([code, items]) => {
          const region = REGIONS[code];
          const active = items.some((item) =>
            ["ready", "running"].includes(item.status),
          );
          const failed = items.some((item) => item.status === "error");
          const status = failed ? "error" : active ? "active" : "complete";
          return (
            <g
              key={code}
              className={`region-node region-${status}`}
              transform={`translate(${region.mapX} ${region.mapY})`}
            >
              {active && <circle r="6" className="region-pulse" />}
              <circle r="2.3" className="region-dot" />
              <circle r="1" className="region-core" />
              {!compact && (
                <text y="6" textAnchor="middle">
                  {code}
                </text>
              )}
            </g>
          );
        })}
        {!compact && (
          <g className="map-control" transform="translate(49 48)">
            <circle r="3.8" />
            <path d="M-1.6 0h3.2M0-1.6v3.2" />
            <text y="7" textAnchor="middle">
              CONTROL
            </text>
          </g>
        )}
      </svg>
      <div className="map-legend">
        <span>
          <i className="legend-dot legend-active" /> Running
        </span>
        <span>
          <i className="legend-dot legend-complete" /> Ready / complete
        </span>
        <span className="map-attribution">Cloudflare regional placement</span>
      </div>
    </div>
  );
}
