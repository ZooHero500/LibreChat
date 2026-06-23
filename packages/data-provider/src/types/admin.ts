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
