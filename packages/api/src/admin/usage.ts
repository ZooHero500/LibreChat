import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  IUser,
  UsageStatsFilter,
  UsageByUserModel,
  UsageTimeseriesPoint,
} from '@librechat/data-schemas';
import type { TAdminUsageResponse, TAdminUsageRow } from 'librechat-data-provider';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const DEFAULT_RANGE_DAYS = 30;
const USER_FIELDS = '_id name email username';

export interface AdminUsageDeps {
  getUsageByUserModel: (filter: UsageStatsFilter) => Promise<UsageByUserModel[]>;
  getUsageTimeseries: (filter: UsageStatsFilter) => Promise<UsageTimeseriesPoint[]>;
  findUsers: (
    criteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
    options?: { limit?: number; offset?: number; sort?: Record<string, 1 | -1> },
  ) => Promise<IUser[]>;
}

interface ParsedRange {
  startDate: Date;
  endDate: Date;
  userId?: string;
}

function parseRange(query: ServerRequest['query']): ParsedRange | { error: string } {
  const rawStart = typeof query.startDate === 'string' ? query.startDate : undefined;
  const rawEnd = typeof query.endDate === 'string' ? query.endDate : undefined;
  const rawUser = typeof query.userId === 'string' ? query.userId : undefined;

  if (rawUser != null && !isValidObjectIdString(rawUser)) {
    return { error: 'Invalid userId format' };
  }

  const endDate = rawEnd ? new Date(rawEnd) : new Date();
  const startDate = rawStart
    ? new Date(rawStart)
    : new Date(endDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return { error: 'Invalid startDate or endDate' };
  }
  if (startDate.getTime() > endDate.getTime()) {
    return { error: 'startDate must be on or before endDate' };
  }
  return { startDate, endDate, userId: rawUser };
}

export function createAdminUsageHandlers(deps: AdminUsageDeps): {
  getUsage: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getUsageByUserModel, getUsageTimeseries, findUsers } = deps;

  async function getUsageHandler(req: ServerRequest, res: Response) {
    try {
      const parsed = parseRange(req.query);
      if ('error' in parsed) {
        return res.status(400).json({ error: parsed.error });
      }
      const filter: UsageStatsFilter = {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        userId: parsed.userId,
      };

      const [usage, timeseries] = await Promise.all([
        getUsageByUserModel(filter),
        getUsageTimeseries(filter),
      ]);

      const userIds = [...new Set(usage.map((u) => u.userId).filter(Boolean))];
      const users = userIds.length
        ? await findUsers({ _id: { $in: userIds } }, USER_FIELDS)
        : [];
      const userMap = new Map(
        users.map((u) => [u._id?.toString() ?? '', { name: u.name ?? '', email: u.email ?? '' }]),
      );

      const modelTotals = new Map<string, number>();
      let grandTotal = 0;
      const rows: TAdminUsageRow[] = usage.map((u) => {
        const totalTokens = u.promptTokens + u.completionTokens;
        grandTotal += totalTokens;
        modelTotals.set(u.model, (modelTotals.get(u.model) ?? 0) + totalTokens);
        const info = userMap.get(u.userId);
        return {
          userId: u.userId,
          userName: info?.name ?? '',
          userEmail: info?.email ?? '',
          model: u.model,
          promptTokens: u.promptTokens,
          completionTokens: u.completionTokens,
          totalTokens,
        };
      });
      rows.sort((a, b) => b.totalTokens - a.totalTokens);

      const perModelTotals = [...modelTotals.entries()]
        .map(([model, total]) => ({ model, totalTokens: total }))
        .sort((a, b) => b.totalTokens - a.totalTokens);

      const body: TAdminUsageResponse = {
        rows,
        perModelTotals,
        grandTotal,
        timeseries,
        range: {
          startDate: parsed.startDate.toISOString(),
          endDate: parsed.endDate.toISOString(),
        },
      };
      return res.status(200).json(body);
    } catch (error) {
      logger.error('[adminUsage] getUsage error:', error);
      return res.status(500).json({ error: 'Failed to load usage statistics' });
    }
  }

  return { getUsage: getUsageHandler };
}
