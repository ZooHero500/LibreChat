export type TAdminUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type TAdminUsersResponse = {
  users: TAdminUser[];
  total: number;
  limit: number;
  offset: number;
};

export type TCreateAdminUser = {
  email: string;
  name: string;
  username: string;
  password: string;
  role?: string;
};

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
