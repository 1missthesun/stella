// App-scheme URLs (`stella-media:` …) are served by Electron main's protocol handlers on the
// desktop. The phone has none of those services: the UI fetches cloud files over https.
const handlers = new Map<string, (request: Request) => Response | Promise<Response>>();

export const protocol = {
  handle(scheme: string, fn: (request: Request) => Response | Promise<Response>) { handlers.set(scheme, fn); },
  unhandle(scheme: string) { handlers.delete(scheme); },
  isProtocolHandled: (scheme: string) => handlers.has(scheme),
};

export async function fetchProtocol(_partition: string, request: Request): Promise<Response | null> {
  const scheme = new URL(request.url).protocol.replace(/:$/, "");
  const fn = handlers.get(scheme);
  return fn ? await fn(request) : null;
}
