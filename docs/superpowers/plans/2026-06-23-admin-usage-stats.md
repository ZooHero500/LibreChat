# Admin Usage Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Usage Statistics" page that reads the existing `transactions` collection and shows token consumption filtered by date range and user, grouped by user × model, with per-model subtotals and a daily trend chart.

**Architecture:** Three-layer reuse of the existing `admin/users` pattern. New MongoDB aggregation methods in `packages/data-schemas` (queried via injected `db` methods in `/api`), a DI handler factory in `packages/api`, an Express route in `/api`, shared types/endpoint/service in `packages/data-provider`, and a lazy-loaded React page in `client`. No new "gateway" — data already exists in `transactions`.

**Tech Stack:** TypeScript, Express, Mongoose aggregation, React, @tanstack/react-query, Jest + mongodb-memory-server.

## Global Constraints

- All new backend code is **TypeScript** in `packages/api` / `packages/data-schemas`; `/api` only gets a thin JS route wrapper.
- **Never use `any`**; never duplicate types — define shared shapes once in `packages/data-provider` (`TAdminUsage*`) and once in `packages/data-schemas` (aggregation row types), import them everywhere else.
- Single-word file names; group under single-word dirs (`Admin/Usage/`, `admin/usage.ts`).
- Frontend user-facing text uses `useLocalize()`; add English keys only, in `client/src/locales/en/translation.json`, prefix `com_ui_`.
- Permissions: every route guarded by `requireJwtAuth` + `requireAdminAccess` (`ACCESS_ADMIN`) + `requireReadUsers` (`READ_USERS`). No new capability.
- Token counts use `Math.abs(rawAmount)` (spends are stored negative). Only `tokenType ∈ {prompt, completion}` count toward usage (exclude `credits`).
- Rebuild data-provider after editing it: `npm run build:data-provider` (run from repo root).
- Tests: real logic, `mongodb-memory-server` for DB, no heavy mocking.

---

### Task 1: Aggregation methods in data-schemas

**Files:**
- Modify: `packages/data-schemas/src/methods/transaction.ts` (add types + two methods to `createTransactionMethods`)
- Test: `packages/data-schemas/src/methods/transaction.usage.spec.ts` (create)

**Interfaces:**
- Produces (exported from `@librechat/data-schemas`):
  - `type UsageStatsFilter = { startDate: Date; endDate: Date; userId?: string }`
  - `type UsageByUserModel = { userId: string; model: string; promptTokens: number; completionTokens: number }`
  - `type UsageTimeseriesPoint = { date: string; totalTokens: number }`
  - `getUsageByUserModel: (filter: UsageStatsFilter) => Promise<UsageByUserModel[]>`
  - `getUsageTimeseries: (filter: UsageStatsFilter) => Promise<UsageTimeseriesPoint[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/data-schemas/src/methods/transaction.usage.spec.ts`:

```ts
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import transactionSchema from '../schema/transaction';
import { createTransactionMethods } from './transaction';

let mongod: MongoMemoryServer;
let methods: ReturnType<typeof createTransactionMethods>;
const userA = new Types.ObjectId();
const userB = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
  methods = createTransactionMethods(mongoose, {
    getMultiplier: () => 1,
    getCacheMultiplier: () => 1,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await mongoose.models.Transaction.deleteMany({});
});

async function seed() {
  await mongoose.models.Transaction.create([
    { user: userA, model: 'deepseek', tokenType: 'prompt', rawAmount: -100, createdAt: new Date('2026-06-01T10:00:00Z') },
    { user: userA, model: 'deepseek', tokenType: 'completion', rawAmount: -50, createdAt: new Date('2026-06-01T10:00:00Z') },
    { user: userA, model: 'gpt-image', tokenType: 'prompt', rawAmount: -20, createdAt: new Date('2026-06-02T10:00:00Z') },
    { user: userB, model: 'deepseek', tokenType: 'prompt', rawAmount: -300, createdAt: new Date('2026-06-02T10:00:00Z') },
    { user: userA, model: 'deepseek', tokenType: 'credits', rawAmount: 999, createdAt: new Date('2026-06-02T10:00:00Z') },
  ]);
}

describe('getUsageByUserModel', () => {
  it('groups by user and model, splits prompt/completion, ignores credits', async () => {
    await seed();
    const rows = await methods.getUsageByUserModel({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-30T23:59:59Z'),
    });
    const a = rows.find((r) => r.userId === userA.toString() && r.model === 'deepseek');
    expect(a).toEqual({ userId: userA.toString(), model: 'deepseek', promptTokens: 100, completionTokens: 50 });
    expect(rows.some((r) => r.model === 'gpt-image' && r.promptTokens === 20)).toBe(true);
    expect(rows.some((r) => r.completionTokens === 999 || r.promptTokens === 999)).toBe(false);
  });

  it('filters by userId', async () => {
    await seed();
    const rows = await methods.getUsageByUserModel({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-30T23:59:59Z'),
      userId: userB.toString(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ userId: userB.toString(), model: 'deepseek', promptTokens: 300, completionTokens: 0 });
  });

  it('filters by date range', async () => {
    await seed();
    const rows = await methods.getUsageByUserModel({
      startDate: new Date('2026-06-02T00:00:00Z'),
      endDate: new Date('2026-06-02T23:59:59Z'),
    });
    expect(rows.some((r) => r.model === 'deepseek' && r.userId === userA.toString())).toBe(false);
    expect(rows.some((r) => r.userId === userB.toString())).toBe(true);
  });
});

describe('getUsageTimeseries', () => {
  it('buckets total tokens by day, sorted ascending', async () => {
    await seed();
    const points = await methods.getUsageTimeseries({
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-30T23:59:59Z'),
    });
    expect(points).toEqual([
      { date: '2026-06-01', totalTokens: 150 },
      { date: '2026-06-02', totalTokens: 320 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/data-schemas && npx jest transaction.usage.spec -t "groups by user"`
Expected: FAIL — `methods.getUsageByUserModel is not a function`.

- [ ] **Step 3: Add types and methods**

In `packages/data-schemas/src/methods/transaction.ts`, near the top (after existing imports/types), add the exported types:

```ts
export interface UsageStatsFilter {
  startDate: Date;
  endDate: Date;
  userId?: string;
}

export interface UsageByUserModel {
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface UsageTimeseriesPoint {
  date: string;
  totalTokens: number;
}
```

Inside `createTransactionMethods`, before the final `return { ... }`, add:

```ts
function buildUsageMatch(filter: UsageStatsFilter): FilterQuery<ITransaction> {
  const match: FilterQuery<ITransaction> = {
    tokenType: { $in: ['prompt', 'completion'] },
    createdAt: { $gte: filter.startDate, $lte: filter.endDate },
  };
  if (filter.userId) {
    match.user = new mongoose.Types.ObjectId(filter.userId);
  }
  return match;
}

async function getUsageByUserModel(filter: UsageStatsFilter): Promise<UsageByUserModel[]> {
  const Transaction = mongoose.models.Transaction;
  const absAmount = { $abs: { $ifNull: ['$rawAmount', 0] } };
  const rows = await Transaction.aggregate([
    { $match: buildUsageMatch(filter) },
    {
      $group: {
        _id: { user: '$user', model: '$model' },
        promptTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, absAmount, 0] },
        },
        completionTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, absAmount, 0] },
        },
      },
    },
  ]);
  return rows.map((r) => ({
    userId: r._id.user ? r._id.user.toString() : '',
    model: r._id.model ?? 'unknown',
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
  }));
}

async function getUsageTimeseries(filter: UsageStatsFilter): Promise<UsageTimeseriesPoint[]> {
  const Transaction = mongoose.models.Transaction;
  const points = await Transaction.aggregate([
    { $match: buildUsageMatch(filter) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        totalTokens: { $sum: { $abs: { $ifNull: ['$rawAmount', 0] } } },
      },
    },
    { $sort: { _id: 1 } },
  ]);
  return points.map((p) => ({ date: p._id, totalTokens: p.totalTokens }));
}
```

Add `getUsageByUserModel` and `getUsageTimeseries` to the object returned by `createTransactionMethods`, and add their signatures to that function's explicit return type annotation:

```ts
  getUsageByUserModel: (filter: UsageStatsFilter) => Promise<UsageByUserModel[]>;
  getUsageTimeseries: (filter: UsageStatsFilter) => Promise<UsageTimeseriesPoint[]>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/data-schemas && npx jest transaction.usage.spec`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Verify methods are exposed on `db` and types are exported**

The methods auto-flow into `db` because `createMethods` spreads transaction methods (confirm with: `grep -n "transactionMethods" packages/data-schemas/src/methods/index.ts` — they are spread into the returned object). Ensure the new types are re-exported from the package: `grep -rn "TransactionMethods\|UsageStatsFilter" packages/data-schemas/src/index.ts packages/data-schemas/src/methods/index.ts`. If `transaction.ts` types aren't already re-exported from `src/index.ts`, add `export type { UsageStatsFilter, UsageByUserModel, UsageTimeseriesPoint } from './methods/transaction';` to `packages/data-schemas/src/index.ts`.

- [ ] **Step 6: Build data-schemas**

Run: `cd packages/data-schemas && npm run build`
Expected: clean build, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add packages/data-schemas/src/methods/transaction.ts packages/data-schemas/src/methods/transaction.usage.spec.ts packages/data-schemas/src/index.ts
git commit -m "feat(data-schemas): usage aggregation methods (by user/model + daily timeseries)"
```

---

### Task 2: Shared types, endpoint, service, query key in data-provider

**Files:**
- Modify: `packages/data-provider/src/types/admin.ts` (add usage types)
- Modify: `packages/data-provider/src/api-endpoints.ts` (add `adminUsage`)
- Modify: `packages/data-provider/src/data-service.ts` (add `getAdminUsage`)
- Modify: `packages/data-provider/src/keys.ts` (add `adminUsage` QueryKey)

**Interfaces:**
- Consumes: nothing from earlier tasks (defines fresh shared shapes).
- Produces:
  - `TAdminUsageParams = { startDate?: string; endDate?: string; userId?: string }`
  - `TAdminUsageRow = { userId; userName; userEmail; model; promptTokens; completionTokens; totalTokens }` (all numbers are `number`, ids/strings are `string`)
  - `TAdminUsageModelTotal = { model: string; totalTokens: number }`
  - `TAdminUsageTimeseriesPoint = { date: string; totalTokens: number }`
  - `TAdminUsageResponse = { rows: TAdminUsageRow[]; perModelTotals: TAdminUsageModelTotal[]; grandTotal: number; timeseries: TAdminUsageTimeseriesPoint[]; range: { startDate: string; endDate: string } }`
  - `endpoints.adminUsage(params?: TAdminUsageParams): string`
  - `dataService.getAdminUsage(params?: TAdminUsageParams): Promise<TAdminUsageResponse>`
  - `QueryKeys.adminUsage = 'adminUsage'`

- [ ] **Step 1: Add types**

Append to `packages/data-provider/src/types/admin.ts`:

```ts
export type TAdminUsageParams = {
  startDate?: string;
  endDate?: string;
  userId?: string;
};

export type TAdminUsageRow = {
  userId: string;
  userName: string;
  userEmail: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TAdminUsageModelTotal = {
  model: string;
  totalTokens: number;
};

export type TAdminUsageTimeseriesPoint = {
  date: string;
  totalTokens: number;
};

export type TAdminUsageResponse = {
  rows: TAdminUsageRow[];
  perModelTotals: TAdminUsageModelTotal[];
  grandTotal: number;
  timeseries: TAdminUsageTimeseriesPoint[];
  range: { startDate: string; endDate: string };
};
```

- [ ] **Step 2: Add endpoint**

In `packages/data-provider/src/api-endpoints.ts`, after `adminUserById` (~line 336), add:

```ts
export const adminUsage = (params?: {
  startDate?: string;
  endDate?: string;
  userId?: string;
}) => {
  const query = new URLSearchParams();
  if (params?.startDate) {
    query.set('startDate', params.startDate);
  }
  if (params?.endDate) {
    query.set('endDate', params.endDate);
  }
  if (params?.userId) {
    query.set('userId', params.userId);
  }
  const qs = query.toString();
  return `${BASE_URL}/api/admin/usage${qs ? `?${qs}` : ''}`;
};
```

- [ ] **Step 3: Add data-service function**

In `packages/data-provider/src/data-service.ts`, after `deleteAdminUser` (~line 1422), add:

```ts
export const getAdminUsage = (
  params?: adm.TAdminUsageParams,
): Promise<adm.TAdminUsageResponse> => {
  return request.get(endpoints.adminUsage(params));
};
```

(`adm` is the existing namespace import for `./types/admin`; confirm with `grep -n "as adm" packages/data-provider/src/data-service.ts`.)

- [ ] **Step 4: Add query key**

In `packages/data-provider/src/keys.ts`, in the `QueryKeys` enum after `adminUsers = 'adminUsers',` add:

```ts
  adminUsage = 'adminUsage',
```

- [ ] **Step 5: Build data-provider**

Run (from repo root): `npm run build:data-provider`
Expected: clean build, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add packages/data-provider/src/types/admin.ts packages/data-provider/src/api-endpoints.ts packages/data-provider/src/data-service.ts packages/data-provider/src/keys.ts packages/data-provider/dist
git commit -m "feat(data-provider): admin usage types, endpoint, service, query key"
```

---

### Task 3: Usage handler factory in packages/api

**Files:**
- Create: `packages/api/src/admin/usage.ts`
- Test: `packages/api/src/admin/usage.spec.ts`
- Modify: `packages/api/src/admin/index.ts` (export the factory — confirm barrel exists; if `admin/users.ts` is exported there, mirror it)

**Interfaces:**
- Consumes:
  - From `@librechat/data-schemas`: `UsageStatsFilter`, `UsageByUserModel`, `UsageTimeseriesPoint`, `IUser`.
  - From `librechat-data-provider`: `TAdminUsageResponse`, `TAdminUsageRow`.
- Produces: `createAdminUsageHandlers(deps: AdminUsageDeps): { getUsage: (req, res) => Promise<Response> }`
  - `AdminUsageDeps = { getUsageByUserModel; getUsageTimeseries; findUsers }`

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/admin/usage.spec.ts`:

```ts
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createAdminUsageHandlers } from './usage';

function mockRes() {
  const res = {} as Response & { _status?: number; _json?: unknown };
  res.status = ((code: number) => {
    res._status = code;
    return res;
  }) as Response['status'];
  res.json = ((body: unknown) => {
    res._json = body;
    return res;
  }) as Response['json'];
  return res;
}

const userId = '64b1f0000000000000000001';

function deps(overrides = {}) {
  return {
    getUsageByUserModel: jest.fn(async () => [
      { userId, model: 'deepseek', promptTokens: 100, completionTokens: 50 },
      { userId, model: 'gpt-image', promptTokens: 20, completionTokens: 0 },
    ]),
    getUsageTimeseries: jest.fn(async () => [{ date: '2026-06-01', totalTokens: 170 }]),
    findUsers: jest.fn(async () => [{ _id: userId, name: 'Alice', email: 'a@x.com' }]),
    ...overrides,
  };
}

describe('createAdminUsageHandlers.getUsage', () => {
  it('returns rows with resolved user names, per-model totals, grand total', async () => {
    const handlers = createAdminUsageHandlers(deps());
    const req = { query: { startDate: '2026-06-01', endDate: '2026-06-30' } } as unknown as ServerRequest;
    const res = mockRes();
    await handlers.getUsage(req, res);
    expect(res._status).toBe(200);
    const body = res._json as { rows: Array<Record<string, unknown>>; perModelTotals: unknown[]; grandTotal: number };
    expect(body.rows[0]).toMatchObject({ userName: 'Alice', model: 'deepseek', totalTokens: 150 });
    expect(body.grandTotal).toBe(170);
    expect(body.perModelTotals).toEqual(
      expect.arrayContaining([{ model: 'deepseek', totalTokens: 150 }, { model: 'gpt-image', totalTokens: 20 }]),
    );
  });

  it('rejects invalid userId with 400', async () => {
    const handlers = createAdminUsageHandlers(deps());
    const req = { query: { userId: 'not-an-id' } } as unknown as ServerRequest;
    const res = mockRes();
    await handlers.getUsage(req, res);
    expect(res._status).toBe(400);
  });

  it('rejects endDate before startDate with 400', async () => {
    const handlers = createAdminUsageHandlers(deps());
    const req = { query: { startDate: '2026-06-30', endDate: '2026-06-01' } } as unknown as ServerRequest;
    const res = mockRes();
    await handlers.getUsage(req, res);
    expect(res._status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && npx jest src/admin/usage.spec`
Expected: FAIL — cannot find module `./usage`.

- [ ] **Step 3: Implement the handler**

Create `packages/api/src/admin/usage.ts`:

```ts
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
  if (rawUser && !isValidObjectIdString(rawUser)) {
    return { error: 'Invalid userId format' };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/api && npx jest src/admin/usage.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Export from the admin barrel**

If `packages/api/src/admin/index.ts` exists and exports `createAdminUsersHandlers`, add `export * from './usage';` (mirror the existing line). Confirm the package builds: `cd packages/api && npm run build`.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/admin/usage.ts packages/api/src/admin/usage.spec.ts packages/api/src/admin/index.ts
git commit -m "feat(api): admin usage handler — aggregate rows, per-model totals, validation"
```

---

### Task 4: Express route + mount in /api

**Files:**
- Create: `api/server/routes/admin/usage.js`
- Modify: `api/server/routes/index.js` (require + export `adminUsage`)
- Modify: `api/server/index.js` (mount at `/api/admin/usage`)

**Interfaces:**
- Consumes: `createAdminUsageHandlers` from `@librechat/api`; `db.getUsageByUserModel`, `db.getUsageTimeseries`, `db.findUsers` from `~/models`.
- Produces: `GET /api/admin/usage` (guarded).

- [ ] **Step 1: Create the route**

Create `api/server/routes/admin/usage.js` (mirrors `admin/users.js`):

```js
const express = require('express');
const { createAdminUsageHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);

const handlers = createAdminUsageHandlers({
  getUsageByUserModel: db.getUsageByUserModel,
  getUsageTimeseries: db.getUsageTimeseries,
  findUsers: db.findUsers,
});

router.use(requireJwtAuth, requireAdminAccess);
router.get('/', requireReadUsers, handlers.getUsage);

module.exports = router;
```

- [ ] **Step 2: Register in the routes barrel**

In `api/server/routes/index.js`: add `const adminUsage = require('./admin/usage');` next to the other admin requires, and add `adminUsage,` to the `module.exports` object next to `adminUsers,`.

- [ ] **Step 3: Mount the route**

In `api/server/index.js`, after line `app.use('/api/admin/users', routes.adminUsers);` add:

```js
  app.use('/api/admin/usage', routes.adminUsage);
```

- [ ] **Step 4: Smoke-test the endpoint manually**

Start backend (`npm run backend`), then as a logged-in admin (browser session — remember the `User-Agent` requirement for LibreChat API), hit `GET /api/admin/usage?startDate=2026-06-01&endDate=2026-06-30`. Expected: `200` JSON with `rows`, `perModelTotals`, `grandTotal`, `timeseries`, `range`. A non-admin/anonymous request must get `401/403`.

- [ ] **Step 5: Commit**

```bash
git add api/server/routes/admin/usage.js api/server/routes/index.js api/server/index.js
git commit -m "feat(api): mount GET /api/admin/usage route"
```

---

### Task 5: React Query hook in client

**Files:**
- Create: `client/src/data-provider/Admin/usage.ts`
- Modify: `client/src/data-provider/Admin/index.ts` (export usage hook)

**Interfaces:**
- Consumes: `dataService.getAdminUsage`, `QueryKeys.adminUsage`, `TAdminUsageParams`, `TAdminUsageResponse` from `librechat-data-provider`.
- Produces: `useAdminUsage(params: TAdminUsageParams, config?) => UseQueryResult<TAdminUsageResponse>`

- [ ] **Step 1: Create the hook**

Create `client/src/data-provider/Admin/usage.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions } from '@tanstack/react-query';
import type { TAdminUsageParams, TAdminUsageResponse } from 'librechat-data-provider';

export const useAdminUsage = <TData = TAdminUsageResponse>(
  params: TAdminUsageParams,
  config?: UseQueryOptions<TAdminUsageResponse, unknown, TData>,
) => {
  return useQuery<TAdminUsageResponse, unknown, TData>(
    [QueryKeys.adminUsage, params],
    () => dataService.getAdminUsage(params),
    {
      refetchOnWindowFocus: false,
      keepPreviousData: true,
      ...config,
    },
  );
};
```

- [ ] **Step 2: Export from the Admin barrel**

In `client/src/data-provider/Admin/index.ts`, add `export * from './usage';` (mirror the existing `export * from './users';`). Confirm `client/src/data-provider/index.ts` re-exports the `Admin` barrel (it already does for users).

- [ ] **Step 3: Commit**

```bash
git add client/src/data-provider/Admin/usage.ts client/src/data-provider/Admin/index.ts
git commit -m "feat(client): useAdminUsage query hook"
```

---

### Task 6: Usage trend chart component (dependency-free SVG)

**Files:**
- Create: `client/src/components/Admin/Usage/UsageTrendChart.tsx`
- Test: `client/src/components/Admin/Usage/__tests__/UsageTrendChart.spec.tsx`

**Interfaces:**
- Consumes: `TAdminUsageTimeseriesPoint` from `librechat-data-provider`.
- Produces: `UsageTrendChart` default export — `({ points, label }: { points: TAdminUsageTimeseriesPoint[]; label: string }) => JSX.Element`.

- [ ] **Step 1: Write the failing test**

Create `client/src/components/Admin/Usage/__tests__/UsageTrendChart.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import UsageTrendChart from '../UsageTrendChart';

describe('UsageTrendChart', () => {
  it('renders an svg polyline for multiple points', () => {
    const { container } = render(
      <UsageTrendChart
        label="Daily token usage"
        points={[
          { date: '2026-06-01', totalTokens: 150 },
          { date: '2026-06-02', totalTokens: 320 },
        ]}
      />,
    );
    expect(container.querySelector('polyline')).toBeInTheDocument();
    expect(screen.getByLabelText('Daily token usage')).toBeInTheDocument();
  });

  it('renders an empty-state message when no points', () => {
    render(<UsageTrendChart label="Daily token usage" points={[]} />);
    expect(screen.getByText('Daily token usage')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx jest UsageTrendChart`
Expected: FAIL — cannot find module `../UsageTrendChart`.

- [ ] **Step 3: Implement the chart**

Create `client/src/components/Admin/Usage/UsageTrendChart.tsx`:

```tsx
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd client && npx jest UsageTrendChart`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Admin/Usage/UsageTrendChart.tsx client/src/components/Admin/Usage/__tests__/UsageTrendChart.spec.tsx
git commit -m "feat(client): dependency-free SVG usage trend chart"
```

---

### Task 7: Usage page view (filters + per-model totals + table)

**Files:**
- Create: `client/src/components/Admin/Usage/AdminUsageView.tsx`
- Create: `client/src/components/Admin/Usage/index.ts`
- Test: `client/src/components/Admin/Usage/__tests__/AdminUsageView.spec.tsx`
- Modify: `client/src/locales/en/translation.json` (add keys)

**Interfaces:**
- Consumes: `useAdminUsage` (Task 5), `useListAdminUsers` (existing), `UsageTrendChart` (Task 6), `useLocalize`.
- Produces: default-exported `AdminUsageView` component; `index.ts` re-exports it as `default` for the lazy route.

- [ ] **Step 1: Add localization keys**

In `client/src/locales/en/translation.json` add (alphabetical placement near other `com_ui_admin_` keys):

```json
"com_ui_admin_usage": "Usage Statistics",
"com_ui_admin_usage_start_date": "Start date",
"com_ui_admin_usage_end_date": "End date",
"com_ui_admin_usage_user_filter": "User",
"com_ui_admin_usage_all_users": "All users",
"com_ui_admin_usage_model": "Model",
"com_ui_admin_usage_prompt_tokens": "Prompt tokens",
"com_ui_admin_usage_completion_tokens": "Completion tokens",
"com_ui_admin_usage_total_tokens": "Total tokens",
"com_ui_admin_usage_grand_total": "Grand total",
"com_ui_admin_usage_trend": "Daily token usage",
"com_ui_admin_usage_empty": "No usage in this range",
"com_ui_admin_usage_accuracy_note": "Token figures come from model usage reporting; some custom or image models may under-report.",
```

- [ ] **Step 2: Write the failing test**

Create `client/src/components/Admin/Usage/__tests__/AdminUsageView.spec.tsx`:

```tsx
import { render, screen } from 'test/layout-test-utils';
import * as dp from '~/data-provider';
import AdminUsageView from '../AdminUsageView';

jest.mock('~/data-provider', () => ({
  __esModule: true,
  useAdminUsage: jest.fn(),
  useListAdminUsers: jest.fn(() => ({ data: { users: [] } })),
}));

const useAdminUsage = dp.useAdminUsage as jest.Mock;
const useListAdminUsers = dp.useListAdminUsers as jest.Mock;

describe('AdminUsageView', () => {
  beforeEach(() => {
    useListAdminUsers.mockReturnValue({ data: { users: [] } });
  });

  it('renders rows and per-model totals on success', () => {
    useAdminUsage.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        rows: [
          { userId: 'u1', userName: 'Alice', userEmail: 'a@x.com', model: 'deepseek', promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        ],
        perModelTotals: [{ model: 'deepseek', totalTokens: 150 }],
        grandTotal: 150,
        timeseries: [{ date: '2026-06-01', totalTokens: 150 }],
        range: { startDate: '2026-06-01T00:00:00Z', endDate: '2026-06-30T00:00:00Z' },
      },
    });
    render(<AdminUsageView />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('deepseek')).toBeInTheDocument();
    expect(screen.getAllByText('150').length).toBeGreaterThan(0);
  });

  it('renders empty state when no rows', () => {
    useAdminUsage.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { rows: [], perModelTotals: [], grandTotal: 0, timeseries: [], range: { startDate: '', endDate: '' } },
    });
    render(<AdminUsageView />);
    expect(screen.getByText('No usage in this range')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd client && npx jest AdminUsageView`
Expected: FAIL — cannot find module `../AdminUsageView`.

- [ ] **Step 4: Implement the view**

Create `client/src/components/Admin/Usage/AdminUsageView.tsx`:

```tsx
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
        <div className="py-8 text-center text-text-secondary">{localize('com_ui_admin_usage_empty')}</div>
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
```

Create `client/src/components/Admin/Usage/index.ts`:

```ts
export { default } from './AdminUsageView';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd client && npx jest AdminUsageView`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Admin/Usage/AdminUsageView.tsx client/src/components/Admin/Usage/index.ts client/src/components/Admin/Usage/__tests__/AdminUsageView.spec.tsx client/src/locales/en/translation.json
git commit -m "feat(client): admin usage view — filters, per-model totals, table"
```

---

### Task 8: Wire route + sidebar nav entry

**Files:**
- Modify: `client/src/routes/index.tsx` (lazy loader + route)
- Modify: `client/src/components/UnifiedSidebar/ExpandedPanel.tsx` (nav button)

**Interfaces:**
- Consumes: `AdminUsageView` default export via `~/components/Admin/Usage`; `com_ui_admin_usage` localization key.

- [ ] **Step 1: Add lazy loader + route**

In `client/src/routes/index.tsx`, after `loadAdminUsersView`:

```tsx
const loadAdminUsageView = () =>
  import('~/components/Admin/Usage').then((m) => ({
    Component: m.default,
  }));
```

And after the `admin/users` route object:

```tsx
            {
              path: 'admin/usage',
              lazy: loadAdminUsageView,
            },
```

- [ ] **Step 2: Add the sidebar button**

In `client/src/components/UnifiedSidebar/ExpandedPanel.tsx`, duplicate the `AdminUsersButton` component as `AdminUsageButton`, changing: the `isActive` path to `/admin/usage`, the navigate target to `/admin/usage`, `href` to `/admin/usage`, `data-testid` to `admin-usage-button`, and the label to `localize('com_ui_admin_usage')`. Render `<AdminUsageButton expanded={expanded} />` immediately after `<AdminUsersButton expanded={expanded} />` (~line 248). Keep the `user?.role !== SystemRoles.ADMIN` guard identical.

- [ ] **Step 3: Verify build + lint**

Run: `cd client && npx tsc --noEmit -p tsconfig.json` (or the project's typecheck script).
Expected: no TS errors. Resolve any ESLint warnings the new files raise.

- [ ] **Step 4: Manual end-to-end check**

With backend running and frontend dev server (`npm run frontend:dev`), log in as admin → the sidebar shows "Usage Statistics" → clicking opens `/admin/usage` → table, per-model cards, and trend chart populate; changing the date range / user filter refetches. Non-admin users do not see the button.

- [ ] **Step 5: Commit**

```bash
git add client/src/routes/index.tsx client/src/components/UnifiedSidebar/ExpandedPanel.tsx
git commit -m "feat(client): route + sidebar entry for admin usage statistics"
```

---

## Self-Review Notes

- **Spec coverage:** time+user filters (Tasks 3,7); user×model token table (Tasks 1,3,7); per-model subtotals (Tasks 3,7); daily trend chart (Tasks 1,6,7); admin-only access (Task 4); accuracy note + no money/no image count (Task 7 copy, scope honored). ✓
- **Type consistency:** `UsageStatsFilter/UsageByUserModel/UsageTimeseriesPoint` defined in Task 1, imported in Task 3; `TAdminUsage*` defined in Task 2, imported in Tasks 3/5/6/7. Method names `getUsageByUserModel` / `getUsageTimeseries` identical across Tasks 1, 3, 4. ✓
- **Open verification during execution:** confirm `transactionMethods` is spread into `createMethods` return (Task 1 Step 5), confirm `as adm` namespace import name in data-service (Task 2 Step 3), confirm `admin/index.ts` barrel exists in packages/api (Task 3 Step 5), confirm `useListAdminUsers` is exported from `~/data-provider` (used in Task 7).
