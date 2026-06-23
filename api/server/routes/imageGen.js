const express = require('express');
const { v4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { generateImages, imageGenModels, getImageGenModel } = require('@librechat/api');
const { FileContext, EModelEndpoint, extractEnvVariable } = require('librechat-data-provider');
const {
  uaParser,
  checkBan,
  requireJwtAuth,
  configMiddleware,
} = require('~/server/middleware');
const { processFileURL } = require('~/server/services/Files/process');
const { getFileStrategy } = require('~/server/utils/getFileStrategy');
const { getFiles, updateFile } = require('~/models');

const router = express.Router();
router.use(requireJwtAuth);
router.use(configMiddleware);
router.use(checkBan);
router.use(uaParser);

/** @type {Map<string, { status: 'running' | 'done' | 'error', startedAt: number, images?: object[], error?: string }>} */
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGES = 4;

const pruneJobs = () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && now - job.startedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
};

const resolveImageGenConfig = (appConfig) => {
  const baseURL = process.env.IMAGE_GEN_API_BASE_URL || 'http://apimart-adapter:8000/v1';
  let apiKey = process.env.IMAGE_GEN_API_KEY || process.env.APIMART_KEY;
  if (!apiKey) {
    const endpointName = process.env.IMAGE_GEN_ENDPOINT || 'APImart';
    const customEndpoints = appConfig?.endpoints?.[EModelEndpoint.custom] ?? [];
    const endpoint = customEndpoints.find((config) => config.name === endpointName);
    if (endpoint?.apiKey) {
      apiKey = extractEnvVariable(endpoint.apiKey);
    }
  }
  return { baseURL, apiKey };
};

const runJob = async ({ jobId, req, model, prompt, size, resolution, n, imageUrls }) => {
  const startedAt = jobs.get(jobId).startedAt;
  try {
    const { baseURL, apiKey } = resolveImageGenConfig(req.config);
    if (!apiKey) {
      throw new Error('Image generation API key is not configured');
    }
    const urls = await generateImages({ baseURL, apiKey, model, prompt, size, resolution, n, imageUrls });
    const fileStrategy = getFileStrategy(req.config, { isImage: true });
    const images = [];
    for (const url of urls) {
      const extension = url.split('?')[0].toLowerCase().includes('.png') ? 'png' : 'jpg';
      const fileName = `img-${v4()}.${extension}`;
      /* Download the result through the adapter (in-network HTTP); the api
       * container cannot reliably reach the external apib.ai CDN directly. */
      const downloadURL = `${baseURL}/images/fetch?url=${encodeURIComponent(url)}`;
      const file = await processFileURL({
        fileStrategy,
        userId: req.user.id,
        URL: downloadURL,
        fileName,
        basePath: 'images',
        context: FileContext.image_generation,
        tenantId: req.user.tenantId,
        req,
      });
      await updateFile({ file_id: file.file_id, model, prompt }, { user: req.user.id });
      images.push({
        file_id: file.file_id,
        filepath: file.filepath,
        width: file.width,
        height: file.height,
        model,
        prompt,
      });
    }
    jobs.set(jobId, {
      status: 'done',
      startedAt,
      images,
      elapsed: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch (error) {
    logger.error('[imageGen] generation failed', error);
    jobs.set(jobId, {
      status: 'error',
      startedAt,
      error: error.message,
      elapsed: Math.round((Date.now() - startedAt) / 1000),
    });
  }
};

router.get('/models', (req, res) => {
  res.json({ models: imageGenModels });
});

router.post('/generate', (req, res) => {
  pruneJobs();
  const { model, prompt, size = '1:1', resolution = '1k', n = 1, imageUrls = [] } = req.body;

  if (!getImageGenModel(model)) {
    return res.status(400).json({ error: 'Unknown image model' });
  }
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt) {
    return res.status(400).json({ error: 'A prompt is required' });
  }
  const count = Math.max(1, Math.min(Number(n) || 1, MAX_IMAGES));
  const references = Array.isArray(imageUrls) ? imageUrls.filter((url) => typeof url === 'string') : [];

  const jobId = v4();
  jobs.set(jobId, { status: 'running', startedAt: Date.now() });
  runJob({
    jobId,
    req,
    model,
    prompt: trimmedPrompt,
    size,
    resolution,
    n: count,
    imageUrls: references,
  });
  res.json({ jobId });
});

router.get('/generate/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  const { startedAt, ...snapshot } = job;
  const elapsed = job.elapsed ?? Math.round((Date.now() - startedAt) / 1000);
  res.json({ ...snapshot, elapsed });
});

router.get('/history', async (req, res) => {
  try {
    const files = await getFiles(
      { user: req.user.id, context: FileContext.image_generation },
      { createdAt: -1 },
      { file_id: 1, filepath: 1, model: 1, prompt: 1, width: 1, height: 1, createdAt: 1 },
    );
    res.json({ images: files ?? [] });
  } catch (error) {
    logger.error('[imageGen] failed to load history', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

module.exports = router;
