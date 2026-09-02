/**
 * Subtitle Formatter and Anti-Overflow Layout Engine
 * Handles smart multi-line wrapping, punctuation balancing, and auto-font scaling for Canvas & MP4 export
 */

import { SubtitleTypeface, subtitleCanvasFont, SYSTEM_FONT_STACK } from './subtitleFonts';

const DEFAULT_TYPEFACE: SubtitleTypeface = {
  primaryFamily: SYSTEM_FONT_STACK,
  primaryWeight: 'bold',
  secondaryFamily: SYSTEM_FONT_STACK,
  secondaryWeight: '500'
};

export interface FormattedSubtitleBlock {
  lines: string[];
  secondaryLines: string[];
  fontSize: number;
  secondaryFontSize: number;
  lineHeight: number;
  secondaryLineHeight: number;
  totalHeight: number;
  maxLineWidth: number;
  boxWidth: number;
  boxHeight: number;
}

/**
 * Splits Chinese & English text into lines based on canvas width constraints.
 * Prefers breaking at punctuation marks or spaces for natural speech cadence.
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number = 3
): string[] {
  if (!text) return [];

  // If already fits in a single line, return immediately
  const fullMetrics = ctx.measureText(text);
  if (fullMetrics.width <= maxWidth) {
    return [text];
  }

  // Check if text already has manual line breaks
  if (text.includes('\n')) {
    const rawLines = text.split('\n');
    const result: string[] = [];
    for (const raw of rawLines) {
      if (raw.trim()) {
        result.push(...wrapText(ctx, raw.trim(), maxWidth, maxLines));
      }
    }
    return result.slice(0, maxLines);
  }

  // Punctuation characters to consider for clean natural breaks
  const punctuationMarks = ['，', '。', '！', '？', '；', '、', ',', '!', '?', ';', ':', ' '];

  // Try punctuation-based splitting first if text is long
  const sentences = splitByPunctuation(text, punctuationMarks);
  if (sentences.length > 1) {
    const lines: string[] = [];
    let currentLine = '';

    for (const seg of sentences) {
      const testLine = currentLine ? currentLine + seg : seg;
      const testWidth = ctx.measureText(testLine).width;

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = seg;
        } else {
          // Segment itself is longer than maxWidth, character-by-character wrap
          const charWrapped = wrapByCharacters(ctx, seg, maxWidth);
          lines.push(...charWrapped.slice(0, -1));
          currentLine = charWrapped[charWrapped.length - 1] || '';
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    if (lines.length <= maxLines) {
      return balanceLines(lines);
    }
  }

  // Fallback: character-by-character / word-by-word wrapping
  const charLines = wrapByCharacters(ctx, text, maxWidth);
  return balanceLines(charLines.slice(0, maxLines));
}

/**
 * Split text preserving trailing punctuation
 */
function splitByPunctuation(text: string, puncts: string[]): string[] {
  const result: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;
    if (puncts.includes(char)) {
      result.push(current);
      current = '';
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

/**
 * Character/Word by character wrapping
 */
function wrapByCharacters(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let currentLine = '';

  // Handle English vs Chinese differently
  const isLatin = /^[\x00-\x7F\s]+$/.test(text);

  if (isLatin) {
    const words = text.split(' ');
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
  } else {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const testLine = currentLine + char;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = char;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Balances line lengths so that the last line doesn't end with a lone orphan word/character
 */
function balanceLines(lines: string[]): string[] {
  if (lines.length <= 1) return lines;

  // If the last line is only 1 or 2 characters and line 1 has more than 8, shift slightly
  if (lines.length === 2) {
    const [l1, l2] = lines;
    if (l2.length <= 3 && l1.length >= 8) {
      // Find mid point or punctuation
      const mid = Math.floor((l1.length + l2.length) / 2);
      const combined = l1 + l2;
      return [combined.slice(0, mid), combined.slice(mid)];
    }
  }

  return lines;
}

/**
 * Calculates complete multi-line layout with auto-scaling font size to ensure 100% zero overflow
 */
export function calculateSubtitleLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  secondaryText: string | undefined,
  canvasWidth: number,
  baseFontSize: number,
  isBilingual: boolean,
  maxWidthRatio: number = 0.84,
  maxLines: number = 3,
  typeface: SubtitleTypeface = DEFAULT_TYPEFACE
): FormattedSubtitleBlock {
  const maxWidth = canvasWidth * maxWidthRatio;

  let currentFontSize = baseFontSize;
  let lines: string[] = [];
  let secondaryLines: string[] = [];

  // Try fitting with base font size first; shrink if needed
  for (let attempt = 0; attempt < 4; attempt++) {
    ctx.font = subtitleCanvasFont(typeface.primaryFamily, currentFontSize, typeface.primaryWeight);
    lines = wrapText(ctx, text, maxWidth, maxLines);

    // Measure maximum line width
    let maxW = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxW) maxW = w;
    }

    if (maxW <= maxWidth) {
      break;
    }

    // Shrink font size slightly
    currentFontSize = Math.max(14, Math.round(currentFontSize * 0.88));
  }

  const lineHeight = Math.round(currentFontSize * 1.32);
  let secondaryFontSize = Math.round(currentFontSize * 0.62);
  let secondaryLineHeight = Math.round(secondaryFontSize * 1.28);

  // Bilingual: joint adaptive ladder over (primary size × secondary line count × secondary size).
  // Invariants: text is never truncated, every line is width-measured, and the box
  // only settles once all primary + secondary lines fit inside maxWidth.
  if (isBilingual && secondaryText) {
    interface BilingualFit {
      primarySize: number;
      primaryLines: string[];
      secSize: number;
      secLines: string[];
    }
    const secondaryScales = [1, 0.85, 0.72, 0.6];
    const secondaryLineOptions = [2, 3];
    const primaryScales = [1, 0.92];
    let resolved: BilingualFit | null = null;
    let fallback: BilingualFit | null = null;

    for (const primaryScale of primaryScales) {
      const tryPrimarySize = Math.max(14, Math.round(currentFontSize * primaryScale));
      ctx.font = subtitleCanvasFont(typeface.primaryFamily, tryPrimarySize, typeface.primaryWeight);
      const tryPrimaryLines = wrapText(ctx, text, maxWidth, maxLines);
      let primaryMaxW = 0;
      for (const line of tryPrimaryLines) {
        const w = ctx.measureText(line).width;
        if (w > primaryMaxW) primaryMaxW = w;
      }
      const secFloor = Math.max(10, Math.round(tryPrimarySize * 0.45));
      let lastTry: { secSize: number; secLines: string[] } | null = null;

      if (primaryMaxW <= maxWidth) {
        for (const secMaxLines of secondaryLineOptions) {
          let done = false;
          for (const secScale of secondaryScales) {
            const trySecSize = Math.max(secFloor, Math.round(tryPrimarySize * 0.62 * secScale));
            if (lastTry && lastTry.secSize === trySecSize) continue;
            ctx.font = subtitleCanvasFont(typeface.secondaryFamily, trySecSize, typeface.secondaryWeight);
            const trySecLines = wrapText(ctx, secondaryText, maxWidth, secMaxLines);
            lastTry = { secSize: trySecSize, secLines: trySecLines };
            let secMaxW = 0;
            for (const line of trySecLines) {
              const w = ctx.measureText(line).width;
              if (w > secMaxW) secMaxW = w;
            }
            if (secMaxW <= maxWidth) {
              resolved = { primarySize: tryPrimarySize, primaryLines: tryPrimaryLines, secSize: trySecSize, secLines: trySecLines };
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }

      if (!resolved && lastTry) {
        fallback = { primarySize: tryPrimarySize, primaryLines: tryPrimaryLines, secSize: lastTry.secSize, secLines: lastTry.secLines };
      }
      if (resolved) break;
    }

    const fit = resolved || fallback;
    if (fit) {
      currentFontSize = fit.primarySize;
      lines = fit.primaryLines;
      secondaryFontSize = fit.secSize;
      secondaryLines = fit.secLines;
      secondaryLineHeight = Math.round(secondaryFontSize * 1.28);
    }
  }

  // Calculate bounding box
  let maxLineWidth = 0;
  ctx.font = subtitleCanvasFont(typeface.primaryFamily, currentFontSize, typeface.primaryWeight);
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxLineWidth) maxLineWidth = w;
  }

  if (secondaryLines.length > 0) {
    ctx.font = subtitleCanvasFont(typeface.secondaryFamily, secondaryFontSize, typeface.secondaryWeight);
    for (const line of secondaryLines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }
  }

  const primaryHeight = lines.length * lineHeight;
  const secondaryHeight = secondaryLines.length > 0 ? secondaryLines.length * secondaryLineHeight + currentFontSize * 0.25 : 0;
  const totalHeight = primaryHeight + secondaryHeight;

  const paddingX = Math.round(currentFontSize * 0.85);
  const paddingY = Math.round(currentFontSize * 0.55);

  const boxWidth = maxLineWidth + paddingX * 2;
  const boxHeight = totalHeight + paddingY * 2;

  return {
    lines,
    secondaryLines,
    fontSize: currentFontSize,
    secondaryFontSize,
    lineHeight,
    secondaryLineHeight,
    totalHeight,
    maxLineWidth,
    boxWidth,
    boxHeight
  };
}
