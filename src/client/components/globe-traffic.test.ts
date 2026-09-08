import { describe, expect, it } from "vitest";
import { formatRequestRate, trafficAnimationStyle } from "./globe-traffic";

describe("trafficAnimationStyle", () => {
  it("makes higher request rates pulse faster, farther, and brighter", () => {
    const low = trafficAnimationStyle({ trafficIntensity: 0.15 });
    const high = trafficAnimationStyle({ trafficIntensity: 0.85 });

    expect(parseFloat(high["--traffic-pulse-duration"])).toBeLessThan(
      parseFloat(low["--traffic-pulse-duration"]),
    );
    expect(parseFloat(high["--traffic-pulse-scale"])).toBeGreaterThan(
      parseFloat(low["--traffic-pulse-scale"]),
    );
    expect(parseFloat(high["--traffic-pulse-opacity"])).toBeGreaterThan(
      parseFloat(low["--traffic-pulse-opacity"]),
    );
  });

  it("formats compact request-rate labels", () => {
    expect(formatRequestRate(82)).toBe("82/s");
    expect(formatRequestRate(2_400)).toBe("2.4k/s");
  });
});
