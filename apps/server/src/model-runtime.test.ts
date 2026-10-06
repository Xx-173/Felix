import { afterEach, expect, test } from 'bun:test';
import type { AgentEvent, AgentRunInput, Message, ResearchSynthesisInput, ResearchSynthesis } from '@finagent/core';
import { createRouterFetchers, createFullRegistry, FinanceToolRegistry, ProviderRouter, withDemoDataFallback } from '@finagent/shared';
import { ModelRuntime } from './model-runtime.ts';

const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const tools = new FinanceToolRegistry(createFullRegistry(withDemoDataFallback(createRouterFetchers(new ProviderRouter()))));
const input: AgentRunInput = { sessionId: 'session-1', runId: 'run-1', content: '查询 AAPL.US 行情', locale: 'zh-CN' };
const history: Message[] = [{ id: 'message-1', role: 'user', content: input.content, timestamp: Date.now() }];
const data = (delta: unknown) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
function model(fetchHandler: (request: Request) => Response | Promise<Response>, messages = history) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: fetchHandler }); servers.push(server);
  return new ModelRuntime({ baseUrl: `${server.url}v1`, apiKey: 'test-only-secret', model: 'mock-model' }, tools, async () => messages);
}
async function collect(runtime: ModelRuntime) {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(input)) events.push(event);
  return events;
}

test('HTTP model assembles fragmented financial tool calls and streams Chinese answer', async () => {
  const requests: any[] = [];
  const runtime = model(async (request) => {
    expect(new URL(request.url).pathname).toBe('/v1/chat/completions');
    expect(request.headers.get('authorization')).toBe('Bearer test-only-secret');
    const body = await request.json() as any; requests.push(body);
    expect(body.tools.every((tool: any) => tool.function.name.startsWith('get_'))).toBe(true);
    if (requests.length === 1) return new Response(
      data({ tool_calls: [{ index: 0, id: 'quote-1', function: { name: 'get_quote', arguments: '{"symbol":' } }] }) +
      data({ tool_calls: [{ index: 0, function: { arguments: '"AAPL.US"}' } }] }) + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } });
    const evidence = JSON.parse(body.messages.at(-1).content);
    expect(evidence.data.symbol).toBe('AAPL.US');
    const bytes = new TextEncoder().encode(data({ content: '苹果' }) + data({ content: '示例行情已获取。' }) + 'data: [DONE]\n\n');
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const events = await collect(runtime);
  expect(events.some((event) => event.type === 'tool_completed' && event.payload.toolCall.status === 'success')).toBe(true);
  const last = events.at(-1)!;
  expect(last.type).toBe('run_completed');
  if (last.type === 'run_completed') expect(last.payload.answer).toBe('苹果示例行情已获取。');
  expect(events.filter((event) => event.type === 'message_delta')).toHaveLength(2);
  expect(JSON.stringify(events)).not.toContain('test-only-secret');
});

test('unknown coding tools are rejected by the financial registry', async () => {
  let calls = 0;
  const runtime = model(async (request) => {
    const body = await request.json() as any;
    if (++calls === 1) return new Response(data({ tool_calls: [{ index: 0, id: 'blocked', function: { name: 'execute_shell', arguments: '{"command":"echo blocked"}' } }] }) + 'data: [DONE]\n\n');
    expect(JSON.parse(body.messages.at(-1).content).error).toContain('unavailable');
    return new Response(data({ content: '该操作不可用。' }) + 'data: [DONE]\n\n');
  });
  const events = await collect(runtime);
  expect(events.some((event) => event.type === 'tool_completed' && event.payload.toolCall.status === 'error')).toBe(true);
  expect(events.at(-1)?.type).toBe('run_completed');
});

test('upstream errors do not echo secrets and context stays bounded', async () => {
  const runtime = model(async (request) => {
    const body = await request.json() as any;
    const context = body.messages.filter((message: any) => message.role !== 'system').map((message: any) => message.content).join('');
    expect(context.length).toBeLessThanOrEqual(32000 + input.content.length);
    return new Response('test-only-secret echoed by provider', { status: 401 });
  }, Array.from({ length: 20 }, (_, i) => ({ ...history[0], id: `message-${i}`, content: 'x'.repeat(16000) })));
  const events = await collect(runtime);
  expect(events.at(-1)?.type).toBe('run_failed');
  expect(JSON.stringify(events)).not.toContain('test-only-secret');
});

test('cancelling interrupts a pending model stream', async () => {
  const runtime = model(() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(data({ content: '正在分析' })));
  } })));
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(input)) {
    events.push(event);
    if (event.type === 'message_delta') await runtime.cancel({ runId: input.runId });
  }
  const last = events.at(-1)!;
  expect(last.type).toBe('run_failed');
  if (last.type === 'run_failed') expect(last.payload.error.code).toBe('RUN_CANCELLED');
});

test('research synthesizer validates structured model JSON', async () => {
  const synthesis: ResearchSynthesis = { summary: '示例证据有限', stance: 'neutral', confidence: 0.4, sections: [
    { key: 'market.quote', title: '行情', verdict: 'neutral', summary: '仅有示例行情。' },
  ], bullCase: [], bearCase: [], catalysts: [], risks: ['数据不完整'] };
  const runtime = model(() => new Response(data({ content: JSON.stringify(synthesis) }) + 'data: [DONE]\n\n'));
  expect(await runtime.synthesize({ symbol: 'AAPL.US', plan: [], records: [] } as unknown as ResearchSynthesisInput)).toEqual(synthesis);
});
