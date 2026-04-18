import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export async function mountMcpTransport(
  fastify: FastifyInstance,
  mcpServer: McpServer,
): Promise<void> {
  // Stateless mode: no sessionIdGenerator property means no session tracking
  const transport = new StreamableHTTPServerTransport({});

  await mcpServer.connect(transport as unknown as Transport);

  fastify.post('/mcp', async (request, reply) => {
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.hijack();
  });

  fastify.get('/mcp', async (request, reply) => {
    await transport.handleRequest(request.raw, reply.raw);
    reply.hijack();
  });

  fastify.delete('/mcp', async (request, reply) => {
    await transport.handleRequest(request.raw, reply.raw);
    reply.hijack();
  });
}
