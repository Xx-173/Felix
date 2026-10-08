// Assertions accept an optional technical gloss while checking the Chinese label.
const renamed = {
  '运行': '开始筛选', '运行中…': '筛选中…', '重新运行': '重新筛选',
  '安装 / 设置': '安装并连接', '机构研究': '投资研究',
  '我的自选表现如何？': '我的自选表现如何？',
};
export function uiText(value) {
  if (typeof value !== 'string' || !/[\u4e00-\u9fff]/.test(value)) return value;
  const chinese = value.replace(/\s*[（(][^（）()]*[A-Za-z][^（）()]*[）)]$/, '').trim();
  const label = renamed[chinese] ?? chinese;
  return new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s*[（(][^（）()]*[）)])?$');
}
