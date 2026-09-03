import { Badge } from "@cloudflare/kumo";
import {
  CheckCircleIcon,
  CircleNotchIcon,
  PauseCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { RunStatus } from "../../shared/types";

const statusStyle: Record<
  RunStatus,
  {
    variant: "neutral" | "blue" | "green" | "red" | "orange";
    icon: typeof CheckCircleIcon;
  }
> = {
  queued: { variant: "neutral", icon: PauseCircleIcon },
  starting: { variant: "blue", icon: CircleNotchIcon },
  running: { variant: "orange", icon: CircleNotchIcon },
  stopping: { variant: "neutral", icon: CircleNotchIcon },
  passed: { variant: "green", icon: CheckCircleIcon },
  failed: { variant: "red", icon: XCircleIcon },
  cancelled: { variant: "neutral", icon: PauseCircleIcon },
  error: { variant: "red", icon: WarningCircleIcon },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const style = statusStyle[status];
  return (
    <Badge variant={style.variant} appearance="dot">
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}
