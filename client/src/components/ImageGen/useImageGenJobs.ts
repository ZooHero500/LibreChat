import { useRef, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToastContext } from '@librechat/client';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { ImageGenRequest, GeneratedImage } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

const STORAGE_KEY = 'imageGenPendingJobs';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ERRORS = 4;

export type PendingJob = {
  jobId: string;
  model: string;
  prompt: string;
  count: number;
  startedAt: number;
};

function readPending(): PendingJob[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Manages background image-generation jobs: submitting frees the UI immediately,
 * polling happens in the background, and pending jobs are persisted to localStorage
 * so closing/reopening the page resumes them. Finished images always land in the
 * server-side history, so results are not lost even if a poll is missed.
 */
export function useImageGenJobs() {
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const localize = useLocalize();

  const [pending, setPending] = useState<PendingJob[]>(readPending);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const errorCounts = useRef<Record<string, number>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
  }, [pending]);

  const drop = useCallback((jobId: string) => {
    delete errorCounts.current[jobId];
    setPending((prev) => prev.filter((job) => job.jobId !== jobId));
  }, []);

  const submit = useCallback(
    async (payload: ImageGenRequest): Promise<void> => {
      const { jobId } = await dataService.generateImage(payload);
      setPending((prev) => [
        {
          jobId,
          model: payload.model,
          prompt: payload.prompt,
          count: payload.n ?? 1,
          startedAt: Date.now(),
        },
        ...prev,
      ]);
    },
    [],
  );

  useEffect(() => {
    if (pending.length === 0) {
      return;
    }
    const poll = async () => {
      await Promise.all(
        pending.map(async (job) => {
          try {
            const status = await dataService.getImageGenJob(job.jobId);
            errorCounts.current[job.jobId] = 0;
            if (status.status === 'done') {
              const images = status.images ?? [];
              setResults((prev) => {
                const seen = new Set(prev.map((image) => image.file_id));
                return [...images.filter((image) => !seen.has(image.file_id)), ...prev];
              });
              queryClient.invalidateQueries([QueryKeys.imageGenHistory]);
              drop(job.jobId);
            } else if (status.status === 'error') {
              showToast({
                message: status.error || localize('com_ui_image_gen_failed'),
                status: 'error',
              });
              drop(job.jobId);
            }
          } catch {
            /* Network blip or the job is gone (server restart / TTL). Tolerate a few
             * blips, then drop and refresh history in case the image already landed. */
            const next = (errorCounts.current[job.jobId] ?? 0) + 1;
            errorCounts.current[job.jobId] = next;
            if (next >= MAX_POLL_ERRORS) {
              queryClient.invalidateQueries([QueryKeys.imageGenHistory]);
              drop(job.jobId);
            }
          }
        }),
      );
    };
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pending, queryClient, showToast, localize, drop]);

  return { pending, results, submit };
}
