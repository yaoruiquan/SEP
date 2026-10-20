export const IMAGE_MODEL_SIZES = ['1024x1024', '1536x1024', '1024x1536'] as const;
export const IMAGE_MODEL_QUALITIES = ['low', 'medium', 'high'] as const;

const SUPPORTED_IMAGE_MODELS = new Set([
  'gpt-image-1',
  'gpt-image-1-mini',
  'gpt-image-1.5',
  'gpt-image-2',
  'gpt-image-2-exact',
  'gpt-image-2.5',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
]);

export function isSupportedImageModel(modelId: string): boolean {
  return SUPPORTED_IMAGE_MODELS.has(modelId);
}

export function imageModelCapabilities(modelId: string) {
  if (!isSupportedImageModel(modelId)) return null;
  return { sizes: [...IMAGE_MODEL_SIZES], qualities: [...IMAGE_MODEL_QUALITIES], defaultSize: '1024x1024' as const, defaultQuality: 'medium' as const };
}
