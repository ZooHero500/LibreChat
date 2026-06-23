import { useMemo, useState } from 'react';
import type { TAdminUsageParams } from 'librechat-data-provider';
import { useAdminUsage, useListAdminUsers } from '~/data-provider';
import { useLocalize } from '~/hooks';
import UsageTrendChart from './UsageTrendChart';

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export default function AdminUsageView() {
  const localize = useLocalize();
  const [startDate, setStartDate] = useState(() => isoDaysAgo(30));
  const [endDate, setEndDate] = useState(() => isoDaysAgo(0));
  const [userId, setUserId] = useState('');

  const params: TAdminUsageParams = useMemo(
    () => ({ startDate, endDate, userId: userId || undefined }),
    [startDate, endDate, userId],
  );
  const { data, isLoading, isError } = useAdminUsage(params);
  const { data: usersData } = useListAdminUsers();
  const users = usersData?.users ?? [];

  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <h1 className="mb-1 text-xl font-semibold text-text-primary">
        {localize('com_ui_admin_usage')}
      </h1>
      <p className="mb-4 text-xs text-text-secondary">
        {localize('com_ui_admin_usage_accuracy_note')}
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm text-text-secondary">
          {localize('com_ui_admin_usage_start_date')}
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-md border border-border-medium bg-surface-primary px-2 py-1 text-text-primary"
          />
        </label>
        <label className="flex flex-col text-sm text-text-secondary">
          {localize('com_ui_admin_usage_end_date')}
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-md border border-border-medium bg-surface-primary px-2 py-1 text-text-primary"
          />
        </label>
        <label className="flex flex-col text-sm text-text-secondary">
          {localize('com_ui_admin_usage_user_filter')}
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="rounded-md border border-border-medium bg-surface-primary px-2 py-1 text-text-primary"
          >
            <option value="">{localize('com_ui_admin_usage_all_users')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="rounded-xl border border-border-medium px-4 py-2">
          <div className="text-xs text-text-secondary">{localize('com_ui_admin_usage_grand_total')}</div>
          <div className="text-lg font-semibold text-text-primary">{data?.grandTotal ?? 0}</div>
        </div>
        {(data?.perModelTotals ?? []).map((m) => (
          <div key={m.model} className="rounded-xl border border-border-medium px-4 py-2">
            <div className="text-xs text-text-secondary">{m.model}</div>
            <div className="text-lg font-semibold text-text-primary">{m.totalTokens}</div>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <UsageTrendChart label={localize('com_ui_admin_usage_trend')} points={data?.timeseries ?? []} />
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-text-secondary">…</div>
      ) : isError ? (
        <div className="py-8 text-center text-text-secondary">{localize('com_ui_admin_usage_error')}</div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-text-secondary">{localize('com_ui_admin_usage_empty')}</div>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-medium text-text-secondary">
              <th className="py-2">{localize('com_ui_admin_usage_user_filter')}</th>
              <th className="py-2">{localize('com_ui_admin_usage_model')}</th>
              <th className="py-2 text-right">{localize('com_ui_admin_usage_prompt_tokens')}</th>
              <th className="py-2 text-right">{localize('com_ui_admin_usage_completion_tokens')}</th>
              <th className="py-2 text-right">{localize('com_ui_admin_usage_total_tokens')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.userId}-${r.model}`} className="border-b border-border-light">
                <td className="py-2 text-text-primary">{r.userName || r.userEmail || r.userId}</td>
                <td className="py-2 text-text-primary">{r.model}</td>
                <td className="py-2 text-right text-text-primary">{r.promptTokens}</td>
                <td className="py-2 text-right text-text-primary">{r.completionTokens}</td>
                <td className="py-2 text-right font-medium text-text-primary">{r.totalTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
