import { readFile } from 'node:fs/promises';

const ROBOTS_PATH = 'dist/cloudflare/browser/robots.txt';
const HEADERS_PATH = 'dist/cloudflare/browser/_headers';

function linesOf(text) {
  return text.replaceAll('\r\n', '\n').split('\n');
}

function parseDirective(line, lineNumber) {
  const separatorIndex = line.indexOf(':');
  const rawDirective = line.slice(0, separatorIndex);
  if (separatorIndex < 1 || !/^[A-Za-z][A-Za-z-]*$/u.test(rawDirective)) {
    throw new Error(`${ROBOTS_PATH}:${lineNumber} is not a valid robots directive.`);
  }

  return {
    directive: rawDirective.toLowerCase(),
    rawDirective,
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function hasPlainTextRobotsHeader(headers) {
  const lines = linesOf(headers);
  const robotsStart = lines.findIndex((line) => line.trim() === '/robots.txt');
  if (robotsStart < 0) {
    return false;
  }

  const nextPathOffset = lines.slice(robotsStart + 1).findIndex((line) => line.startsWith('/'));
  const robotsEnd = nextPathOffset < 0 ? lines.length : robotsStart + 1 + nextPathOffset;

  return lines.slice(robotsStart + 1, robotsEnd).some((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 1) {
      return false;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase();
    return (
      name === 'content-type' && (value === 'text/plain' || value === 'text/plain; charset=utf-8')
    );
  });
}

const robotsBuffer = await readFile(ROBOTS_PATH);
const robots = new TextDecoder('utf-8', { fatal: true }).decode(robotsBuffer);

if (/<!doctype\s+html|<html[\s>]/i.test(robots)) {
  throw new Error(`${ROBOTS_PATH} contains HTML instead of robots directives.`);
}

let currentUserAgents = [];
let hasGlobalUserAgent = false;
let hasGlobalAllow = false;

for (const [index, sourceLine] of linesOf(robots).entries()) {
  const commentIndex = sourceLine.indexOf('#');
  const line = sourceLine.slice(0, commentIndex < 0 ? sourceLine.length : commentIndex).trim();
  if (line === '') {
    continue;
  }

  const { directive, rawDirective, value } = parseDirective(line, index + 1);
  if (directive === 'user-agent') {
    if (value === '') {
      throw new Error(`${ROBOTS_PATH}:${index + 1} has an empty User-agent value.`);
    }
    currentUserAgents = [value.toLowerCase()];
    hasGlobalUserAgent ||= value === '*';
    continue;
  }

  if (directive === 'allow' || directive === 'disallow') {
    if (currentUserAgents.length === 0) {
      throw new Error(`${ROBOTS_PATH}:${index + 1} must follow a User-agent directive.`);
    }
    if (directive === 'allow' && value === '') {
      throw new Error(`${ROBOTS_PATH}:${index + 1} has an empty Allow value.`);
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
      throw new Error(`${ROBOTS_PATH}:${index + 1} has an invalid Sitemap URL.`);
    }
    continue;
  }

  throw new Error(`${ROBOTS_PATH}:${index + 1} uses unsupported directive ${rawDirective}.`);
}

if (!hasGlobalUserAgent || !hasGlobalAllow) {
  throw new Error(`${ROBOTS_PATH} must allow all crawlers to access the site.`);
}

const headers = await readFile(HEADERS_PATH, 'utf8');
if (!hasPlainTextRobotsHeader(headers)) {
  throw new Error(`${HEADERS_PATH} must serve /robots.txt as text/plain.`);
}

console.log(`Verified ${ROBOTS_PATH}: valid crawler directives served as text/plain.`);
