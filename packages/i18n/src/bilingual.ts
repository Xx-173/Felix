import { resources, type I18nResources } from './resources.ts';

/** English glosses are reserved for navigation and useful technical terms.
 * Instructions, actions, errors and assistant prompts remain natural Chinese. */
const ENGLISH_GLOSSES = new Set([
  'navigation.today', 'navigation.indices', 'navigation.discover', 'navigation.workspace',
  'navigation.watchlist', 'navigation.portfolio', 'navigation.compare', 'navigation.alerts',
  'navigation.research', 'navigation.thesis', 'navigation.events', 'navigation.profile', 'navigation.settings',
  'settings.menu.connections', 'settings.menu.llm', 'settings.menu.skills',
  'settings.model.apiKey', 'settings.model.baseUrl', 'settings.model.modelId',
  'settings.model.contextWindowOptional', 'connections.apiKey',
  'research.deepResearch', 'research.confidence', 'research.focus.epsForecasts',
  'discover.metric.pe', 'discover.metric.pb', 'discover.metric.roe',
  'compare.metrics.pe', 'compare.metrics.pb', 'compare.metrics.roe',
]);

/** Only built-in UI resources are paired; user notes and model answers stay intact. */
function pair(chinese: unknown, english: unknown, path = ''): unknown {
  if (Array.isArray(chinese) && Array.isArray(english)) return chinese.map((item, index) => pair(item, english[index], `${path}.${index}`));
  if (typeof chinese === 'string' && typeof english === 'string') {
    return !ENGLISH_GLOSSES.has(path) || chinese === english || !/[A-Za-z]/.test(english)
      ? chinese : `${chinese}（${english}）`;
  }
  if (chinese && typeof chinese === 'object' && english && typeof english === 'object') {
    return Object.fromEntries(Object.entries(chinese).map(([key, value]) =>
      [key, pair(value, (english as Record<string, unknown>)[key], path ? `${path}.${key}` : key)]));
  }
  return chinese;
}
const paired = pair(resources['zh-CN'], resources['en-US']) as I18nResources['zh-CN'];
export const bilingualResources: I18nResources = { 'zh-CN': paired, 'en-US': paired };
