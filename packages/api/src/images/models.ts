import type { ImageGenModel } from 'librechat-data-provider';

/**
 * Catalog of image-generation models exposed by the built-in image studio.
 * Mirrors the providers wired through the APImart adapter (Grok / Gemini / GPT-Image),
 * describing the capabilities the frontend needs to render its controls.
 */
const commonRatios = [
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
  '3:1',
  '1:3',
  '2:1',
  '1:2',
];

export const imageGenModels: ImageGenModel[] = [
  {
    id: 'grok-imagine-1.5-apimart',
    name: 'Grok Imagine',
    ratios: commonRatios,
    resolutions: [],
    img2img: true,
    editModel: 'grok-imagine-1.5-edit-apimart',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash',
    ratios: ['auto', ...commonRatios],
    resolutions: ['0.5k', '1k', '2k', '4k'],
    img2img: true,
  },
  {
    id: 'gpt-image-2',
    name: 'GPT-Image-2',
    ratios: ['auto', ...commonRatios],
    resolutions: ['1k', '2k', '4k'],
    img2img: true,
  },
];

const modelById = new Map<string, ImageGenModel>(imageGenModels.map((model) => [model.id, model]));

export function getImageGenModel(id: string): ImageGenModel | undefined {
  return modelById.get(id);
}
