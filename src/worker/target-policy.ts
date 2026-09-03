export function resolveBuiltInTarget(
  targetId: string,
  builtInTargetOrigin: string,
): string | undefined {
  return targetId === "demo" ? builtInTargetOrigin : undefined;
}
