import { describe, expect, it } from 'vitest';
import { extractInviteToken } from './invite-token';

/**
 * 邀请码提取。
 *
 * 这个函数存在只是为了消化"管理员通过微信转达一整条链接"这个现实 ——
 * 但它同时是 token 进入系统的入口，所以两头都要守：
 * 认得出链接里的 token，也不能把明显不是 token 的东西（带空格的一段话、
 * 忘了填的空串）当成 token 发给后端。
 */
describe('extractInviteToken', () => {
  it('从完整 URL 里取出 token', () => {
    expect(extractInviteToken('https://sep.example.com/join?token=abc123')).toBe(
      'abc123',
    );
    // 端口、其他 query 参数都不该干扰
    expect(
      extractInviteToken('http://localhost:3000/join?token=abc123&from=wecom'),
    ).toBe('abc123');
  });

  it('从相对路径里取出 token', () => {
    expect(extractInviteToken('/join?token=abc123')).toBe('abc123');
    expect(extractInviteToken('join?token=abc123')).toBe('abc123');
  });

  it('裸 token 原样返回', () => {
    expect(extractInviteToken('abc123')).toBe('abc123');
    expect(extractInviteToken('  abc123  ')).toBe('abc123');
  });

  it('URL 编码的 token 被解码 —— searchParams 已经做了这件事', () => {
    expect(extractInviteToken('/join?token=a%2Bb%3Dc')).toBe('a+b=c');
  });

  it('空值返回 null', () => {
    expect(extractInviteToken('')).toBeNull();
    expect(extractInviteToken('   ')).toBeNull();
  });

  it('token= 存在但值为空 → null，不要给后端发空 token', () => {
    expect(extractInviteToken('/join?token=')).toBeNull();
    expect(extractInviteToken('https://host/join?token=')).toBeNull();
  });

  it('含空白或 URL 分隔符的裸串不当作 token —— 那是粘错了东西', () => {
    expect(extractInviteToken('abc 123')).toBeNull();
    expect(extractInviteToken('请 点击 这个链接')).toBeNull();
    expect(extractInviteToken('https://sep.example.com/join')).toBeNull();
    expect(extractInviteToken('/join')).toBeNull();
    expect(extractInviteToken('join#anchor')).toBeNull();
  });

  it('无分隔符的普通文本仍当作 token 透传 —— 这是有意的', () => {
    // 「请点击这个链接」既没空白也没分隔符，前端无从判断它不是 token。
    // 想在这里加字符集白名单，就等于对后端的 token 生成方式做假设 ——
    // 无效 token 的裁决权在后端（统一 400），不在这里。
    expect(extractInviteToken('请点击这个链接')).toBe('请点击这个链接');
  });

  it('不对 token 本身做格式假设 —— 有效性只有后端能判定', () => {
    // 后端换 token 生成方式（长度/字符集）时，这里不该静默拦掉合法链接
    expect(extractInviteToken('a')).toBe('a');
    expect(extractInviteToken('A'.repeat(200))).toBe('A'.repeat(200));
    expect(extractInviteToken('tok_en-with.mixed~chars')).toBe(
      'tok_en-with.mixed~chars',
    );
  });
});
