import { expect, test } from 'bun:test';
import { createSyncI18n } from './i18n.ts';
import { bilingualResources } from './bilingual.ts';
import { resources, flattenLocale, interpolationVars } from './resources.ts';

test('renderer pairs Chinese first and English second for both locale preferences', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const i18n = createSyncI18n({ locale, bilingual: true });
    expect(i18n.t('navigation.settings')).toBe('设置（Settings）');
    expect(i18n.t('navigation.newSession')).toBe('新建会话（New Session）');
    expect(i18n.t('navigation.deleteSession', { title: 'My untouched note' })).toContain('My untouched note');
  }
  expect(createSyncI18n({ locale: 'en-US' }).t('navigation.settings')).toBe('Settings');
});

test('paired resources preserve all namespaces, keys and interpolation variables', () => {
  expect(Object.keys(bilingualResources['zh-CN'])).toEqual(Object.keys(resources['zh-CN']));
  for (const [key, value] of Object.entries(flattenLocale('zh-CN'))) {
    const paired = key.split('.').reduce<any>((table, part) => table[part], bilingualResources['zh-CN']);
    expect(typeof paired === 'string' || Array.isArray(paired)).toBe(true);
    expect(interpolationVars(typeof paired === 'string' ? paired : JSON.stringify(paired)).sort()).toEqual(interpolationVars(value).sort());
  }
});
