import { lazy, Suspense, useCallback, useId, useMemo, useState } from "react";
import {
  createGlobeMarkers,
  describeGlobeMarkers,
  type MapAssignment,
} from "./globe-model";

interface WorldMapProps {
  assignments: MapAssignment[];
  compact?: boolean;
}

const InteractiveGlobe = lazy(() =>
  import("./InteractiveGlobe").then((module) => ({
    default: module.InteractiveGlobe,
  })),
);

export function WorldMap({ assignments, compact = false }: WorldMapProps) {
  const id = useId().replaceAll(":", "");
  const titleId = `globe-title-${id}`;
  const descriptionId = `globe-description-${id}`;
  const glowId = `globe-node-glow-${id}`;
  const markers = useMemo(() => createGlobeMarkers(assignments), [assignments]);
  const description = useMemo(() => describeGlobeMarkers(markers), [markers]);
  const [interactiveReady, setInteractiveReady] = useState(false);
  const [interactiveUnsupported, setInteractiveUnsupported] = useState(false);
  const markReady = useCallback(() => setInteractiveReady(true), []);
  const markUnsupported = useCallback(() => {
    setInteractiveReady(false);
    setInteractiveUnsupported(true);
  }, []);

  return (
    <div className={`world-map ${compact ? "world-map-compact" : ""}`}>
      <div
        className={`globe-stage ${interactiveReady ? "globe-interactive-ready" : ""}`}
      >
        <svg
          className="static-globe-layer"
          viewBox="0 0 100 57.11"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          aria-hidden={interactiveReady || undefined}
        >
          <title id={titleId}>Regional generator placement globe</title>
          <desc id={descriptionId}>{description}</desc>
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0" stopColor="currentColor" stopOpacity=".42" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          {markers.map((marker) => (
            <g
              key={marker.id}
              className={`region-node region-${marker.status}`}
              transform={`translate(${marker.fallbackX} ${marker.fallbackY})`}
            >
              <title>
                {marker.label}: {marker.count} generator
                {marker.count === 1 ? "" : "s"}
                {marker.locations.length > 0
                  ? `; actual location ${marker.locations.join(", ")}`
                  : ""}
              </title>
              {marker.status === "active" && (
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
                  {marker.displayCode}
                </text>
              )}
            </g>
          ))}
        </svg>
        {!interactiveUnsupported && (
          <Suspense fallback={null}>
            <InteractiveGlobe
              markers={markers}
              description={description}
              compact={compact}
              onReady={markReady}
              onUnsupported={markUnsupported}
            />
          </Suspense>
        )}
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
          Cloudflare globe style ↗
        </a>
      </div>
    </div>
  );
}
