import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ImageGenRequest, ImageGenJobStatus } from 'librechat-data-provider';

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 260;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type GenerateImageOptions = {
  onSuccess?: (data: ImageGenJobStatus) => void;
  onError?: (error: unknown) => void;
};

export const useGenerateImageMutation = (
  options?: GenerateImageOptions,
): UseMutationResult<ImageGenJobStatus, unknown, ImageGenRequest, unknown> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: ImageGenRequest): Promise<ImageGenJobStatus> => {
      const { jobId } = await dataService.generateImage(payload);
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        const status = await dataService.getImageGenJob(jobId);
        if (status.status !== 'running') {
          return status;
        }
      }
      throw new Error('Image generation timed out');
    },
    onSuccess: (data) => {
      if (data.status === 'done') {
        queryClient.invalidateQueries([QueryKeys.imageGenHistory]);
      }
      options?.onSuccess?.(data);
    },
    onError: (error) => options?.onError?.(error),
  });
};
