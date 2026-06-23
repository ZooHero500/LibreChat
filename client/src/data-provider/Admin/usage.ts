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
