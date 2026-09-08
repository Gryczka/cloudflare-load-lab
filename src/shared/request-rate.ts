export const REQUEST_RATE_FRESHNESS_MS = 3_500;

export function normalizeBatchRequestRate(
  requests: number,
  currentBatchAt: string,
  previousBatchAt?: string,
): number {
  if (!Number.isFinite(requests) || requests <= 0) return 0;
  if (!previousBatchAt) return Math.round(requests);
  const elapsedSeconds =
    (new Date(currentBatchAt).getTime() - new Date(previousBatchAt).getTime()) /
    1_000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0)
    return Math.round(requests);
  return Math.round(requests / Math.max(0.25, elapsedSeconds));
}

export function visibleRequestRate(
  status: string,
  requestRate: number | undefined,
  requestRateAt: string | undefined,
  now = Date.now(),
): number {
  if (
    status !== "running" ||
    !requestRateAt ||
    typeof requestRate !== "number" ||
    !Number.isFinite(requestRate)
  )
    return 0;
  const age = now - new Date(requestRateAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age > REQUEST_RATE_FRESHNESS_MS)
    return 0;
  return Math.max(0, requestRate);
}
