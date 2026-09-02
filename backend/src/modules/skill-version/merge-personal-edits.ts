/**
 * 多人个人副本的合并。
 *
 * 「一键采纳多人改动」（会议纪要2 §6.4）真正的难点在这里：两位成员各自基于同一个
 * 企业基线改了自己的副本，采纳时要得到一份**同时包含两人改动**的正文。
 *
 * 最初的实现是「按更新时间取最后一条的正文」—— 那会让「采纳 2 条」实际只生效 1 条，
 * 另一个人的改动被静默丢掉，而变更说明里却写着两个人的名字。这比合并出错更糟：
 * 界面说做了，实际没做。
 *
 * 这里做的是**行级并集合并**，以 diff hunk 为单位：
 *   - 纯新增：所有人的新增都保留（同一行内容只留一份）
 *   - 只有一人改动的区间：按他的改
 *   - 多人改同一区间且改得不一样：两份都留在正文里，并记入 `conflicts`
 *     让界面提示管理员复核
 *
 * 它不理解语义，所以刻意不做「智能三方合并」—— 猜错了会产出一份没人写过的技能正文，
 * 那比让管理员自己看更危险。
 */

export interface MergeSource {
  /** 展示用标签（成员名），出现在冲突报告里 */
  label: string;
  content: string;
}

/** 基线 [start, end) 被替换成 replacement。start === end 表示纯插入。 */
interface Hunk {
  label: string;
  start: number;
  end: number;
  replacement: string[];
}

export interface MergeConflict {
  /** 冲突区间在基线中的起始行号（1 起） */
  line: number;
  baselineText: string;
  /** 各方在这一处给出的不同内容 */
  variants: Array<{ label: string; text: string }>;
}

export interface MergeResult {
  content: string;
  conflicts: MergeConflict[];
}

/**
 * 把一份副本相对基线的改动拆成 hunk 列表。
 *
 * 用 LCS 而不是逐行比对：逐行比对会把「在开头插入一段」误判成「整篇都改了」，
 * 合并结果就变成两份正文首尾相接。
 */
function buildHunks(label: string, baseline: string[], current: string[]): Hunk[] {
  const n = baseline.length;
  const m = current.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        baseline[i] === current[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  // 累积一个连续的改动块，直到重新对齐上基线才收口 ——
  // 「删一行 + 加一行」必须是同一个 hunk，否则冲突检测会错位到相邻行
  let pending: { start: number; end: number; replacement: string[] } | null = null;
  const flush = () => {
    if (pending) {
      hunks.push({ label, ...pending });
      pending = null;
    }
  };
  const touch = () => {
    pending ??= { start: i, end: i, replacement: [] };
    return pending;
  };

  while (i < n && j < m) {
    if (baseline[i] === current[j]) {
      flush();
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      touch().end = i + 1;
      i += 1;
    } else {
      touch().replacement.push(current[j]);
      j += 1;
    }
  }
  while (i < n) {
    touch().end = i + 1;
    i += 1;
  }
  while (j < m) {
    touch().replacement.push(current[j]);
    j += 1;
  }
  flush();

  return hunks;
}

/**
 * 合并多份个人副本。
 *
 * `sources` 的顺序即优先级：调用方按 updatedAt 升序传入，于是冲突时「最近改的」
 * 排在后面，与用户直觉一致。
 */
export function mergePersonalEdits(baselineContent: string, sources: MergeSource[]): MergeResult {
  if (sources.length === 0) return { content: baselineContent, conflicts: [] };
  if (sources.length === 1) return { content: sources[0].content, conflicts: [] };

  const baseline = baselineContent.split('\n');
  const hunks = sources.flatMap((source) =>
    buildHunks(source.label, baseline, source.content.split('\n')),
  );

  const out: string[] = [];
  const conflicts: MergeConflict[] = [];
  let cursor = 0;

  while (cursor <= baseline.length) {
    // 纯插入（start === end === cursor）：所有人的都保留，同内容只留一份
    const inserts = hunks.filter((hunk) => hunk.start === cursor && hunk.end === cursor);
    const seen = new Set<string>();
    for (const hunk of inserts) {
      for (const text of hunk.replacement) {
        if (seen.has(text)) continue;
        seen.add(text);
        out.push(text);
      }
    }

    if (cursor === baseline.length) break;

    // 覆盖当前行的替换/删除 hunk
    const covering = hunks.filter((hunk) => hunk.start <= cursor && hunk.end > cursor);
    if (covering.length === 0) {
      out.push(baseline[cursor]);
      cursor += 1;
      continue;
    }

    // 这一区间由多人改动 —— 取并集区间，把每一方的版本都放进正文并记录冲突
    const rangeEnd = Math.max(...covering.map((hunk) => hunk.end));
    const distinct = new Map<string, string[]>();
    for (const hunk of covering) {
      const key = hunk.replacement.join('\n');
      if (!distinct.has(key)) distinct.set(key, hunk.replacement);
    }

    if (distinct.size > 1) {
      conflicts.push({
        line: cursor + 1,
        baselineText: baseline.slice(cursor, rangeEnd).join('\n'),
        variants: covering.map((hunk) => ({
          label: hunk.label,
          text: hunk.replacement.join('\n'),
        })),
      });
    }

    for (const replacement of distinct.values()) out.push(...replacement);
    cursor = rangeEnd;
  }

  return { content: out.join('\n'), conflicts };
}
