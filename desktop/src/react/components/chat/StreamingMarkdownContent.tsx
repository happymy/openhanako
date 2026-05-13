import { memo, useMemo } from 'react';
import { useTypewriterText } from '../../hooks/use-typewriter-text';
import { renderMarkdown } from '../../utils/markdown';
import { MarkdownContent } from './MarkdownContent';

interface Props {
  html: string;
  source?: string;
  active?: boolean;
  className?: string;
}

const COMPLEX_MARKDOWN_PATTERNS = [
  /(^|\n)\s*(```|~~~)/,
  /(^|\n)\s*\$\$/,
  /(^|\n)\s*\\\[/,
  /(^|\n)\s*\|.*\|/,
  /(^|\n)\s{4,}\S/,
  /(^|\n)\s*<[^>\n]+>/,
];

export function isTypewriterEligibleMarkdownSource(source: string): boolean {
  if (!source.trim()) return false;
  return !COMPLEX_MARKDOWN_PATTERNS.some((pattern) => pattern.test(source));
}

export const StreamingMarkdownContent = memo(function StreamingMarkdownContent({
  html,
  source,
  active = false,
  className,
}: Props) {
  const shouldType = !!source && active && isTypewriterEligibleMarkdownSource(source);
  const visibleSource = useTypewriterText(source || '', {
    active: shouldType,
    displayFps: 30,
    minBatch: 1,
    maxBatch: 24,
    catchUpThreshold: 24,
  });
  const visibleHtml = useMemo(
    () => shouldType ? renderMarkdown(visibleSource) : html,
    [html, shouldType, visibleSource],
  );

  return (
    <MarkdownContent
      html={visibleHtml}
      className={className}
      tailFadeCount={shouldType ? 4 : 0}
    />
  );
});
