import { describe, expect, it } from 'vitest';
import { safeRedirect } from './use-auth';

/**
 * 开放重定向防护。
 *
 * 这些不是理论上的攻击面：登录页的 ?redirect= 参数任何人都能构造并发给
 * 受害者，跳转发生在**刚提交完密码**的时刻，是钓鱼的理想位置。
 * 放宽这里的任何一条断言前，先想清楚对应的变体为什么安全。
 */
describe('safeRedirect', () => {
  it('放行站内绝对路径', () => {
    expect(safeRedirect('/marketplace/emp-1')).toBe('/marketplace/emp-1');
    expect(safeRedirect('/dashboard')).toBe('/dashboard');
    expect(safeRedirect('/login?next=1')).toBe('/login?next=1');
  });

  it('空值一律返回 null（调用方回落到按角色落地）', () => {
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect('')).toBeNull();
  });

  it('拦住绝对 URL —— 会把用户带出站', () => {
    expect(safeRedirect('https://evil.com')).toBeNull();
    expect(safeRedirect('http://evil.com/path')).toBeNull();
  });

  it('拦住协议相对 URL —— 浏览器按跨站处理，最易被漏掉的一类', () => {
    expect(safeRedirect('//evil.com')).toBeNull();
    expect(safeRedirect('//evil.com/path')).toBeNull();
  });

  it('拦住伪协议', () => {
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('拦住无前导斜杠的相对路径与反斜杠变体', () => {
    expect(safeRedirect('dashboard')).toBeNull();
    expect(safeRedirect('\\\\evil.com')).toBeNull();
  });
});
