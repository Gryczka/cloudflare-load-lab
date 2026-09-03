import { TimeseriesChart } from "@cloudflare/kumo/components/chart";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { TimeSeriesPoint } from "../../shared/api";

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);

export function RunCharts({
  points,
  p95Threshold,
}: {
  points: TimeSeriesPoint[];
  p95Threshold: number;
}) {
  const isDark = document.documentElement.dataset.mode === "dark";
  const requests: [number, number][] = points.map((point) => [
    new Date(point.timestamp).getTime(),
    point.requests,
  ]);
  const failures: [number, number][] = points.map((point) => [
    new Date(point.timestamp).getTime(),
    point.failedRequests,
  ]);
  const latency: [number, number][] = points.map((point) => [
    new Date(point.timestamp).getTime(),
    point.p95Ms,
  ]);

  return (
    <div className="charts-grid">
      <div className="chart-card">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">THROUGHPUT</span>
            <h3>Requests per second</h3>
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: "#f48120" }} /> Requests
            </span>
            <span>
              <i style={{ background: "#d9485f" }} /> Failed
            </span>
          </div>
        </div>
        <TimeseriesChart
          echarts={echarts}
          height={235}
          isDarkMode={isDark}
          gradient
          data={[
            { name: "Requests", color: "#f48120", data: requests },
            { name: "Failed", color: "#d9485f", data: failures },
          ]}
          yAxisName="req/s"
          yAxisTickCount={4}
          xAxisTickCount={5}
          ariaDescription="Time-series chart of completed and failed requests per second."
        />
      </div>
      <div className="chart-card">
        <div className="chart-heading">
          <div>
            <span className="eyebrow">TAIL LATENCY</span>
            <h3>p95 response time</h3>
          </div>
          <span className="threshold-label">SLO &lt; {p95Threshold} ms</span>
        </div>
        <TimeseriesChart
          echarts={echarts}
          height={235}
          isDarkMode={isDark}
          gradient
          data={[{ name: "p95 latency", color: "#7b61ff", data: latency }]}
          thresholds={[
            { value: p95Threshold, label: "Threshold", color: "#d9485f" },
          ]}
          yAxisName="ms"
          yAxisTickCount={4}
          xAxisTickCount={5}
          tooltipValueFormat={(value) => `${Math.round(value)} ms`}
          ariaDescription={`Time-series chart of p95 latency with a ${p95Threshold} millisecond threshold.`}
        />
      </div>
      <details className="chart-data-table">
        <summary>View chart data as a table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Requests/s</th>
                <th scope="col">Failed/s</th>
                <th scope="col">p95 latency</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.timestamp}>
                  <td>{new Date(point.timestamp).toLocaleTimeString()}</td>
                  <td>{point.requests}</td>
                  <td>{point.failedRequests}</td>
                  <td>{point.p95Ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
