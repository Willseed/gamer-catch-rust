import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = process.argv[2] ?? 'dist/cloudflare/browser';
const robotsPath = join(outputDirectory, 'robots.txt');
const headersPath = join(outputDirectory, '_headers');

const robotsBuffer = await readFile(robotsPath);
const robots = new TextDecoder('utf-8', { fatal: true }).decode(robotsBuffer);

if (/<!doctype\s+html|<html[\s>]/i.test(robots)) {
  throw new Error(`${robotsPath} contains HTML instead of robots directives.`);
}

let currentUserAgents = [];
let hasGlobalUserAgent = false;
let hasGlobalAllow = false;

for (const [index, sourceLine] of robots.split(/\r?\n/).entries()) {
  const line = sourceLine.replace(/\s+#.*$/, '').trim();
  if (line === '' || line.startsWith('#')) {
    continue;
  }

  const match = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
  if (!match) {
    throw new Error(`${robotsPath}:${index + 1} is not a valid robots directive.`);
  }

  const [, rawDirective, value] = match;
  const directive = rawDirective.toLowerCase();
  if (directive === 'user-agent') {
    if (value === '') {
      throw new Error(`${robotsPath}:${index + 1} has an empty User-agent value.`);
    }
    currentUserAgents = [value.toLowerCase()];
    hasGlobalUserAgent ||= value === '*';
    continue;
  }

  if (directive === 'allow' || directive === 'disallow') {
    if (currentUserAgents.length === 0) {
      throw new Error(`${robotsPath}:${index + 1} must follow a User-agent directive.`);
    }
    if (directive === 'allow' && value === '') {
      throw new Error(`${robotsPath}:${index + 1} has an empty Allow value.`);
    }
    if (directive === 'allow' && value === '/' && currentUserAgents.includes('*')) {
      hasGlobalAllow = true;
    }
    continue;
  }

  if (directive === 'sitemap') {
    try {
      new URL(value);
    } catch {
      throw new Error(`${robotsPath}:${index + 1} has an invalid Sitemap URL.`);
    }
    continue;
  }

  throw new Error(`${robotsPath}:${index + 1} uses unsupported directive ${rawDirective}.`);
}

if (!hasGlobalUserAgent || !hasGlobalAllow) {
  throw new Error(`${robotsPath} must allow all crawlers to access the site.`);
}

const headers = await readFile(headersPath, 'utf8');
const robotsHeaderBlock = headers
  .split(/\n(?=\/)/)
  .find((block) => block.trimStart().startsWith('/robots.txt\n'));

if (
  !robotsHeaderBlock ||
  !/^\s+Content-Type:\s*text\/plain(?:;\s*charset=utf-8)?\s*$/im.test(robotsHeaderBlock)
) {
  throw new Error(`${headersPath} must serve /robots.txt as text/plain.`);
}

console.log(`Verified ${robotsPath}: valid crawler directives served as text/plain.`);
