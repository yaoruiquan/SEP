import type { Department } from '@/lib/types';

/**
 * 把部门树压成带层级前缀的扁平列表，供 <select> 使用。
 * 「技术部 / 前端组」这样的标签能让人看出层级，而 <option> 里没法缩进。
 */
export function flattenDepts(
  depts: Department[],
  prefix = '',
): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  for (const d of depts) {
    const label = prefix ? `${prefix} / ${d.name}` : d.name;
    result.push({ id: d.id, label });
    result.push(...flattenDepts(d.children, label));
  }
  return result;
}
