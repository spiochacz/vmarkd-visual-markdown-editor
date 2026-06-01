const Langs = {
  en_US: {
    save: 'Save',
    wikiFile: 'Wiki File',
    wikiPages: 'Wiki Pages',
    navigateBack: 'Go Back',
    editInVsCode: 'Edit In VS Code',
    copyMarkdown: 'Copy Markdown',
    copyHtml: 'Copy HTML',
    resetConfig: 'Reset config',
    resetConfirm: "Are you sure to reset the markdown-editor's config?",
    alignLeft: 'Left',
    alignCenter: 'Center',
    alignRight: 'Right',
    insertRowAbove: 'Insert 1 above',
    insertRowBelow: 'Insert 1 below',
    insertColumnLeft: 'Insert 1 left',
    insertColumnRight: 'Insert 1 right',
    deleteRow: 'Delete Row',
    deleteColumn: 'Delete Column',
  },
  ja_JP: {
    save: '保存する',
  },
  ko_KR: {
    save: '저장',
  },
  zh_CN: {
    save: '保存',
    wikiFile: 'Wiki 文件',
    wikiPages: 'Wiki 页面',
    navigateBack: '返回',
    editInVsCode: '在 VS Code 中编辑',
    copyMarkdown: '复制 Markdown',
    copyHtml: '复制 HTML',
    resetConfig: '重置配置',
    resetConfirm: '确定要重置 markdown-editor 的配置么?',
    alignLeft: '左对齐',
    alignCenter: '居中',
    alignRight: '右对齐',
    insertRowAbove: '向上插入一行',
    insertRowBelow: '向下插入一行',
    insertColumnLeft: '向左插入一列',
    insertColumnRight: '向右插入一列',
    deleteRow: '删除行',
    deleteColumn: '删除列',
  },
}

export const lang = (() => {
  let l: any = navigator.language.replace('-', '_')
  if (!Langs[l]) {
    l = 'en_US'
  }
  return l
})()

export function t(msg: string) {
  return Langs[lang]?.[msg] || Langs.en_US[msg]
}
