import type { CSSProperties } from "react";
import type { GlobeMarker } from "./globe-model";

type TrafficProperties = CSSProperties & {
  "--traffic-pulse-duration": string;
  "--traffic-pulse-scale": string;
  "--traffic-pulse-opacity": string;
  "--traffic-glow-size": string;
};

export function trafficAnimationStyle(
  marker: Pick<GlobeMarker, "trafficIntensity">,
): TrafficProperties {
  const intensity = marker.trafficIntensity;
  return {
    "--traffic-pulse-duration": `${(2.15 - intensity * 1.35).toFixed(2)}s`,
    "--traffic-pulse-scale": (1.8 + intensity * 2.2).toFixed(2),
    "--traffic-pulse-opacity": (0.28 + intensity * 0.58).toFixed(2),
    "--traffic-glow-size": `${(4 + intensity * 12).toFixed(1)}px`,
  };
}

export function formatRequestRate(requestRate: number): string {
  if (requestRate >= 1_000) {
    return `${(requestRate / 1_000).toFixed(requestRate >= 10_000 ? 0 : 1)}k/s`;
  }
  return `${requestRate}/s`;
}
