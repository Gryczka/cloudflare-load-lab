import { Tabs } from "@cloudflare/kumo";
import {
  Chart,
  TimeseriesChart,
  type KumoChartOption,
  type TimeseriesData,
} from "@cloudflare/kumo/components/chart";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  BrushComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useState } from "react";
import type { RunSnapshot, TimeSeriesPoint } from "../../shared/api";
import {
  bucketRateSeries,
  cumulativeErrorBudget,
  latencyDistribution,
  plannedTargetAt,
  summarizeRun,
} from "../lib/run-analytics";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  BrushComponent,
  ToolboxComponent,
  LegendComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);

type AnalyticsTab = "performance" | "reliability" | "resources";

const colors = {
  orange: "#f48120",
  red: "#d9485f",
  purple: "#7b61ff",
  blue: "#086fff",
  green: "#1f9d72",
  cyan: "#0891b2",
  slate: "#667085",
};

export function RunCharts({
  run,
  detailed = false,
}: {
  run: RunSnapshot;
  detailed?: boolean;
}) {
  const [tab, setTab] = useState<AnalyticsTab>("performance");
  const [isDark, setIsDark] = useState(
    () => document.documentElement.dataset.mode === "dark",
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDark(root.dataset.mode === "dark");
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  const points = run.timeSeries;
  const timeOrigin = Date.parse(
    run.startedAt ?? points[0]?.timestamp ?? run.createdAt,
  );
  const target = pointSeries(points, (point) =>
    plannedTargetAt(
      run.config,
      Math.max(0, (Date.parse(point.timestamp) - timeOrigin) / 1_000),
    ),
  );
  const actualLoad =
    run.config.profile.mode === "arrival-rate"
      ? bucketRateSeries(
          points,
          (point) => point.iterations ?? point.requests,
          (point) => point.iterationsPerSecond,
        )
      : pointSeries(points, (point) => point.vus);
  const requests = bucketRateSeries(
    points,
    (point) => point.requests,
    (point) => point.requestsPerSecond,
  );
  const failures = bucketRateSeries(
    points,
    (point) => point.failedRequests,
    (point) => point.failedRequestsPerSecond,
  );
  const p95 = latencyPointSeries(points, (point) => point.p95Ms);
  const latencyThreshold = pointSeries(
    points,
    () => run.config.thresholds.p95Ms,
  );

  if (!detailed) {
    return (
      <>
        <div className="charts-grid">
          <TimeseriesPanel
            eyebrow="THROUGHPUT"
            title="Requests per second"
            data={[
              { name: "Requests", color: colors.orange, data: requests },
              { name: "Failed", color: colors.red, data: failures },
            ]}
            yAxisName="req/s"
            tooltipValueFormat={(value) => `${Math.round(value)} req/s`}
            isDark={isDark}
            timeOrigin={timeOrigin}
            ariaDescription="Time-series chart of completed and failed requests per second."
          />
          <TimeseriesPanel
            eyebrow="TAIL LATENCY"
            title="p95 response time"
            badge={`SLO < ${run.config.thresholds.p95Ms} ms`}
            data={[
              { name: "p95 latency", color: colors.purple, data: p95 },
              { name: "Threshold", color: colors.red, data: latencyThreshold },
            ]}
            yAxisName="ms"
            tooltipValueFormat={(value) => `${Math.round(value)} ms`}
            isDark={isDark}
            timeOrigin={timeOrigin}
            ariaDescription={`Time-series chart of p95 latency with a ${run.config.thresholds.p95Ms} millisecond threshold.`}
          />
        </div>
        <SeriesTable
          run={run}
          target={target}
          actualLoad={actualLoad}
          requestRate={requests}
          failureRate={failures}
        />
      </>
    );
  }

  const summary = summarizeRun(run);
  const p50 = latencyPointSeries(points, (point) => point.p50Ms ?? point.p95Ms);
  const p90 = latencyPointSeries(points, (point) => point.p90Ms ?? point.p95Ms);
  const p99 = latencyPointSeries(points, (point) => point.p99Ms ?? point.p95Ms);
  const vus = pointSeries(points, (point) => point.vus);
  const vusMax = pointSeries(points, (point) => point.vusMax ?? point.vus);
  const requestFailureRate = pointSeries(points, (point) =>
    percentage(
      point.failedRequestsPerSecond ?? point.failedRequests,
      point.requestsPerSecond ?? point.requests,
    ),
  );
  const checkFailureRate = pointSeries(points, (point) =>
    percentage(
      point.failedChecksPerSecond ?? point.failedChecks ?? 0,
      point.checksPerSecond ?? point.checks ?? 0,
    ),
  );
  const dropRate = pointSeries(points, (point) =>
    percentage(
      point.droppedIterationsPerSecond ?? point.droppedIterations ?? 0,
      (point.iterationsPerSecond ?? point.iterations ?? point.requests) +
        (point.droppedIterationsPerSecond ?? point.droppedIterations ?? 0),
    ),
  );
  const errorThreshold = pointSeries(
    points,
    () => run.config.thresholds.errorRate * 100,
  );
  const latencyBudget = latencyPointSeries(
    points,
    (point) => (point.p95Ms / run.config.thresholds.p95Ms) * 100,
  );
  const errorBudget = cumulativeErrorBudget(run);
  const budgetLimit = pointSeries(points, () => 100);
  const sent = bucketRateSeries(
    points,
    (point) => (point.dataSent ?? 0) / 1_024,
    (point) =>
      point.dataSentPerSecond === undefined
        ? undefined
        : point.dataSentPerSecond / 1_024,
  );
  const received = bucketRateSeries(
    points,
    (point) => (point.dataReceived ?? 0) / 1_024,
    (point) =>
      point.dataReceivedPerSecond === undefined
        ? undefined
        : point.dataReceivedPerSecond / 1_024,
  );
  const distribution = latencyDistribution(run);
  const chartText = isDark ? "#aeb8c7" : "#596579";
  const chartGrid = isDark ? "rgba(255,255,255,0.1)" : "rgba(20,27,45,0.1)";
  const histogramOptions: KumoChartOption = {
    animationDuration: 350,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      description: "Distribution of HTTP requests across latency buckets.",
    },
    grid: { top: 24, right: 18, bottom: 72, left: 58 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: distribution.map((bucket) => bucket.label),
      axisLabel: { color: chartText, interval: 0, rotate: 38, fontSize: 9 },
      axisLine: { lineStyle: { color: chartGrid } },
    },
    yAxis: {
      type: "value",
      name: "requests",
      nameTextStyle: { color: chartText },
      axisLabel: { color: chartText },
      splitLine: { lineStyle: { color: chartGrid } },
    },
    series: [
      {
        name: "Requests",
        type: "bar",
        data: distribution.map((bucket) => bucket.count),
        itemStyle: { color: colors.purple, borderRadius: [4, 4, 0, 0] },
      },
    ],
  };
  const saturationOptions: KumoChartOption = {
    animationDuration: 350,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      description:
        "Scatter plot correlating requests per second with p95 response latency.",
    },
    grid: { top: 24, right: 22, bottom: 48, left: 60 },
    tooltip: { trigger: "item" },
    xAxis: {
      type: "value",
      name: "requests/s",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: chartText },
      axisLabel: { color: chartText },
      splitLine: { lineStyle: { color: chartGrid } },
    },
    yAxis: {
      type: "value",
      name: "p95 ms",
      nameTextStyle: { color: chartText },
      axisLabel: { color: chartText },
      splitLine: { lineStyle: { color: chartGrid } },
    },
    series: [
      {
        name: "Second",
        type: "scatter",
        symbolSize: 9,
        data: points.flatMap((point, index) =>
          point.latencySamples === 0 || point.latencyAligned === false
            ? []
            : [
                {
                  value: [requests[index]?.[1] ?? 0, point.p95Ms],
                  itemStyle: {
                    color:
                      point.failedRequests > 0 ||
                      point.p95Ms >= run.config.thresholds.p95Ms
                        ? colors.red
                        : colors.purple,
                  },
                },
              ],
        ),
        markLine: {
          symbol: "none",
          lineStyle: { color: colors.red, type: "dashed" },
          label: { formatter: "p95 limit", color: colors.red },
          data: [{ yAxis: run.config.thresholds.p95Ms }],
        },
      },
    ],
  };

  const loadUnit =
    run.config.profile.mode === "arrival-rate" ? "iter/s" : "VUs";
  const targetLabel =
    run.config.profile.mode === "arrival-rate"
      ? "Target iterations"
      : "Target VUs";
  const actualLabel =
    run.config.profile.mode === "arrival-rate"
      ? "Completed iterations"
      : "Active VUs";
  const hasRequests = run.totals.requests > 0;
  const hasChecks = run.totals.checks > 0;
  const hasLatency = run.totals.latency.count > 0;
  const hasIterations =
    run.totals.iterations + run.totals.droppedIterations > 0;
  const stats = [
    {
      label: "Average throughput",
      value: `${formatNumber(summary.averageRps, 1)} req/s`,
      detail: `${formatNumber(summary.peakRps)} req/s peak`,
      tone: hasRequests ? "orange" : "slate",
    },
    {
      label: "Request success",
      value: hasRequests ? formatPercent(summary.successRate) : "N/A",
      detail: hasRequests
        ? `${run.totals.failedRequests.toLocaleString()} failed`
        : "No requests received",
      tone: !hasRequests
        ? "slate"
        : run.thresholds.checks.errors
          ? "green"
          : "red",
    },
    {
      label: "Check pass rate",
      value: hasChecks ? formatPercent(summary.checkPassRate) : "N/A",
      detail: hasChecks
        ? `${run.totals.failedChecks.toLocaleString()} failed checks`
        : "No checks received",
      tone: !hasChecks
        ? "slate"
        : run.totals.failedChecks === 0
          ? "green"
          : "red",
    },
    {
      label: "Average latency",
      value: hasLatency
        ? `${formatNumber(summary.averageLatencyMs, 1)} ms`
        : "N/A",
      detail: hasLatency
        ? `${formatPercent(summary.latencyCoverage)} sample coverage`
        : "No latency samples",
      tone: hasLatency ? "blue" : "slate",
    },
    {
      label: "Median latency",
      value: hasLatency ? `${formatNumber(summary.p50Ms)} ms` : "N/A",
      detail: hasLatency
        ? `p75 ${formatNumber(summary.p75Ms)} ms`
        : "No latency samples",
      tone: hasLatency ? "blue" : "slate",
    },
    {
      label: "Tail latency",
      value: hasLatency ? `p95 ${formatNumber(summary.p95Ms)} ms` : "N/A",
      detail: hasLatency
        ? `p99 ${formatNumber(summary.p99Ms)} ms, ${formatNumber(summary.maxLatencyMs)} ms max`
        : "No latency samples",
      tone: !hasLatency
        ? "slate"
        : run.thresholds.checks.latency
          ? "green"
          : "red",
    },
    {
      label: "Execution pressure",
      value: `${run.totals.vusMax.toLocaleString()} max VUs`,
      detail: hasIterations
        ? `${formatPercent(summary.dropRate)} iterations dropped`
        : "No iterations received",
      tone: !hasIterations
        ? "slate"
        : summary.dropRate === 0
          ? "green"
          : "orange",
    },
    {
      label: "Network transfer",
      value: formatBytes(summary.transferredBytes),
      detail: `${formatBytes(summary.averageBytesPerSecond)}/s average`,
      tone: "purple",
    },
  ];

  return (
    <section className="analytics-shell" aria-labelledby="analytics-title">
      <div className="analytics-heading">
        <div>
          <span className="eyebrow">COMPLETED ANALYSIS</span>
          <h2 id="analytics-title">Performance report</h2>
          <p>
            Inspect delivered load, latency behavior, reliability, and generator
            pressure across the captured run.
          </p>
        </div>
        <div className="analytics-meta" aria-label="Report coverage">
          <span>{formatDuration(summary.durationSeconds)} duration</span>
          <span>{summary.retainedBuckets} one-second buckets retained</span>
        </div>
      </div>

      <div className="analytics-summary-grid">
        {stats.map((stat) => (
          <ResultStat key={stat.label} {...stat} />
        ))}
      </div>

      <div className="analytics-tabs">
        <Tabs
          value={tab}
          activateOnFocus
          onValueChange={(value) => setTab(value as AnalyticsTab)}
          tabs={[
            {
              value: "performance",
              label: "Performance",
              render: (
                <button
                  type="button"
                  id="analytics-tab-performance"
                  aria-controls="analytics-panel"
                />
              ),
            },
            {
              value: "reliability",
              label: "Reliability",
              render: (
                <button
                  type="button"
                  id="analytics-tab-reliability"
                  aria-controls="analytics-panel"
                />
              ),
            },
            {
              value: "resources",
              label: "Resources",
              render: (
                <button
                  type="button"
                  id="analytics-tab-resources"
                  aria-controls="analytics-panel"
                />
              ),
            },
          ]}
        />
      </div>

      {points.length === 0 ? (
        <div
          className="analytics-empty"
          role="tabpanel"
          id="analytics-panel"
          aria-labelledby={`analytics-tab-${tab}`}
        >
          No per-second samples were received for this run.
        </div>
      ) : (
        <div
          className="charts-grid analytics-charts"
          role="tabpanel"
          id="analytics-panel"
          aria-labelledby={`analytics-tab-${tab}`}
        >
          {tab === "performance" && (
            <>
              <TimeseriesPanel
                eyebrow="LOAD DELIVERY"
                title="Target versus achieved"
                badge={loadUnit}
                data={[
                  { name: targetLabel, color: colors.slate, data: target },
                  { name: actualLabel, color: colors.orange, data: actualLoad },
                ]}
                yAxisName={loadUnit}
                tooltipValueFormat={(value) =>
                  `${formatNumber(value, 1)} ${loadUnit}`
                }
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription={`Time-series comparison of configured ${targetLabel.toLowerCase()} and ${actualLabel.toLowerCase()}.`}
              />
              <TimeseriesPanel
                eyebrow="HTTP TRAFFIC"
                title="Requests per second"
                data={[
                  { name: "Requests", color: colors.orange, data: requests },
                  { name: "Failed", color: colors.red, data: failures },
                ]}
                yAxisName="req/s"
                tooltipValueFormat={(value) => `${Math.round(value)} req/s`}
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart of completed and failed HTTP requests per second."
              />
              <TimeseriesPanel
                eyebrow="LATENCY ENVELOPE"
                title="Response-time percentiles"
                badge={`SLO < ${run.config.thresholds.p95Ms} ms`}
                data={[
                  { name: "p50", color: colors.green, data: p50 },
                  { name: "p90", color: colors.blue, data: p90 },
                  { name: "p95", color: colors.purple, data: p95 },
                  { name: "p99", color: colors.orange, data: p99 },
                  {
                    name: "Threshold",
                    color: colors.red,
                    data: latencyThreshold,
                  },
                ]}
                yAxisName="ms"
                tooltipValueFormat={(value) => `${Math.round(value)} ms`}
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart comparing p50, p90, p95, and p99 response latency with the configured threshold."
              />
              <ChartPanel
                eyebrow="SATURATION CURVE"
                title="Where latency begins to bend"
                badge="RPS x p95"
                options={saturationOptions}
                isDark={isDark}
              />
            </>
          )}

          {tab === "reliability" && (
            <>
              <TimeseriesPanel
                eyebrow="FAILURE SIGNALS"
                title="Errors, checks, and dropped work"
                badge={`SLO < ${formatPercent(run.config.thresholds.errorRate)}`}
                data={[
                  {
                    name: "Request failures",
                    color: colors.red,
                    data: requestFailureRate,
                  },
                  {
                    name: "Check failures",
                    color: colors.orange,
                    data: checkFailureRate,
                  },
                  { name: "Dropped", color: colors.purple, data: dropRate },
                  {
                    name: "Request error SLO",
                    color: colors.slate,
                    data: errorThreshold,
                  },
                ]}
                yAxisName="%"
                yAxisTickFormat={(value) => `${formatNumber(value, 1)}%`}
                tooltipValueFormat={(value) => `${formatNumber(value, 2)}%`}
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart of request failures, failed checks, and dropped iteration percentages. The configured threshold applies to request failures."
              />
              <TimeseriesPanel
                eyebrow="SLO CONSUMPTION"
                title="Threshold budget used"
                badge="100% = limit"
                data={[
                  {
                    name: "Latency budget",
                    color: colors.purple,
                    data: latencyBudget,
                  },
                  {
                    name: "Cumulative error budget",
                    color: colors.red,
                    data: errorBudget,
                  },
                  {
                    name: "Budget limit",
                    color: colors.slate,
                    data: budgetLimit,
                  },
                ]}
                yAxisName="% used"
                yAxisTickFormat={(value) => `${formatNumber(value)}%`}
                tooltipValueFormat={(value) => `${formatNumber(value, 1)}%`}
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart showing latency and error threshold consumption, where 100 percent is the configured limit."
              />
              <ErrorBreakdown run={run} />
              <SignalIntegrity run={run} summary={summary} />
            </>
          )}

          {tab === "resources" && (
            <>
              <TimeseriesPanel
                eyebrow="GENERATOR PRESSURE"
                title="Virtual-user utilization"
                data={[
                  { name: "Active VUs", color: colors.orange, data: vus },
                  { name: "Maximum VUs", color: colors.blue, data: vusMax },
                ]}
                yAxisName="VUs"
                tooltipValueFormat={(value) => `${formatNumber(value)} VUs`}
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart of active and maximum virtual users."
              />
              <TimeseriesPanel
                eyebrow="NETWORK THROUGHPUT"
                title="Payload volume per second"
                data={[
                  { name: "Received", color: colors.cyan, data: received },
                  { name: "Sent", color: colors.purple, data: sent },
                ]}
                yAxisName="KiB/s"
                yAxisTickFormat={(value) => formatNumber(value, 1)}
                tooltipValueFormat={(value) =>
                  `${formatNumber(value, 1)} KiB/s`
                }
                isDark={isDark}
                timeOrigin={timeOrigin}
                ariaDescription="Time-series chart of bytes sent and received per second."
              />
              <ChartPanel
                eyebrow="LATENCY DISTRIBUTION"
                title="Requests by response-time bucket"
                badge={`${run.totals.latency.count.toLocaleString()} samples`}
                options={histogramOptions}
                isDark={isDark}
              />
              <RunAccounting run={run} summary={summary} />
              <LatencyDistributionTable distribution={distribution} />
            </>
          )}
        </div>
      )}

      <SeriesTable
        run={run}
        target={target}
        actualLoad={actualLoad}
        requestRate={requests}
        failureRate={failures}
        sentRate={sent}
        receivedRate={received}
      />
    </section>
  );
}

function TimeseriesPanel({
  eyebrow,
  title,
  badge,
  data,
  yAxisName,
  yAxisTickFormat,
  tooltipValueFormat,
  isDark,
  timeOrigin,
  ariaDescription,
}: {
  eyebrow: string;
  title: string;
  badge?: string;
  data: TimeseriesData[];
  yAxisName: string;
  yAxisTickFormat?: (value: number) => string;
  tooltipValueFormat: (value: number) => string;
  isDark: boolean;
  timeOrigin: number;
  ariaDescription: string;
}) {
  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        {badge ? (
          <span className="threshold-label">{badge}</span>
        ) : (
          <ChartKey data={data} />
        )}
      </div>
      {badge && <ChartKey data={data} />}
      <TimeseriesChart
        echarts={echarts}
        height={248}
        isDarkMode={isDark}
        gradient={data.length <= 2}
        data={data}
        yAxisName={yAxisName}
        yAxisTickCount={4}
        yAxisTickFormat={yAxisTickFormat}
        xAxisTickCount={5}
        xAxisTickFormat={(value) =>
          formatChartElapsed((value - timeOrigin) / 1_000)
        }
        tooltipValueFormat={tooltipValueFormat}
        ariaDescription={ariaDescription}
      />
    </div>
  );
}

function ChartPanel({
  eyebrow,
  title,
  badge,
  options,
  isDark,
}: {
  eyebrow: string;
  title: string;
  badge: string;
  options: KumoChartOption;
  isDark: boolean;
}) {
  return (
    <div className="chart-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <span className="threshold-label">{badge}</span>
      </div>
      <Chart
        echarts={echarts}
        height={278}
        isDarkMode={isDark}
        options={options}
      />
    </div>
  );
}

function ChartKey({ data }: { data: TimeseriesData[] }) {
  return (
    <div className="chart-legend">
      {data.map((series) => (
        <span key={series.name}>
          <i aria-hidden="true" style={{ background: series.color }} />{" "}
          {series.name}
        </span>
      ))}
    </div>
  );
}

function ResultStat({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <div className={`result-stat result-stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ErrorBreakdown({ run }: { run: RunSnapshot }) {
  const errors = Object.entries(run.totals.errors)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 8);
  const maximum = Math.max(1, ...errors.map(([, count]) => count));

  return (
    <div className="chart-card diagnostic-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">ERROR PROFILE</span>
          <h3>Top failure signatures</h3>
        </div>
        <span className="threshold-label">
          {run.totals.failedRequests.toLocaleString()} total
        </span>
      </div>
      {errors.length === 0 ? (
        <div className="diagnostic-empty">
          <strong>
            {run.totals.failedRequests === 0
              ? "No request failures recorded"
              : "No failure signatures captured"}
          </strong>
          <span>
            {run.totals.failedRequests === 0
              ? "Every captured HTTP request completed successfully."
              : `${run.totals.failedRequests.toLocaleString()} failed ${run.totals.failedRequests === 1 ? "request was" : "requests were"} reported without an error label.`}
          </span>
        </div>
      ) : (
        <div className="error-breakdown-list">
          {errors.map(([message, count]) => (
            <div className="error-breakdown-row" key={message}>
              <div>
                <span>{message}</span>
                <strong>{count.toLocaleString()}</strong>
              </div>
              <i>
                <b style={{ width: `${(count / maximum) * 100}%` }} />
              </i>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SignalIntegrity({
  run,
  summary,
}: {
  run: RunSnapshot;
  summary: ReturnType<typeof summarizeRun>;
}) {
  const completedAssignments = run.assignments.filter(
    (assignment) => assignment.status === "complete",
  ).length;
  const diagnosticsAvailable = run.assignments.every(
    (assignment) =>
      assignment.acceptedBatches !== undefined &&
      assignment.missingSequences !== undefined,
  );
  const acceptedBatches = diagnosticsAvailable
    ? run.assignments.reduce(
        (sum, assignment) => sum + (assignment.acceptedBatches ?? 0),
        0,
      )
    : undefined;
  const missingSequences = diagnosticsAvailable
    ? run.assignments.reduce(
        (sum, assignment) => sum + (assignment.missingSequences ?? 0),
        0,
      )
    : undefined;
  const configuredDuration = run.config.profile.stages.reduce(
    (sum, stage) => sum + stage.durationSeconds,
    0,
  );

  return (
    <div className="chart-card diagnostic-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">SIGNAL INTEGRITY</span>
          <h3>Report coverage</h3>
        </div>
        <span className="threshold-label">
          {missingSequences === undefined
            ? "gap tracking unavailable"
            : missingSequences === 0
              ? "no detected internal gaps"
              : `${missingSequences} missing`}
        </span>
      </div>
      <div className="accounting-grid">
        <AccountingLine
          label="Latency samples"
          value={`${formatPercent(summary.latencyCoverage)} coverage`}
        />
        <AccountingLine
          label="Retained buckets"
          value={`${summary.retainedBuckets} of ${configuredDuration} scheduled seconds`}
        />
        <AccountingLine
          label="Completed shards"
          value={`${completedAssignments} / ${run.assignments.length}`}
        />
        <AccountingLine
          label="Accepted batches"
          value={acceptedBatches?.toLocaleString() ?? "Unavailable"}
        />
        <AccountingLine
          label="Missing sequences"
          value={missingSequences?.toLocaleString() ?? "Unavailable"}
        />
      </div>
    </div>
  );
}

function RunAccounting({
  run,
  summary,
}: {
  run: RunSnapshot;
  summary: ReturnType<typeof summarizeRun>;
}) {
  return (
    <div className="chart-card diagnostic-card">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">RUN ACCOUNTING</span>
          <h3>Execution totals</h3>
        </div>
        <span className="threshold-label">
          {formatDuration(summary.durationSeconds)}
        </span>
      </div>
      <div className="accounting-grid">
        <AccountingLine
          label="HTTP requests"
          value={run.totals.requests.toLocaleString()}
        />
        <AccountingLine
          label="Iterations"
          value={run.totals.iterations.toLocaleString()}
        />
        <AccountingLine
          label="Checks"
          value={run.totals.checks.toLocaleString()}
        />
        <AccountingLine
          label="Dropped iterations"
          value={run.totals.droppedIterations.toLocaleString()}
        />
        <AccountingLine
          label="Data received"
          value={formatBytes(run.totals.dataReceived)}
        />
        <AccountingLine
          label="Data sent"
          value={formatBytes(run.totals.dataSent)}
        />
      </div>
    </div>
  );
}

function AccountingLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LatencyDistributionTable({
  distribution,
}: {
  distribution: ReturnType<typeof latencyDistribution>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <details
      className="chart-data-table"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>View latency distribution as a table</summary>
      {expanded && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Latency range</th>
                <th scope="col">Requests</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {distribution.map((bucket) => (
                <tr key={bucket.label}>
                  <td>{bucket.label}</td>
                  <td>{bucket.count.toLocaleString()}</td>
                  <td>{formatNumber(bucket.percentage, 2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function SeriesTable({
  run,
  target,
  actualLoad,
  requestRate,
  failureRate,
  sentRate,
  receivedRate,
}: {
  run: RunSnapshot;
  target: [number, number][];
  actualLoad: [number, number][];
  requestRate: [number, number][];
  failureRate: [number, number][];
  sentRate?: [number, number][];
  receivedRate?: [number, number][];
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <details
      className="chart-data-table"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>View captured time-series data as a table</summary>
      {expanded && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Target</th>
                <th scope="col">Delivered/s</th>
                <th scope="col">Requests/s</th>
                <th scope="col">Failed/s</th>
                <th scope="col">Checks</th>
                <th scope="col">Failed checks</th>
                <th scope="col">Dropped</th>
                <th scope="col">VUs</th>
                <th scope="col">Max VUs</th>
                <th scope="col">Avg latency</th>
                <th scope="col">Max latency</th>
                <th scope="col">p50</th>
                <th scope="col">p75</th>
                <th scope="col">p90</th>
                <th scope="col">p95</th>
                <th scope="col">p99</th>
                <th scope="col">Sent/s</th>
                <th scope="col">Received/s</th>
              </tr>
            </thead>
            <tbody>
              {run.timeSeries.map((point, index) => (
                <tr key={point.timestamp}>
                  <td>{new Date(point.timestamp).toLocaleTimeString()}</td>
                  <td>{formatNumber(target[index]?.[1] ?? 0, 1)}</td>
                  <td>{formatNumber(actualLoad[index]?.[1] ?? 0, 1)}</td>
                  <td>{formatNumber(requestRate[index]?.[1] ?? 0, 1)}</td>
                  <td>{formatNumber(failureRate[index]?.[1] ?? 0, 1)}</td>
                  <td>{formatOptionalNumber(point.checks)}</td>
                  <td>{formatOptionalNumber(point.failedChecks)}</td>
                  <td>{formatOptionalNumber(point.droppedIterations)}</td>
                  <td>{point.vus}</td>
                  <td>{formatOptionalNumber(point.vusMax)}</td>
                  <td>{formatPointLatency(point, point.averageLatencyMs)}</td>
                  <td>{formatPointLatency(point, point.maxLatencyMs)}</td>
                  <td>{formatPointLatency(point, point.p50Ms)}</td>
                  <td>{formatPointLatency(point, point.p75Ms)}</td>
                  <td>{formatPointLatency(point, point.p90Ms)}</td>
                  <td>{formatPointLatency(point, point.p95Ms)}</td>
                  <td>{formatPointLatency(point, point.p99Ms)}</td>
                  <td>{formatOptionalRate(sentRate?.[index]?.[1], "KiB")}</td>
                  <td>
                    {formatOptionalRate(receivedRate?.[index]?.[1], "KiB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

function pointSeries(
  points: TimeSeriesPoint[],
  value: (point: TimeSeriesPoint) => number,
): [number, number][] {
  return points.map((point) => [
    new Date(point.timestamp).getTime(),
    value(point),
  ]);
}

function latencyPointSeries(
  points: TimeSeriesPoint[],
  value: (point: TimeSeriesPoint) => number,
): [number, number][] {
  return points.flatMap((point) =>
    point.latencySamples === 0 || point.latencyAligned === false
      ? []
      : [[new Date(point.timestamp).getTime(), value(point)]],
  );
}

function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function formatNumber(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    value,
  );
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100, 2)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${formatNumber(bytes)} B`;
  if (bytes < 1_048_576) return `${formatNumber(bytes / 1_024, 1)} KiB`;
  if (bytes < 1_073_741_824) return `${formatNumber(bytes / 1_048_576, 1)} MiB`;
  return `${formatNumber(bytes / 1_073_741_824, 1)} GiB`;
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "N/A" : formatNumber(value, 1);
}

function formatPointLatency(
  point: TimeSeriesPoint,
  value: number | undefined,
): string {
  return point.latencySamples === 0 || value === undefined
    ? "N/A"
    : `${formatNumber(value, 1)} ms`;
}

function formatOptionalRate(value: number | undefined, unit: string): string {
  return value === undefined ? "N/A" : `${formatNumber(value, 1)} ${unit}/s`;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function formatChartElapsed(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m${remainder}s`;
}
