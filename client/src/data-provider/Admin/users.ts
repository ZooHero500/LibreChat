import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, UseMutationResult } from '@tanstack/react-query';
import type { TAdminUsersResponse, TCreateAdminUser } from 'librechat-data-provider';

export const useListAdminUsers = <TData = TAdminUsersResponse>(
  config?: UseQueryOptions<TAdminUsersResponse, unknown, TData>,
) => {
  return useQuery<TAdminUsersResponse, unknown, TData>(
    [QueryKeys.adminUsers],
    () => dataService.listAdminUsers(200, 0),
    {
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};

export const useCreateAdminUserMutation = (options?: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}): UseMutationResult<{ message: string }, unknown, TCreateAdminUser> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TCreateAdminUser) => dataService.createAdminUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      options?.onSuccess?.();
    },
    onError: (error) => options?.onError?.(error),
  });
};

export const useSetAdminUserDisabledMutation = (options?: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}): UseMutationResult<
  { message: string; disabled: boolean },
  unknown,
  { id: string; disabled: boolean }
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      dataService.setAdminUserDisabled(id, disabled),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      options?.onSuccess?.();
    },
    onError: (error) => options?.onError?.(error),
  });
};

export const useDeleteAdminUserMutation = (options?: {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}): UseMutationResult<{ message: string }, unknown, string> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dataService.deleteAdminUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.adminUsers]);
      options?.onSuccess?.();
    },
    onError: (error) => options?.onError?.(error),
  });
};
