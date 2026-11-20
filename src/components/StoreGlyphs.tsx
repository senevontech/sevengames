/* Generic store glyphs (not the stores' trademarked badges), shared by the home footer and /app. */

export function PlayGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M4.5 3.2 14.2 12l-9.7 8.8a1.6 1.6 0 0 1-.7-1.3V4.5c0-.5.3-1 .7-1.3Z" fill="#00d3ff" />
      <path d="m17.6 8.9-3.4 3.1 3.4 3.1 3-1.7c1.1-.6 1.1-2.2 0-2.8l-3-1.7Z" fill="#ffce00" />
      <path d="M14.2 12 4.5 3.2c.4-.3 1-.3 1.5 0l11.6 5.7-3.4 3.1Z" fill="#00f076" />
      <path d="m14.2 12 3.4 3.1L6 20.8c-.5.3-1.1.3-1.5 0l9.7-8.8Z" fill="#ff3a44" />
    </svg>
  );
}

export function AppleGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="currentColor">
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1-2.9-4.2ZM13.9 5.2c.7-.8 1.2-2 1-3.2-1 .1-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.5 2.9-1.3Z" />
    </svg>
  );
}
