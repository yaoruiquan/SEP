/**
 * 行级差异，只保留变化行及其上下文。
 *
 * 不引 diff 库：技能正文的差异展示只需要「哪几行变了」，一个 LCS 表就够，
 * 加一个依赖换 40 行代码不值得。上下文行数固定 2 —— 再多就把「改了哪」淹没了。
 */

export type DiffRowType = 'same' | 'added' | 'removed' | 'gap';

export interface DiffRow {
  type: DiffRowType;
  text: string;
}

const CONTEXT_LINES = 2;

export function diffLines(baseline: string, current: string): DiffRow[] {
  const a = baseline.split('\n');
  const b = current.split('\n');

  // LCS 长度表。技能正文按 500KB 上限算最多几千行，O(n·m) 在浏览器里可接受；
  // 真到几万行时这里会卡，但那样的 SKILL.md 本身已经不可维护了。
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const full: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      full.push({ type: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      full.push({ type: 'removed', text: a[i] });
      i += 1;
    } else {
      full.push({ type: 'added', text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    full.push({ type: 'removed', text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    full.push({ type: 'added', text: b[j] });
    j += 1;
  }

  return collapseUnchanged(full);
}

/** 把连续的未变行折叠成一个 gap 标记，只留变化行周围 CONTEXT_LINES 行。 */
function collapseUnchanged(rows: DiffRow[]): DiffRow[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.type === 'same') return;
    for (let offset = -CONTEXT_LINES; offset <= CONTEXT_LINES; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < rows.length) keep.add(target);
    }
  });

  const out: DiffRow[] = [];
  let gapOpen = false;
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      out.push(row);
      gapOpen = false;
      return;
    }
    if (!gapOpen) {
      out.push({ type: 'gap', text: '' });
      gapOpen = true;
    }
  });
  return out;
}
