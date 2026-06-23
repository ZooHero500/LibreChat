export interface GenerateImagesParams {
  /**
   * Base URL of the apimart adapter (`http://apimart-adapter:8000/v1`). The adapter
   * exposes `/images/submit` (returns an apimart task id) and `/images/task/{id}`
   * (task status passthrough), so this service polls with short in-network requests
   * instead of holding one long external connection.
   */
  baseURL: string;
  /** Bearer token forwarded to the image API. */
  apiKey: string;
  /** Model id from the image-generation catalog. */
  model: string;
  /** Text prompt describing the desired image. */
  prompt: string;
  /** Aspect ratio (e.g. `1:1`). */
  size: string;
  /** Resolution preset (e.g. `1k`); ignored by models without resolution support. */
  resolution: string;
  /** Number of images to generate. */
  n: number;
  /** Reference images as data URIs or public URLs (image-to-image). */
  imageUrls?: string[];
}

interface SubmitResponse {
  data?: Array<{ task_id?: string }>;
  error?: { message?: string };
}

interface TaskResponse {
  data?: {
    status?: string;
    error?: string;
    message?: string;
    result?: { images?: Array<{ url?: string | string[] }> };
  };
}

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 600_000;
const MAX_REFERENCE_IMAGES = 14;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function extractUrls(task: TaskResponse['data']): string[] {
  const images = task?.result?.images ?? [];
  return images.flatMap((image) => {
    const { url } = image;
    if (Array.isArray(url)) {
      return url.filter((value): value is string => typeof value === 'string');
    }
    return typeof url === 'string' ? [url] : [];
  });
}

/**
 * Submits an image-generation task to the adapter and polls until completion,
 * returning the resulting image URLs. Throws on failure or timeout.
 */
export async function generateImages(params: GenerateImagesParams): Promise<string[]> {
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
    'Content-Type': 'application/json',
  };

  const submitResponse = await fetch(`${params.baseURL}/images/submit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: params.model,
      prompt: params.prompt,
      size: params.size,
      resolution: params.resolution,
      n: params.n,
      image_urls: (params.imageUrls ?? []).slice(0, MAX_REFERENCE_IMAGES),
    }),
  });

  const submit = (await submitResponse.json().catch(() => ({}) as SubmitResponse)) as SubmitResponse;
  if (!submitResponse.ok || submit.error) {
    throw new Error(submit.error?.message ?? `Submit failed with HTTP ${submitResponse.status}`);
  }
  const taskId = submit.data?.[0]?.task_id;
  if (!taskId) {
    throw new Error('Image API did not return a task id');
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const taskResponse = await fetch(`${params.baseURL}/images/task/${taskId}`, { headers });
    if (!taskResponse.ok) {
      continue;
    }
    const { data } = (await taskResponse.json()) as TaskResponse;
    const status = data?.status;
    if (status === 'completed') {
      const urls = extractUrls(data);
      if (!urls.length) {
        throw new Error('Task completed but returned no images');
      }
      return urls;
    }
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Task ${status}: ${data?.error ?? data?.message ?? ''}`);
    }
  }
  throw new Error(`Image generation timed out after ${TIMEOUT_MS / 1000}s`);
}
