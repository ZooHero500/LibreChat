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

  it('normalises date-only endDate to end-of-day UTC so the final day is included', async () => {
    let capturedFilter: unknown;
    const getUsageByUserModel = jest.fn(async (filter: unknown) => {
      capturedFilter = filter;
      return [];
    });
    const handlers = createAdminUsageHandlers(
      deps({ getUsageByUserModel, getUsageTimeseries: jest.fn(async () => []) }),
    );
    const req = {
      query: { startDate: '2026-06-01', endDate: '2026-06-23' },
    } as unknown as ServerRequest;
    const res = mockRes();
    await handlers.getUsage(req, res);
    expect(res._status).toBe(200);
    const { endDate } = capturedFilter as { endDate: Date };
    expect(endDate.getUTCHours()).toBe(23);
    expect(endDate.getUTCMinutes()).toBe(59);
    expect(endDate.getUTCSeconds()).toBe(59);
    expect(endDate.getUTCMilliseconds()).toBe(999);
  });
});
