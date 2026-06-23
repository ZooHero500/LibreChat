export type ImageGenModel = {
  /** Upstream model id sent to the image API. */
  id: string;
  /** Human-friendly brand label. */
  name: string;
  /** Supported aspect ratios; the first entry is the default. */
  ratios: string[];
  /** Supported resolution presets; empty when the model ignores resolution. */
  resolutions: string[];
  /** Whether the model accepts reference images (image-to-image). */
  img2img: boolean;
  /** Dedicated edit model id used when reference images are supplied. */
  editModel?: string;
};

export type ImageGenModelsResponse = {
  models: ImageGenModel[];
};

export type ImageGenRequest = {
  model: string;
  prompt: string;
  size?: string;
  resolution?: string;
  n?: number;
  /** Reference images as data URIs (image-to-image). */
  imageUrls?: string[];
};

export type ImageGenJobResponse = {
  jobId: string;
};

export type GeneratedImage = {
  file_id: string;
  filepath: string;
  width?: number;
  height?: number;
  model?: string;
  prompt?: string;
  createdAt?: string;
};

export type ImageGenStatus = 'running' | 'done' | 'error';

export type ImageGenJobStatus = {
  status: ImageGenStatus;
  elapsed: number;
  images?: GeneratedImage[];
  error?: string;
};

export type ImageGenHistoryResponse = {
  images: GeneratedImage[];
};
