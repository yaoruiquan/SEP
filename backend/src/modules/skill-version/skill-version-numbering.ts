/**
 * 版本号规则的唯一实现。
 *
 * 曾经有两套：贡献中心按 `1.0.${count}` 数个数，企业侧按 semver 补丁位 +1。
 * 同一张 skill_versions 表两种语义，删掉一个版本就会让贡献中心撞号
 * （count 变小，算出来的号已经存在）。
 *
 * 非 semver 的历史值直接忽略，不参与比较 —— 它们排不出大小，
 * 强行解析只会得出随机结论。
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function nextSemver(versions: readonly string[]): string {
  const parsed = versions
    .map((version) => version.match(SEMVER)?.slice(1).map(Number))
    .filter((parts): parts is number[] => Boolean(parts))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);

  if (parsed.length === 0) return '1.0.0';
  const [major, minor, patch] = parsed[0];
  return `${major}.${minor}.${patch + 1}`;
}
