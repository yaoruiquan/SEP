import { redirect } from 'next/navigation';

/**
 * 兼容旧书签与员工详情页链接。
 *
 * 原先跳「能力贡献中心」，现在跳「能力迭代」—— 从员工详情点进来的人想做的是
 * 「改这个技能」，不是「向平台投稿」。
 */
export default function EnterpriseSkillsPage() {
  redirect('/capabilities');
}
