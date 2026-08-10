/**
 * 从用户粘贴的内容里取出邀请 token。
 *
 * 为什么需要它：MVP 不发邮件，管理员通过微信/钉钉转达的是一整条链接
 * （`https://host/join?token=abc`）。若输入框只接受裸 token，用户得自己
 * 从 URL 里抠出 `?token=` 后面那段 —— 一个纯粹由实现细节造成的操作。
 *
 * 三种输入都吃：
 *   - 完整 URL：`https://host/join?token=abc`
 *   - 路径片段：`/join?token=abc`
 *   - 裸 token：`abc`
 *
 * 拿不到就返回 null，由调用方决定是禁用按钮还是提示 ——
 * 这里**不**对 token 本身做格式校验：有效性只有后端能判定，
 * 前端多加一层格式假设，只会在后端换 token 生成方式时静默拦掉合法链接。
 */
export function extractInviteToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 有 query string 的一律按 URL 处理。用一个固定 base 解析相对路径，
  // 这样 `/join?token=x` 和完整 URL 走同一条分支。
  if (trimmed.includes('token=')) {
    try {
      const url = new URL(trimmed, 'http://localhost');
      const token = url.searchParams.get('token');
      return token && token.trim() ? token.trim() : null;
    } catch {
      return null;
    }
  }

  // 裸 token：不该含空白或 URL 分隔符，含了说明粘错了东西
  if (/[\s/?#&]/.test(trimmed)) return null;
  return trimmed;
}
