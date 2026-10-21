import type { AddressInfo } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

// Shared by tests/failures.spec.ts and resources.ts. Intentional failures: see fixtures/README.md.

/** Serves `status` on 127.0.0.1 while `use` runs: no external network. */
export async function withStatusServer<T>(status: number, use: (url: string) => Promise<T>, pathname = '/api/orders'): Promise<T> {
  const server = createHttpServer((_request, response) => {
    response.statusCode = status;
    response.end('Intentional failure');
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await use(`http://127.0.0.1:${port}${pathname}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
