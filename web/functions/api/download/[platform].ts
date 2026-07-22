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

interface PagesContext {
  readonly params: Record<string, string | string[]>;
  readonly request: Request;
}

function isDownloadPlatform(value: string): value is DownloadPlatform {
  return Object.hasOwn(RELEASE_DOWNLOADS, value);
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

  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="${release.fileName}"`,
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/zip',
    'X-GamerCatch-Download': 'release',
    'X-Content-Type-Options': 'nosniff',
  });
  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }

  return new Response(upstream.body, { status: 200, headers });
}
