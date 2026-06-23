import { render, screen } from 'test/layout-test-utils';
import * as dp from '~/data-provider';
import AdminUsageView from '../AdminUsageView';

jest.mock('~/data-provider', () => ({
  __esModule: true,
  useAdminUsage: jest.fn(),
  useListAdminUsers: jest.fn(() => ({ data: { users: [] } })),
  useGetRole: jest.fn(() => ({ data: null })),
  useGetUserQuery: jest.fn(() => ({ data: null, isLoading: false })),
  useLoginUserMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
  useLogoutUserMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
  useRefreshTokenMutation: jest.fn(() => ({ mutate: jest.fn(), isLoading: false })),
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
    expect(screen.getAllByText('deepseek').length).toBeGreaterThan(0);
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
