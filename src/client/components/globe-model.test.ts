import { describe, expect, it } from "vitest";
import { DEMO_RUN_CONFIG, REGIONS, type RegionCode } from "../../shared/types";
import { COLO_COORDINATES } from "../data/colo-coordinates";
import {
  createGlobeMarkers,
  requestTrafficIntensity,
  requestTrafficLevel,
  type MapAssignment,
} from "./globe-model";

function assignment(
  id: string,
  region: RegionCode,
  location?: string,
  status: MapAssignment["status"] = "complete",
  requestRate = 0,
): MapAssignment {
  return {
    id,
    region,
    shard: 0,
    weight: 100,
    profile: DEMO_RUN_CONFIG.profile,
    status,
    requestRate,
    placement: location
      ? { requestedRegion: region, location }
      : { requestedRegion: region },
    lastSequence: 0,
  };
}

describe("createGlobeMarkers", () => {
  it("positions reported locations using their geographic coordinates", () => {
    const [marker] = createGlobeMarkers([
      assignment("generator-1", "ENAM", "iad01"),
    ]);

    expect(marker).toMatchObject({
      id: "ENAM:IAD01",
      displayCode: "IAD01",
      latitude: COLO_COORDINATES.IAD?.[0],
      longitude: COLO_COORDINATES.IAD?.[1],
      usesRegionalFallback: false,
    });
  });

  it("groups shards at the same location and keeps the strongest status", () => {
    const [marker] = createGlobeMarkers([
      assignment("generator-1", "WEUR", "AMS", "complete"),
      assignment("generator-2", "WEUR", "AMS", "error"),
    ]);

    expect(marker).toMatchObject({ count: 2, status: "error" });
  });

  it("aggregates shard request rates and selects a rising traffic band", () => {
    const [marker] = createGlobeMarkers([
      assignment("generator-1", "WNAM", "LAX09", "running", 18),
      assignment("generator-2", "WNAM", "LAX09", "running", 34),
    ]);

    expect(marker).toMatchObject({
      requestRate: 52,
      trafficLevel: "high",
      trafficIntensity: requestTrafficIntensity(52),
    });
    expect(requestTrafficLevel(0)).toBe("none");
    expect(requestTrafficLevel(9)).toBe("low");
    expect(requestTrafficLevel(49)).toBe("medium");
    expect(requestTrafficLevel(199)).toBe("high");
    expect(requestTrafficLevel(200)).toBe("surge");
    expect(requestTrafficIntensity(1_023)).toBe(1);
  });

  it("distinguishes actively running generators from ready generators", () => {
    const [running] = createGlobeMarkers([
      assignment("generator-1", "ENAM", "IAD", "running"),
    ]);
    const [ready] = createGlobeMarkers([
      assignment("generator-2", "WEUR", "AMS", "ready"),
    ]);

    expect(running?.status).toBe("active");
    expect(ready?.status).toBe("complete");
  });

  it("uses a declared regional point while placement is unknown", () => {
    const [marker] = createGlobeMarkers([assignment("generator-1", "APAC")]);

    expect(marker).toMatchObject({
      displayCode: "APAC",
      latitude: REGIONS.APAC.globeLatitude,
      longitude: REGIONS.APAC.globeLongitude,
      usesRegionalFallback: false,
    });
  });

  it("marks unknown location codes as regional fallbacks", () => {
    const [marker] = createGlobeMarkers([
      assignment("generator-1", "SAM", "ZZZ"),
    ]);

    expect(marker).toMatchObject({
      displayCode: "ZZZ",
      latitude: REGIONS.SAM.globeLatitude,
      longitude: REGIONS.SAM.globeLongitude,
      usesRegionalFallback: true,
    });
  });
});
