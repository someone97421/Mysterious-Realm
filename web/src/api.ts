export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function errorFromResponse(response: Response): Promise<ApiError> {
  let message = `请求失败（${response.status}）`;
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) message = body.detail;
  } catch {
    // 保留可读的 HTTP 错误。
  }
  return new ApiError(message, response.status);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('暂时无法连接星帷，请检查网络后重试');
  }
  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

interface StreamOptions {
  signal?: AbortSignal;
  onEvent: (event: string, data: unknown) => void;
}

export async function postSSE(
  path: string,
  payload: unknown,
  { signal, onEvent }: StreamOptions,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('连接中断，请稍后重试');
  }
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new ApiError('当前浏览器无法接收流式回应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let sawError = false;

  const consume = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!data.length) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join('\n'));
    } catch {
      sawError = true;
      onEvent('error', { message: '收到了无法识别的回应，请重试' });
      return;
    }
    if (event === 'done') sawDone = true;
    if (event === 'error') sawError = true;
    onEvent(event, payload);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      blocks.forEach(consume);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!sawDone && !sawError) {
      throw new ApiError('回应在完整结束前中断，请重试；已抽取的牌面不会改变');
    }
  } catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError('回应连接中断，请重试；已抽取的牌面不会改变');
  } finally {
    reader.releaseLock();
  }
}
