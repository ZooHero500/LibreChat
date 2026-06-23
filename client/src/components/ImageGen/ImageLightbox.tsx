import { useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button, TooltipAnchor, useToastContext } from '@librechat/client';
import { X, Copy, ArrowDownToLine, ImagePlus, ExternalLink } from 'lucide-react';
import type { GeneratedImage } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

interface ImageLightboxProps {
  image: GeneratedImage | null;
  onClose: () => void;
  onUseAsReference?: (dataUrl: string) => void;
}

async function fetchAsDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-right text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

export default function ImageLightbox({ image, onClose, onUseAsReference }: ImageLightboxProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const open = image != null;

  const handleDownload = useCallback(async () => {
    if (!image) {
      return;
    }
    try {
      const response = await fetch(image.filepath);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${image.file_id}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast({ message: localize('com_ui_image_gen_failed'), status: 'error' });
    }
  }, [image, localize, showToast]);

  const handleCopyPrompt = useCallback(async () => {
    if (!image?.prompt) {
      return;
    }
    await navigator.clipboard.writeText(image.prompt);
    showToast({ message: localize('com_ui_copied'), status: 'success' });
  }, [image, localize, showToast]);

  const handleUseAsReference = useCallback(async () => {
    if (!image || !onUseAsReference) {
      return;
    }
    try {
      const dataUrl = await fetchAsDataUrl(image.filepath);
      onUseAsReference(dataUrl);
      showToast({ message: localize('com_ui_image_gen_reference_added'), status: 'success' });
      onClose();
    } catch {
      showToast({ message: localize('com_ui_image_gen_failed'), status: 'error' });
    }
  }, [image, onUseAsReference, onClose, localize, showToast]);

  const dimensions = image?.width && image?.height ? `${image.width} × ${image.height}` : null;
  const created = image?.createdAt ? new Date(image.createdAt).toLocaleString() : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[100] flex flex-col outline-none md:flex-row"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {localize('com_ui_image_details')}
          </DialogPrimitive.Title>

          <div className="absolute left-4 top-4 z-20">
            <TooltipAnchor
              description={localize('com_ui_close')}
              render={
                <Button
                  onClick={onClose}
                  variant="ghost"
                  aria-label={localize('com_ui_close')}
                  className="h-10 w-10 p-0 text-white hover:bg-white/10"
                >
                  <X className="size-6" aria-hidden="true" />
                </Button>
              }
            />
          </div>

          <div
            className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                onClose();
              }
            }}
          >
            {image && (
              <img
                src={image.filepath}
                alt={image.prompt ?? ''}
                decoding="async"
                className="max-h-[60vh] max-w-full rounded-lg object-contain md:max-h-[88vh]"
              />
            )}
          </div>

          <aside className="flex w-full shrink-0 flex-col border-t border-border-medium bg-surface-primary md:h-full md:w-80 md:border-l md:border-t-0">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-text-primary">
                    {localize('com_ui_prompt')}
                  </h4>
                  {!!image?.prompt && (
                    <TooltipAnchor
                      description={localize('com_ui_copy')}
                      render={
                        <Button
                          onClick={handleCopyPrompt}
                          variant="ghost"
                          aria-label={localize('com_ui_copy')}
                          className="h-7 w-7 p-0 text-text-secondary"
                        >
                          <Copy className="size-4" aria-hidden="true" />
                        </Button>
                      }
                    />
                  )}
                </div>
                <p className="whitespace-pre-wrap rounded-md bg-surface-tertiary p-3 text-sm leading-relaxed text-text-primary">
                  {image?.prompt || '—'}
                </p>
              </div>

              <div className="space-y-3">
                {!!image?.model && (
                  <MetaRow label={localize('com_ui_model')} value={image.model} />
                )}
                {!!dimensions && (
                  <MetaRow label={localize('com_ui_image_gen_dimensions')} value={dimensions} />
                )}
                {!!created && (
                  <MetaRow label={localize('com_ui_image_gen_created')} value={created} />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border-light p-4">
              <Button
                onClick={handleDownload}
                variant="outline"
                className="w-full justify-center gap-2"
              >
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                {localize('com_ui_download')}
              </Button>
              {!!onUseAsReference && (
                <Button
                  onClick={handleUseAsReference}
                  variant="outline"
                  className="w-full justify-center gap-2"
                >
                  <ImagePlus className="size-4" aria-hidden="true" />
                  {localize('com_ui_image_gen_use_reference')}
                </Button>
              )}
              <a
                href={image?.filepath}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {localize('com_ui_image_gen_open_original')}
              </a>
            </div>
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
