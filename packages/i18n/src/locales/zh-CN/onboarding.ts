import type { SameKeysAs } from '../keys.ts';
import type { onboarding as enOnboarding } from '../en-US/onboarding.ts';

/** First-run onboarding — Simplified Chinese (spec §27–30, §71–72). Provider/model ids stay untranslated (§11). */
export const onboarding = {
  setupAria: 'Felix 设置',
  setupTitle: '设置 Felix',
  stepPrefix: '第 {{index}} 步，共 {{total}} 步',
  skip: '暂时跳过',
  back: '返回',
  continue: '继续',
  startFelix: '开始使用 Felix',
  language: '语言',
  welcome: {
    title: '欢迎使用 Felix',
    titleShort: '欢迎',
    subtitle:
      '按步骤连接 AI 和行情数据源，也可以先跳过，稍后在设置中补充。',
    accept: '我理解并接受这些条款。',
    disclaimerPrivacyTitle: '隐私',
    disclaimerPrivacyBody:
      'Felix 在本地设备上运行。API 密钥和凭据存储在你的机器上，绝不会被共享。市场数据服务商只会收到通过你自己的账户发起的请求。',
    disclaimerAiTitle: 'AI 分析',
    disclaimerAiBody:
      'AI 生成的分析仅供参考，可能不准确或不完整。在依赖其结论前请务必核实。',
    disclaimerFinancialTitle: '金融信息',
    disclaimerFinancialBody:
      'Felix 中的任何内容均不构成投资建议。市场数据可能有延迟。你对自身的投资决策负全部责任。',
  },
  connectAi: {
    title: '连接 AI',
    titleShort: '连接 AI',
    subtitle: '选择模型服务商，填写密钥，再选择要使用的模型。',
    model: '模型',
    providersCredentials: '服务商与凭据',
    loadingProviders: '正在加载服务商…',
    configured: '已配置',
    apiKey: 'API 密钥',
    save: '保存',
    test: '测试',
  },
  providerStep: {
    notAvailable:
      '这个服务商暂时不可用，可稍后到设置中的数据源页面重新连接。',
    recommended: '推荐',
  },
  broker: {
    title: '券商账户（可选）',
    titleShort: '券商账户',
    subtitle: '连接你的 Longbridge 券商账户以获取投资组合、持仓和现金流。',
  },
  connectData: {
    title: '连接金融数据',
    titleShort: '连接金融数据',
    subtitle: 'Longbridge 提供美国、香港、中国大陆和新加坡市场的行情、K 线与公司数据。',
  },
  environment: {
    title: '检查环境',
    titleShort: '检查环境',
    subtitle: '检查 AI 和数据源是否连接成功。',
    checking: '正在检查环境…',
    notAvailable: '此版本中健康检查尚不可用。',
    ready: '就绪',
    unavailable: '不可用',
    itemAi: 'AI',
    itemMarketData: '市场数据',
    itemSkills: '技能',
    itemAgentRuntime: 'AI 服务',
  },
} satisfies SameKeysAs<typeof enOnboarding>;
