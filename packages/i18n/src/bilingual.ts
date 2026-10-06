import { resources, type I18nResources } from './resources.ts';

/** Only built-in UI resources are paired; user notes and model answers stay intact. */
function pair(chinese: unknown, english: unknown): unknown {
  if (Array.isArray(chinese) && Array.isArray(english)) return chinese.map((item, index) => pair(item, english[index]));
  if (typeof chinese === 'string' && typeof english === 'string') {
    return chinese === english || !/[A-Za-z]/.test(english)
      ? chinese : `${chinese}（${english}）`;
  }
  if (chinese && typeof chinese === 'object' && english && typeof english === 'object') {
    return Object.fromEntries(Object.entries(chinese).map(([key, value]) =>
      [key, pair(value, (english as Record<string, unknown>)[key])]));
  }
  return chinese;
}
const paired = pair(resources['zh-CN'], resources['en-US']) as I18nResources['zh-CN'];
export const bilingualResources: I18nResources = { 'zh-CN': paired, 'en-US': paired };
