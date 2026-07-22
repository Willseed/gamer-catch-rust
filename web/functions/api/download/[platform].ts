const RELEASE_DOWNLOADS = {
  macos: {
    url: 'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-macOS-arm64.zip',
    fileName: 'GamerCatch-macOS-arm64.zip',
  },
  windows: {
    url: 'https://github.com/Willseed/gamer-catch-rust/releases/latest/download/GamerCatch-Windows-x64.zip',
    fileName: 'GamerCatch-Windows-x64.zip',
  },
} as const;

type DownloadPlatform = keyof typeof RELEASE_DOWNLOADS;

const ARCHIVE_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/x-zip-compressed',
  'application/zip',
  'binary/octet-stream',
]);

interface PagesContext {
  readonly params: Record<string, string | string[]>;
  readonly request: Request;
}

function isDownloadPlatform(value: string): value is DownloadPlatform {
  return Object.hasOwn(RELEASE_DOWNLOADS, value);
}

function isExpectedArchiveContentType(value: string | null): boolean {
  const mediaType = value?.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType !== undefined && ARCHIVE_CONTENT_TYPES.has(mediaType);
}

function hasZipSignature(prefix: Uint8Array): boolean {
  return (
    prefix.length >= 4 &&
    prefix[0] === 0x50 &&
    prefix[1] === 0x4b &&
    ((prefix[2] === 0x03 && prefix[3] === 0x04) ||
      (prefix[2] === 0x05 && prefix[3] === 0x06) ||
      (prefix[2] === 0x07 && prefix[3] === 0x08))
  );
}

async function verifyZipBody(
  body: ReadableStream<Uint8Array>,
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = body.getReader();
  const bufferedChunks: Uint8Array[] = [];
  const prefix = new Uint8Array(4);
  let prefixLength = 0;

  try {
    while (prefixLength < prefix.length) {
      const { done, value } = await reader.read();
      if (done) {
        await reader.cancel();
        return null;
      }
      bufferedChunks.push(value);
      const copyLength = Math.min(value.length, prefix.length - prefixLength);
      prefix.set(value.subarray(0, copyLength), prefixLength);
      prefixLength += copyLength;
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  if (!hasZipSignature(prefix)) {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const bufferedChunk = bufferedChunks.shift();
      if (bufferedChunk) {
        controller.enqueue(bufferedChunk);
        return;
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const platformValue = context.params['platform'];
  const platform = Array.isArray(platformValue) ? platformValue[0] : platformValue;

  if (!platform || !isDownloadPlatform(platform)) {
    return new Response('找不到指定的下載版本。', { status: 404 });
  }

  const release = RELEASE_DOWNLOADS[platform];
  let upstream: Response;
  try {
    upstream = await fetch(release.url, {
      headers: { Accept: 'application/octet-stream' },
      redirect: 'follow',
      signal: context.request.signal,
    });
  } catch {
    return new Response('目前無法取得下載檔案，請稍後再試。', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response('目前無法取得下載檔案，請稍後再試。', { status: 502 });
  }

  if (!isExpectedArchiveContentType(upstream.headers.get('Content-Type'))) {
    await upstream.body.cancel().catch(() => undefined);
    return new Response('下載來源沒有回傳 ZIP 檔案，請稍後再試。', { status: 502 });
  }

  const verifiedBody = await verifyZipBody(upstream.body);
  if (!verifiedBody) {
    return new Response('下載來源沒有回傳有效的 ZIP 檔案，請稍後再試。', { status: 502 });
  }

  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${release.fileName}"`,
    'Content-Type': 'application/zip',
    'X-GamerCatch-Download': 'release',
    'X-Content-Type-Options': 'nosniff',
  });
  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }

  return new Response(verifiedBody, { status: 200, headers });
}
