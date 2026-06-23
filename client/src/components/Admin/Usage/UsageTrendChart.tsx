import { useMemo } from 'react';
import type { TAdminUsageTimeseriesPoint } from 'librechat-data-provider';

const WIDTH = 720;
const HEIGHT = 200;
const PAD = 24;

export default function UsageTrendChart({
  points,
  label,
}: {
  points: TAdminUsageTimeseriesPoint[];
  label: string;
}) {
  const polyline = useMemo(() => {
    if (points.length < 1) {
      return '';
    }
    const max = Math.max(...points.map((p) => p.totalTokens), 1);
    const innerW = WIDTH - PAD * 2;
    const innerH = HEIGHT - PAD * 2;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    return points
      .map((p, i) => {
        const x = PAD + step * i;
        const y = PAD + innerH - (p.totalTokens / max) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points]);

  return (
    <div className="rounded-xl border border-border-medium p-4">
      <div className="mb-2 text-sm font-medium text-text-primary">{label}</div>
      {points.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-secondary">—</div>
      ) : (
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-48 w-full"
          preserveAspectRatio="none"
        >
          <polyline
            points={polyline}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-text-primary"
          />
        </svg>
      )}
    </div>
  );
}
