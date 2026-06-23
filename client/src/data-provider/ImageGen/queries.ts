import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type { ImageGenModelsResponse, ImageGenHistoryResponse } from 'librechat-data-provider';

export const useGetImageGenModels = <TData = ImageGenModelsResponse>(
  config?: UseQueryOptions<ImageGenModelsResponse, unknown, TData>,
): QueryObserverResult<TData, unknown> => {
  return useQuery<ImageGenModelsResponse, unknown, TData>(
    [QueryKeys.imageGenModels],
    () => dataService.getImageGenModels(),
    {
      staleTime: 1000 * 60 * 15,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
    },
  );
};

export const useGetImageGenHistory = <TData = ImageGenHistoryResponse>(
  config?: UseQueryOptions<ImageGenHistoryResponse, unknown, TData>,
): QueryObserverResult<TData, unknown> => {
  return useQuery<ImageGenHistoryResponse, unknown, TData>(
    [QueryKeys.imageGenHistory],
    () => dataService.getImageGenHistory(),
    {
      refetchOnWindowFocus: false,
      ...config,
    },
  );
};
