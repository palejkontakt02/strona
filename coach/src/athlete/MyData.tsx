import type { Client } from '../domain';

export function MyData({ client }: { client: Client }) {
  void client;
  return null;
}
