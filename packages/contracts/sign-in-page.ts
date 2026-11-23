/**
 * The page a browser lands on when a sign-in hands back to Stella on this
 * computer (ChatGPT, connector sign-ins). Every local
 * sign-in callback uses this one page, never a library's own (pi-ai ships a
 * Pi-branded one).
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(options: {
  title: string;
  heading: string;
  message: string;
  details?: string;
}): string {
  const title = escapeHtml(options.title);
  const heading = escapeHtml(options.heading);
  const message = escapeHtml(options.message);
  const details = options.details ? escapeHtml(options.details) : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Mona+Sans:wght@600&family=Manrope:wght@400;500&display=swap"
  />
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      font-family: "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      color: #1d1d1f;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #0e1014;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      border-radius: 18px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.06);
      padding: 40px 36px 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      text-align: center;
      animation: cardIn 240ms cubic-bezier(0.32, 0.72, 0, 1) both;
    }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .name {
      font-family: "Mona Sans", system-ui, sans-serif;
      font-size: 27px;
      font-weight: 600;
      letter-spacing: -0.03em;
      line-height: 1;
      color: #1d1d1f;
    }
    h1 {
      font-family: "Mona Sans", system-ui, sans-serif;
      font-size: 19px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: #1d1d1f;
      margin-top: 2px;
    }
    p {
      font-size: 14px;
      line-height: 1.55;
      letter-spacing: -0.005em;
      color: #6e6e73;
      max-width: 320px;
    }
    .details {
      width: 100%;
      margin-top: 4px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      color: #6e6e73;
      background: #f5f5f7;
      border-radius: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      text-align: left;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0a0a0a; }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="name">Stella</div>
    <h1>${heading}</h1>
    <p>${message}</p>
    ${details ? `<div class="details">${details}</div>` : ""}
  </main>
</body>
</html>`;
}

export function signInSuccessHtml(
  message: string,
  heading = "Signed in",
): string {
  return renderPage({
    title: `Stella — ${heading.toLowerCase()}`,
    heading,
    message,
  });
}

export function signInErrorHtml(
  message: string,
  options: { details?: string; heading?: string } = {},
): string {
  const heading = options.heading ?? "Couldn't sign in";
  return renderPage({
    title: `Stella — ${heading.toLowerCase()}`,
    heading,
    message,
    ...(options.details ? { details: options.details } : {}),
  });
}

/** Headers every sign-in page is sent with: never cached, never leaks the callback address. */
export const SIGN_IN_PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;
