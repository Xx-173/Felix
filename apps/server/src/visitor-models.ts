import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { AgentRuntime, AgentRunInput, CustomProviderConfig, LlmModel, Message, ResearchSynthesisInput } from '@finagent/core';
import { JsonFileStore, LocalRuntimeAdapter, LocalResearchSynthesizer, FinanceToolRegistry, MarketDataService, createCodeError } from '@finagent/shared';
import { ModelRuntime, type ModelConfig } from './model-runtime.ts';

const providerId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine((id) => !['__proto__', 'constructor', 'prototype'].includes(id));
const keySchema = z.string().trim().min(1).max(4096);
const modelId = z.string().trim().min(1).max(160);
const builtin = [
  { name: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-4.1-mini', name: 'GPT-4.1 mini' }, { id: 'gpt-4.1', name: 'GPT-4.1' }] },
  { name: 'deepseek', displayName: '深度求索（DeepSeek）', baseUrl: 'https://api.deepseek.com/v1', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
  { name: 'qwen', displayName: '通义千问（Qwen）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [{ id: 'qwen-plus', name: 'Qwen Plus' }] },
  { name: 'siliconflow', displayName: '硅基流动（SiliconFlow）', baseUrl: 'https://api.siliconflow.cn/v1', models: [{ id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B' }] },
] satisfies CustomProviderConfig[];
const defaultHosts = builtin.map((provider) => new URL(provider.baseUrl).hostname);
type Stored = { credentials: Record<string, { key: string; at: number }>; custom: CustomProviderConfig[]; selected?: { provider: string; id: string }; thinking: string; marketKey?: string };

/** Operator-approved domains, not arbitrary URLs, prevent this public app becoming an SSRF proxy. */
export function approvedModelUrl(value: string, additionalHosts: string[] = []): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.port && url.port !== '443') || ![...defaultHosts, ...additionalHosts].includes(url.hostname.toLowerCase())) {
    throw createCodeError('MODEL_ENDPOINT_NOT_ALLOWED', '模型地址需使用 HTTPS 和管理员允许的服务商域名（HTTPS and an approved provider domain required）。');
  }
  return url.toString().replace(/\/$/, '');
}

export class VisitorModels implements AgentRuntime {
  skillPrompt: (content: string) => string = () => '';
  private data: Stored = { credentials: {}, custom: [], thinking: 'off' };
  private readonly encryptionKey: Buffer;
  private active = new Map<string, AgentRuntime>();
  private writes: Promise<unknown> = Promise.resolve();
  private readonly local: LocalRuntimeAdapter;
  private readonly localResearch = new LocalResearchSynthesizer();
  constructor(private readonly store: JsonFileStore, secret: string, private readonly visitorId: string,
    private readonly tools: FinanceToolRegistry, market: MarketDataService,
    private readonly history: (id: string) => Promise<Message[]>, private readonly hosts: string[] = [], demo = true) {
    this.encryptionKey = createHash('sha256').update(`Felix visitor credentials v1\0${secret}`).digest();
    this.local = new LocalRuntimeAdapter({ registry: tools, marketData: market, demoData: demo });
  }
  async load() {
    const sealed = await this.store.read<{ iv: string; tag: string; data: string } | undefined>('model-vault.json', undefined);
    if (sealed) {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(sealed.iv, 'hex'));
      decipher.setAAD(Buffer.from(this.visitorId));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
      this.data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8'));
    }
  }
  private save() {
    const snapshot = JSON.stringify(this.data);
    const work = this.writes.then(async () => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      cipher.setAAD(Buffer.from(this.visitorId));
      const data = Buffer.concat([cipher.update(snapshot), cipher.final()]).toString('base64');
      await this.store.write('model-vault.json', { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data });
    });
    this.writes = work.catch(() => undefined);
    return work;
  }
  private providers() { return [...builtin, ...this.data.custom]; }
  marketKey() { return this.data.marketKey; }
  async setMarketKey(value?: string) { this.data.marketKey = value === undefined ? undefined : keySchema.parse(value); await this.save(); }
  listModels(): LlmModel[] {
    return this.providers().flatMap((provider) => provider.models.map((model) => ({ ...model, provider: provider.name, api: 'openai-completions' })));
  }
  state(isStreaming = false) {
    const model = this.listModels().find((item) => item.provider === this.data.selected?.provider && item.id === this.data.selected?.id);
    return { runtimeProvider: model ? 'web-api' : 'local', model, thinkingLevel: this.data.thinking, availableThinkingLevels: model?.reasoning ? ['off', 'low', 'medium', 'high'] : [], isStreaming };
  }
  config(provider = this.data.selected?.provider, id = this.data.selected?.id): ModelConfig | undefined {
    if (!provider || !id) return;
    const definition = this.providers().find((item) => item.name === provider);
    const key = this.data.credentials[provider]?.key;
    if (!definition?.models.some((model) => model.id === id) || !key) throw createCodeError('MODEL_KEY_REQUIRED', '请先保存自己的模型密钥（Save your own API key first）。');
    return { baseUrl: approvedModelUrl(definition.baseUrl, this.hosts), apiKey: key, model: id, thinking: this.data.thinking };
  }
  async dispatch(method: string, args: unknown[], busy: boolean): Promise<unknown> {
    if (!['getState', 'listModels', 'listThinkingLevels', 'getProviders', 'listCredentials', 'testProvider'].includes(method) && busy) throw createCodeError('RUN_ACTIVE', '请等当前研究结束后修改模型配置（Wait for the active run）。');
    switch (method) {
      case 'getState': return this.state(busy);
      case 'listModels': return this.listModels();
      case 'listThinkingLevels': return this.state().availableThinkingLevels;
      case 'getProviders': return this.providers().map((item) => ({ provider: item.name, displayName: item.displayName, modelCount: item.models.length, custom: !builtin.some((p) => p.name === item.name), status: this.data.credentials[item.name] ? 'connected' : 'missing_credential' }));
      case 'listCredentials': return this.providers().map((item) => ({ provider: item.name, configured: !!this.data.credentials[item.name], updatedAt: this.data.credentials[item.name]?.at, custom: !builtin.some((p) => p.name === item.name) }));
      case 'setCredential': {
        const provider = providerId.parse(args[0]);
        if (!this.providers().some((item) => item.name === provider)) throw createCodeError('INVALID_ARGUMENT', 'Unknown provider');
        this.data.credentials[provider] = { key: keySchema.parse(args[1]), at: Date.now() };
        if (!this.data.selected) this.data.selected = { provider, id: this.providers().find((p) => p.name === provider)!.models[0].id };
        await this.save(); return;
      }
      case 'removeCredential': {
        const provider = providerId.parse(args[0]); delete this.data.credentials[provider];
        if (this.data.selected?.provider === provider) this.data.selected = undefined;
        await this.save(); return;
      }
      case 'setModel': {
        const provider = providerId.parse(args[0]), id = modelId.parse(args[1]); this.config(provider, id);
        this.data.selected = { provider, id }; this.data.thinking = 'off'; await this.save(); return this.state();
      }
      case 'setThinkingLevel': {
        const level = z.enum(['off', 'low', 'medium', 'high']).parse(args[0]);
        if (level !== 'off' && !this.state().availableThinkingLevels.includes(level)) throw createCodeError('INVALID_ARGUMENT', 'Reasoning is unavailable for this model');
        this.data.thinking = level; await this.save(); return this.state();
      }
      case 'setCustomProvider': {
        const config = z.object({ name: providerId, displayName: z.string().trim().min(1).max(120), baseUrl: z.string().max(500), api: z.literal('openai-completions').optional(), apiKey: keySchema.optional(), models: z.array(z.object({ id: modelId, name: z.string().min(1).max(160), contextWindow: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional(), reasoning: z.boolean().optional() })).min(1).max(20) }).parse(args[0]);
        if (builtin.some((p) => p.name === config.name) || this.data.custom.length >= 10 && !this.data.custom.some((p) => p.name === config.name)) throw createCodeError('INVALID_ARGUMENT', 'Invalid custom provider name or limit');
        config.baseUrl = approvedModelUrl(config.baseUrl, this.hosts);
        const { apiKey, ...publicConfig } = config;
        this.data.custom = [...this.data.custom.filter((p) => p.name !== config.name), publicConfig];
        if (apiKey) this.data.credentials[config.name] = { key: apiKey, at: Date.now() };
        await this.save(); return;
      }
      case 'removeCustomProvider': {
        const provider = providerId.parse(args[0]); this.data.custom = this.data.custom.filter((p) => p.name !== provider); delete this.data.credentials[provider];
        if (this.data.selected?.provider === provider) this.data.selected = undefined;
        await this.save(); return;
      }
      case 'testProvider': {
        const provider = providerId.parse(args[0]), id = modelId.parse(args[1]); const config = this.config(provider, id)!; const start = Date.now();
        try {
          const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 8 }) });
          await response.body?.cancel();
          return { ok: response.ok, provider, modelId: id, latencyMs: Date.now() - start, message: response.ok ? '连接成功（Connected）' : '连接失败，请检查密钥及模型权限（Check your key and model access）。' };
        } catch { return { ok: false, provider, modelId: id, message: '连接失败或超时（Connection failed or timed out）。' }; }
      }
      default: throw createCodeError('WEB_METHOD_UNAVAILABLE', 'Unknown model method');
    }
  }
  async getTools() { return this.local.getTools(); }
  async ensureSession(session: Parameters<AgentRuntime['ensureSession']>[0]) { return this.local.ensureSession(session); }
  async *run(input: AgentRunInput) {
    const config = this.config();
    const runtime = config ? new ModelRuntime(config, this.tools, this.history, this.skillPrompt(input.content)) : this.local;
    this.active.set(input.runId, runtime);
    try { yield* runtime.run(input); } finally { this.active.delete(input.runId); }
  }
  async synthesize(input: ResearchSynthesisInput, signal?: AbortSignal) {
    const config = this.config();
    return config ? new ModelRuntime(config, this.tools, this.history).synthesize(input, signal) : this.localResearch.synthesize(input);
  }
  async cancel(input: { sessionId: string; runId: string }) { await this.active.get(input.runId)?.cancel(input); }
  async dispose() { await Promise.all([...this.active.values()].map((runtime) => runtime.dispose())); await this.writes; }
}
