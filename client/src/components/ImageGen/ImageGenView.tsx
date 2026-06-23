import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Wand2, ImageUp, X, Loader2, Images } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import type { ImageGenModel, GeneratedImage } from 'librechat-data-provider';
import { useGetImageGenModels, useGetImageGenHistory } from '~/data-provider';
import { useImageGenJobs } from './useImageGenJobs';
import { useLocalize } from '~/hooks';
import ImageLightbox from './ImageLightbox';
import { cn } from '~/utils';

const MAX_REFERENCE_IMAGES = 6;

function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-green-600 bg-green-600/10 font-medium text-green-700 dark:text-green-400'
          : 'border-border-medium text-text-secondary hover:bg-surface-hover',
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        {!!hint && <span className="text-xs text-text-secondary">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ImageThumb({ image, onClick }: { image: GeneratedImage; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={image.prompt}
      className="group relative block overflow-hidden rounded-xl border border-border-light bg-surface-secondary text-left shadow-sm"
    >
      <img
        src={image.filepath}
        alt={image.prompt ?? ''}
        loading="lazy"
        className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-105"
      />
      {!!image.prompt && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-2 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {image.prompt}
        </span>
      )}
    </button>
  );
}

function PendingCard({ prompt, count }: { prompt: string; count: number }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border border-border-light bg-surface-secondary">
      <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-surface-tertiary to-surface-secondary" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" aria-hidden="true" />
        <span className="line-clamp-2 text-xs text-text-secondary">{prompt}</span>
      </div>
      {count > 1 && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-xs text-white">
          ×{count}
        </span>
      )}
    </div>
  );
}

export default function ImageGenView() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: modelsData } = useGetImageGenModels();
  const { data: historyData } = useGetImageGenHistory();
  const models = useMemo<ImageGenModel[]>(() => modelsData?.models ?? [], [modelsData]);
  const { pending, results, submit } = useImageGenJobs();

  const [modelId, setModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('');
  const [resolution, setResolution] = useState('');
  const [count, setCount] = useState(1);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lightbox, setLightbox] = useState<GeneratedImage | null>(null);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === modelId),
    [models, modelId],
  );

  useEffect(() => {
    if (!modelId && models.length) {
      setModelId(models[0].id);
    }
  }, [models, modelId]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    setSize(selectedModel.ratios[0] ?? '1:1');
    setResolution(selectedModel.resolutions[0] ?? '1k');
    if (!selectedModel.img2img) {
      setRefImages([]);
    }
  }, [selectedModel]);

  const addFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files) {
      return;
    }
    const images = await Promise.all(
      Array.from(files)
        .filter((file) => file.type.startsWith('image/'))
        .map(readImageAsDataUrl),
    );
    setRefImages((prev) => [...prev, ...images].slice(0, MAX_REFERENCE_IMAGES));
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || !modelId || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        model: modelId,
        prompt: trimmed,
        size,
        resolution,
        n: count,
        imageUrls: selectedModel?.img2img ? refImages : [],
      });
    } catch {
      showToast({ message: localize('com_ui_image_gen_failed'), status: 'error' });
    } finally {
      setSubmitting(false);
    }
  }, [
    prompt,
    modelId,
    submitting,
    submit,
    size,
    resolution,
    count,
    selectedModel,
    refImages,
    showToast,
    localize,
  ]);

  const history = historyData?.images ?? [];
  const canGenerate = !!prompt.trim() && !!modelId && !submitting;
  const hasCanvas = pending.length > 0 || results.length > 0;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-presentation">
      <div className="flex w-full flex-col gap-6 p-4 md:p-6 lg:p-8">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600/10 text-green-600">
            <Wand2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {localize('com_ui_image_gen')}
            </h1>
            <p className="text-sm text-text-secondary">{localize('com_ui_image_gen_desc')}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
          <section className="flex h-fit flex-col gap-5 rounded-2xl border border-border-light bg-surface-primary-alt p-5 shadow-sm">
            <Field label={localize('com_ui_image_gen_model')}>
              <div className="flex flex-wrap gap-2">
                {models.map((model) => (
                  <Chip
                    key={model.id}
                    active={model.id === modelId}
                    onClick={() => setModelId(model.id)}
                  >
                    {model.name}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label={localize('com_ui_image_gen_ratio')}>
              <div className="flex flex-wrap gap-2">
                {(selectedModel?.ratios ?? ['1:1']).map((ratio) => (
                  <Chip key={ratio} active={ratio === size} onClick={() => setSize(ratio)}>
                    {ratio}
                  </Chip>
                ))}
              </div>
            </Field>

            {!!selectedModel?.resolutions.length && (
              <Field label={localize('com_ui_image_gen_resolution')}>
                <div className="flex flex-wrap gap-2">
                  {selectedModel.resolutions.map((res) => (
                    <Chip key={res} active={res === resolution} onClick={() => setResolution(res)}>
                      {res}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}

            <Field label={localize('com_ui_image_gen_count')}>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4].map((value) => (
                  <Chip key={value} active={value === count} onClick={() => setCount(value)}>
                    {value}
                  </Chip>
                ))}
              </div>
            </Field>

            {selectedModel?.img2img && (
              <Field
                label={localize('com_ui_image_gen_reference')}
                hint={localize('com_ui_image_gen_reference_hint')}
              >
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                  className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-medium px-3 py-5 text-center text-text-secondary transition-colors hover:bg-surface-hover"
                >
                  <ImageUp className="h-5 w-5" aria-hidden="true" />
                  <span className="text-xs">{localize('com_ui_image_gen_reference_hint')}</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                {!!refImages.length && (
                  <div className="flex flex-wrap gap-2">
                    {refImages.map((src, index) => (
                      <div
                        key={index}
                        className="relative h-14 w-14 overflow-hidden rounded-lg border border-border-light"
                      >
                        <img src={src} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label={localize('com_ui_image_gen_remove')}
                          onClick={() => setRefImages((prev) => prev.filter((_, i) => i !== index))}
                          className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Field>
            )}

            <Field
              label={localize('com_ui_image_gen_prompt')}
              hint={prompt.length ? `${prompt.length}` : undefined}
            >
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    handleGenerate();
                  }
                }}
                rows={5}
                placeholder={localize('com_ui_image_gen_prompt_placeholder')}
                className="resize-none rounded-xl border border-border-medium bg-surface-primary px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-green-500"
              />
            </Field>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-sm transition-all',
                canGenerate
                  ? 'bg-green-600 hover:bg-green-700 active:scale-[.99]'
                  : 'cursor-not-allowed bg-surface-tertiary text-text-secondary',
              )}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Wand2 className="h-4 w-4" aria-hidden="true" />
              )}
              {localize('com_ui_image_gen_generate')}
            </button>
          </section>

          <section className="flex min-h-[400px] flex-col gap-3 rounded-2xl border border-border-light bg-surface-primary-alt p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-text-primary">
                {localize('com_ui_image_gen_result')}
              </h2>
              {pending.length > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  {localize('com_ui_image_gen_generating')}
                </span>
              )}
            </div>

            {!hasCanvas ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-secondary">
                <Images className="h-10 w-10 opacity-40" aria-hidden="true" />
                <p className="text-sm">{localize('com_ui_image_gen_empty')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {pending.map((job) => (
                  <PendingCard key={job.jobId} prompt={job.prompt} count={job.count} />
                ))}
                {results.map((image) => (
                  <ImageThumb
                    key={image.file_id}
                    image={image}
                    onClick={() => setLightbox(image)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        {history.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-text-primary">
              {localize('com_ui_image_gen_history')}
            </h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10">
              {history.map((image) => (
                <ImageThumb key={image.file_id} image={image} onClick={() => setLightbox(image)} />
              ))}
            </div>
          </section>
        )}
      </div>

      <ImageLightbox
        image={lightbox}
        onClose={() => setLightbox(null)}
        onUseAsReference={(dataUrl) =>
          setRefImages((prev) => [...prev, dataUrl].slice(0, MAX_REFERENCE_IMAGES))
        }
      />
    </div>
  );
}
