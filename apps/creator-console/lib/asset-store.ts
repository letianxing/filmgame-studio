import { env } from 'cloudflare:workers';

export async function putProjectAsset(input: {
  projectId: string;
  assetId: string;
  bytes: ArrayBuffer | ArrayBufferView | ReadableStream;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<{ key: string; etag: string }> {
  const key = `projects/${safeSegment(input.projectId)}/assets/${safeSegment(input.assetId)}`;
  const result = await env.FILES.put(key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
    ...(input.metadata ? { customMetadata: input.metadata } : {}),
  });
  if (!result) throw new Error('R2 did not return an upload result');
  return { key, etag: result.httpEtag };
}

export async function getProjectAsset(key: string): Promise<R2ObjectBody | null> {
  if (!key.startsWith('projects/') || key.includes('..')) throw new Error('Invalid asset key');
  return env.FILES.get(key);
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Unsafe asset key segment: ${value}`);
  return value;
}

