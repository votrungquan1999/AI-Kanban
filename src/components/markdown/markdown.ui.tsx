"use client";

import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Visual tone of the rendered block; `destructive` recolors prose for errors. */
type MarkdownTone = "default" | "destructive";

/**
 * Sanitization schema permitting the `className` values `rehype-highlight` adds
 * to `<code>`/`<span>` nodes, so syntax highlighting survives the sanitize pass.
 * className values cannot carry script, so allowing them introduces no XSS risk.
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className"],
  },
};

/**
 * Prose-variable overrides that recolor the rendered markdown to the destructive
 * token, used for AI-authored error/failure text that must read as an error.
 */
const TONE_CLASS: Record<MarkdownTone, string> = {
  default: "",
  destructive: cn(
    "text-destructive",
    "[--tw-prose-body:var(--destructive)] [--tw-prose-headings:var(--destructive)]",
    "[--tw-prose-bold:var(--destructive)] [--tw-prose-links:var(--destructive)]",
    "[--tw-prose-code:var(--destructive)] [--tw-prose-quotes:var(--destructive)]",
  ),
};

/**
 * Renders AI-agent-authored text as sanitized GitHub-Flavored Markdown with
 * syntax-highlighted code blocks. The pipeline parses raw HTML, highlights code,
 * then sanitizes last so only a safe HTML subset reaches the DOM.
 * @param children - The raw markdown string to render.
 * @param tone - Visual tone; `destructive` recolors the block for error text.
 * @param className - Extra classes merged onto the prose container.
 */
export function Markdown({
  children,
  tone = "default",
  className,
}: {
  children: string;
  tone?: MarkdownTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none wrap-break-word",
        TONE_CLASS[tone],
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeHighlight,
          [rehypeSanitize, sanitizeSchema],
        ]}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
