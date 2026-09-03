import type { Icon } from "@phosphor-icons/react";

export function MetricCard({
  label,
  value,
  detail,
  icon: IconComponent,
  tone = "orange",
}: {
  label: string;
  value: string;
  detail: string;
  icon: Icon;
  tone?: "orange" | "purple" | "green" | "blue";
}) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-icon">
        <IconComponent weight="duotone" />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
