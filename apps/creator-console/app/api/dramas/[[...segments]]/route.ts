import { getChatGPTUser } from '@/app/chatgpt-auth';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ segments?: string[] }> };

async function proxy(request: Request, context: Context): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: '请先登录后使用漫剧工作台' }, { status: 401 });
  const origin = request.headers.get('origin');
  if (request.method === 'POST' && origin && origin !== new URL(request.url).origin) return Response.json({ error: 'INVALID_ORIGIN' }, { status: 403 });
  const { segments = [] } = await context.params;
  if (segments.length > 3 || segments.some((part) => !/^[a-z0-9-]+$/.test(part))) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const base = process.env.ORCHESTRATOR_BASE_URL?.replace(/\/$/, '');
  if (!base) return Response.json({ error: '尚未配置制作服务地址' }, { status: 503 });
  const headers = new Headers({ 'x-filmgame-owner': user.userId });
  for (const name of ['content-type', 'range']) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  if (process.env.ORCHESTRATOR_API_TOKEN) headers.set('authorization', `Bearer ${process.env.ORCHESTRATOR_API_TOKEN}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    // Streaming proxy: no provider credentials or upstream asset URLs reach the browser.
    const upstream = await fetch(`${base}/v1/dramas${segments.length ? `/${segments.join('/')}` : ''}${new URL(request.url).search}`, {
      method: request.method, headers, body: request.method === 'POST' ? request.body : null,
      signal: controller.signal, duplex: 'half',
    } as RequestInit);
    clearTimeout(timeout); // Large downloads may outlive the header timeout.
    const responseHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
      const value = upstream.headers.get(name); if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('cache-control', 'private, no-store'); responseHeaders.set('x-content-type-options', 'nosniff');
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: '制作服务暂时不可达，请检查 Orchestrator 后重试' }, { status: 502 });
  } finally { clearTimeout(timeout); }
}
export const GET = proxy;
export const POST = proxy;
