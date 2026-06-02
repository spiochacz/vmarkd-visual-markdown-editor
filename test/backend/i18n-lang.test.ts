import { describe, expect, it } from 'vitest'
import { resolveVditorI18nLang } from '../../src/extension'

// resolveVditorI18nLang maps the VS Code UI language (vscode.env.language) to the
// closest Vditor i18n bundle name, so the host can inject the matching <script>.
describe('resolveVditorI18nLang', () => {
  it('maps simple base languages to their regioned bundle', () => {
    expect(resolveVditorI18nLang('en')).toBe('en_US')
    expect(resolveVditorI18nLang('de')).toBe('de_DE')
    expect(resolveVditorI18nLang('fr')).toBe('fr_FR')
    expect(resolveVditorI18nLang('ja')).toBe('ja_JP')
    expect(resolveVditorI18nLang('ko')).toBe('ko_KR')
    expect(resolveVditorI18nLang('ru')).toBe('ru_RU')
    expect(resolveVditorI18nLang('es')).toBe('es_ES')
    expect(resolveVditorI18nLang('sv')).toBe('sv_SE')
    expect(resolveVditorI18nLang('vi')).toBe('vi_VN')
    expect(resolveVditorI18nLang('pt')).toBe('pt_BR')
  })

  it('ignores the region for base-mapped languages (en-GB -> en_US)', () => {
    expect(resolveVditorI18nLang('en-GB')).toBe('en_US')
    expect(resolveVditorI18nLang('pt-PT')).toBe('pt_BR')
  })

  it('distinguishes Chinese variants', () => {
    expect(resolveVditorI18nLang('zh-cn')).toBe('zh_CN')
    expect(resolveVditorI18nLang('zh-hans')).toBe('zh_CN')
    expect(resolveVditorI18nLang('zh')).toBe('zh_CN')
    expect(resolveVditorI18nLang('zh-tw')).toBe('zh_TW')
    expect(resolveVditorI18nLang('zh-hant')).toBe('zh_TW')
  })

  it('normalizes case and underscore separators', () => {
    expect(resolveVditorI18nLang('EN')).toBe('en_US')
    expect(resolveVditorI18nLang('zh_TW')).toBe('zh_TW')
    expect(resolveVditorI18nLang('PT-br')).toBe('pt_BR')
  })

  it('falls back to en_US for unknown or missing languages', () => {
    expect(resolveVditorI18nLang(undefined)).toBe('en_US')
    expect(resolveVditorI18nLang('')).toBe('en_US')
    expect(resolveVditorI18nLang('xx')).toBe('en_US')
    expect(resolveVditorI18nLang('klingon')).toBe('en_US')
  })
})
