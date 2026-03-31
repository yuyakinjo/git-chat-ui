import ts from '@shikijs/langs/ts';
import tsx from '@shikijs/langs/tsx';
import json from '@shikijs/langs/json';
import md from '@shikijs/langs/md';
import css from '@shikijs/langs/css';
import html from '@shikijs/langs/html';
import js from '@shikijs/langs/js';
import go from '@shikijs/langs/go';
import rs from '@shikijs/langs/rs';
import githubDark from '@shikijs/themes/github-dark';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { createHighlighterCoreSync } from 'shiki/core';

import type { IntralineSegment } from './intralineDiff';

export type DiffSyntaxLanguage = 'ts' | 'tsx' | 'json' | 'md' | 'css' | 'html' | 'js' | 'go' | 'rs';

export interface DiffSyntaxToken {
  content: string;
  color?: string;
  bgColor?: string;
  fontStyle?: number;
}

export interface DiffSyntaxDisplayToken extends DiffSyntaxToken {
  emphasized: boolean;
}

const highlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  langs: [ts, tsx, json, md, css, html, js, go, rs],
  themes: [githubDark]
});

const lineCache = new Map<string, DiffSyntaxToken[]>();
const MAX_CACHE_SIZE = 2000;

export function resolveDiffSyntaxLanguage(filePath: string | null | undefined): DiffSyntaxLanguage | null {
  if (!filePath) {
    return null;
  }

  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.tsx')) {
    return 'tsx';
  }

  if (normalized.endsWith('.ts') || normalized.endsWith('.cts') || normalized.endsWith('.mts')) {
    return 'ts';
  }

  if (normalized.endsWith('.json') || normalized.endsWith('.jsonc') || normalized.endsWith('.json5')) {
    return 'json';
  }

  if (normalized.endsWith('.md') || normalized.endsWith('.markdown') || normalized.endsWith('.mdx')) {
    return 'md';
  }

  if (normalized.endsWith('.css')) {
    return 'css';
  }

  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'html';
  }

  if (normalized.endsWith('.js') || normalized.endsWith('.cjs') || normalized.endsWith('.mjs') || normalized.endsWith('.jsx')) {
    return 'js';
  }

  if (normalized.endsWith('.go')) {
    return 'go';
  }

  if (normalized.endsWith('.rs')) {
    return 'rs';
  }

  return null;
}

export function buildDiffSyntaxTokens(
  content: string,
  language: DiffSyntaxLanguage | null,
  segments: IntralineSegment[] | null
): DiffSyntaxDisplayToken[] {
  if (!content) {
    return [];
  }

  const baseTokens = language ? highlightLine(content, language) : [{ content }];
  const normalizedSegments = normalizeSegments(content, segments);
  if (normalizedSegments.length === 1 && !normalizedSegments[0]?.emphasized) {
    return baseTokens.map((token) => ({ ...token, emphasized: false }));
  }

  const splitTokens = splitTokensAtBreakpoints(baseTokens, collectSegmentBreakpoints(normalizedSegments));
  const displayTokens: DiffSyntaxDisplayToken[] = [];

  let segmentIndex = 0;
  let consumed = 0;
  let segmentEnd = normalizedSegments[0]?.text.length ?? 0;

  for (const token of splitTokens) {
    while (segmentIndex < normalizedSegments.length - 1 && consumed >= segmentEnd) {
      segmentIndex += 1;
      segmentEnd += normalizedSegments[segmentIndex]?.text.length ?? 0;
    }

    displayTokens.push({
      ...token,
      emphasized: normalizedSegments[segmentIndex]?.emphasized ?? false
    });
    consumed += token.content.length;
  }

  return displayTokens;
}

function highlightLine(content: string, language: DiffSyntaxLanguage): DiffSyntaxToken[] {
  const cacheKey = `${language}\u0000${content}`;
  const cached = lineCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const [tokens = []] = highlighter.codeToTokensBase(content, {
    lang: language,
    theme: githubDark,
    tokenizeMaxLineLength: 4000,
    tokenizeTimeLimit: 100
  });

  const normalized = normalizeHighlightedTokens(tokens, content);
  if (lineCache.size >= MAX_CACHE_SIZE) {
    lineCache.clear();
  }
  lineCache.set(cacheKey, normalized);

  return normalized;
}

function normalizeHighlightedTokens(
  tokens: Array<{ content: string; color?: string; bgColor?: string; fontStyle?: number }>,
  content: string
): DiffSyntaxToken[] {
  const normalized = tokens
    .filter((token) => token.content.length > 0)
    .map((token) => ({
      content: token.content,
      color: token.color,
      bgColor: token.bgColor,
      fontStyle: typeof token.fontStyle === 'number' && token.fontStyle >= 0 ? token.fontStyle : undefined
    }));

  if (normalized.length === 0) {
    return [{ content }];
  }

  if (normalized.map((token) => token.content).join('') !== content) {
    return [{ content }];
  }

  return normalized;
}

function normalizeSegments(content: string, segments: IntralineSegment[] | null): IntralineSegment[] {
  if (!segments || segments.length === 0) {
    return [{ text: content, emphasized: false }];
  }

  if (segments.map((segment) => segment.text).join('') !== content) {
    return [{ text: content, emphasized: false }];
  }

  return segments;
}

function collectSegmentBreakpoints(segments: IntralineSegment[]): number[] {
  const breakpoints: number[] = [];
  let offset = 0;

  for (let index = 0; index < segments.length - 1; index += 1) {
    offset += segments[index]?.text.length ?? 0;
    breakpoints.push(offset);
  }

  return breakpoints;
}

function splitTokensAtBreakpoints(tokens: DiffSyntaxToken[], breakpoints: number[]): DiffSyntaxToken[] {
  if (breakpoints.length === 0) {
    return tokens;
  }

  const splitTokens: DiffSyntaxToken[] = [];
  let consumed = 0;
  let breakpointIndex = 0;
  let nextBreakpoint = breakpoints[breakpointIndex] ?? Number.POSITIVE_INFINITY;

  for (const token of tokens) {
    let tokenOffset = 0;

    while (tokenOffset < token.content.length) {
      const remainingInToken = token.content.length - tokenOffset;
      const remainingUntilBreakpoint = nextBreakpoint - consumed;
      const sliceLength = Math.min(remainingInToken, remainingUntilBreakpoint);
      const content = token.content.slice(tokenOffset, tokenOffset + sliceLength);

      if (content) {
        splitTokens.push({
          content,
          color: token.color,
          bgColor: token.bgColor,
          fontStyle: token.fontStyle
        });
      }

      tokenOffset += sliceLength;
      consumed += sliceLength;

      if (consumed === nextBreakpoint) {
        breakpointIndex += 1;
        nextBreakpoint = breakpoints[breakpointIndex] ?? Number.POSITIVE_INFINITY;
      }
    }
  }

  return splitTokens;
}
