import { Buffer } from 'node:buffer';
import http from 'node:http';
import { MAX_BODY_BYTES } from './body.ts';
import { dispatch, type App } from './app.ts';
import type { HttpRequest } from './types.ts';

/**
 * The `node:http` adapter — the only asynchronous code in `src/http/` (D-002, D-023). It
 * reads a bounded body, then calls the synchronous `dispatch`; nothing about sockets reaches
 * any layer below.
 */
function headersOf(incoming: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') {
      headers[name] = value;
    } else if (Array.isArray(value)) {
      headers[name] = value.join(', ');
    }
  }
  return headers;
}

export function createServer(app: App): http.Server {
  return http.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    // A socket we cut ourselves, or a client that goes away mid-upload, is a connection
    // event, not a process-level error: swallow it rather than let it become uncaught.
    incoming.on('error', () => undefined);

    incoming.on('data', (chunk: Buffer) => {
      if (oversized) {
        return;
      }
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // The limit is enforced *while* reading, not after it: an unauthenticated client used
        // to be able to keep pushing megabytes for as long as Node's `requestTimeout` allowed,
        // because the stream was still drained to its end. The refusal wording stays the one
        // every in-process test exercises — it is answered now, and the socket is cut (#3
        // review, D-012).
        oversized = true;
        const request: HttpRequest = {
          method: incoming.method ?? 'GET',
          url: incoming.url ?? '/',
          headers: headersOf(incoming),
          body: Buffer.alloc(MAX_BODY_BYTES + 1),
        };
        incoming.pause();
        const response = dispatch(app, request);
        outgoing.writeHead(response.status, { ...response.headers });
        // Destroyed only once the refusal has been flushed, so the client still reads it.
        outgoing.end(response.body, () => {
          incoming.destroy();
        });
        return;
      }
      chunks.push(chunk);
    });

    incoming.on('end', () => {
      if (oversized) {
        return;
      }
      const request: HttpRequest = {
        method: incoming.method ?? 'GET',
        url: incoming.url ?? '/',
        headers: headersOf(incoming),
        body: Buffer.concat(chunks as unknown as Uint8Array[]),
      };
      const response = dispatch(app, request);
      outgoing.writeHead(response.status, { ...response.headers });
      outgoing.end(response.body);
    });
  });
}
