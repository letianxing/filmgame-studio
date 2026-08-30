import { MediaPipelineError } from '@filmgame/media-pipeline';
import { ProviderError } from '@filmgame/provider-sdk';

export interface CreatorFailure {
  code: string;
  title: string;
  message: string;
  technicalDetail: string;
  actions: Array<'RETRY_LOWER_QUALITY' | 'SWITCH_PROVIDER' | 'REGENERATE' | 'VIEW_LOGS' | 'INCREASE_BUDGET' | 'REVIEW_ASSET'>;
}

export function toCreatorFailure(cause: unknown, entityLabel = 'Production job'): CreatorFailure {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (/CUDA|out of memory|显存|allocation/iu.test(detail)) {
    return failure('GPU_MEMORY_EXHAUSTED', `${entityLabel} GPU memory is insufficient.`, detail, ['RETRY_LOWER_QUALITY', 'SWITCH_PROVIDER', 'VIEW_LOGS']);
  }
  if ((cause instanceof ProviderError && cause.code === 'QUOTA') || /HTTP 429|quota|rate limit/iu.test(detail)) {
    return failure('PROVIDER_QUOTA', `${entityLabel} is waiting because the provider quota or rate limit was reached.`, detail, ['SWITCH_PROVIDER', 'REGENERATE', 'VIEW_LOGS']);
  }
  if ((cause instanceof ProviderError && cause.code === 'TIMEOUT') || /timed out|timeout/iu.test(detail)) {
    return failure('PROVIDER_TIMEOUT', `${entityLabel} timed out and can be retried safely.`, detail, ['REGENERATE', 'SWITCH_PROVIDER', 'VIEW_LOGS']);
  }
  if (cause instanceof MediaPipelineError || /ffmpeg|ffprobe|media technical validation/iu.test(detail)) {
    return failure('MEDIA_TECHNICAL_FAILURE', `${entityLabel} produced media that failed technical validation.`, detail, ['REGENERATE', 'REVIEW_ASSET', 'VIEW_LOGS']);
  }
  if (/budget/iu.test(detail)) {
    return failure('BUDGET_LIMIT', `${entityLabel} paused before exceeding the approved budget.`, detail, ['INCREASE_BUDGET', 'SWITCH_PROVIDER', 'VIEW_LOGS']);
  }
  return failure('PRODUCTION_FAILURE', `${entityLabel} failed and requires review.`, detail, ['REGENERATE', 'VIEW_LOGS']);
}

function failure(
  code: string,
  message: string,
  technicalDetail: string,
  actions: CreatorFailure['actions'],
): CreatorFailure {
  return { code, title: code.replaceAll('_', ' '), message, technicalDetail, actions };
}
