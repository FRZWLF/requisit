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
export function createServer(app: App): http.Server {
  return http.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let oversized = false;

    incoming.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop accumulating past the limit; the refusal is produced by the same body check
        // every in-process test exercises, so there is one rule and one wording.
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });

    incoming.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') {
          headers[name] = value;
        } else if (Array.isArray(value)) {
          headers[name] = value.join(', ');
        }
      }
      const request: HttpRequest = {
        method: incoming.method ?? 'GET',
        url: incoming.url ?? '/',
        headers,
        body: oversized
          ? Buffer.alloc(MAX_BODY_BYTES + 1)
          : Buffer.concat(chunks as unknown as Uint8Array[]),
      };
      const response = dispatch(app, request);
      outgoing.writeHead(response.status, { ...response.headers });
      outgoing.end(response.body);
    });
  });
}
