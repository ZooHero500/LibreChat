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
