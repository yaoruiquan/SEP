import { beforeEach, describe, expect, it, vi } from 'vitest';
import SkillReviewsPage from './page';

const { redirect } = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));

beforeEach(() => vi.clearAllMocks());

describe('旧技能审核路由', () => {
  it('无技能参数跳转技能库', async () => {
    await SkillReviewsPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/capabilities');
  });
  it('指定技能跳转对应大家的改动', async () => {
    await SkillReviewsPage({ searchParams: Promise.resolve({ capabilityId: 'cap-1' }) });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/capabilities/cap-1?tab=changes');
  });
  it('重复参数回退技能库，不构造含糊路由', async () => {
    await SkillReviewsPage({ searchParams: Promise.resolve({ capabilityId: ['cap-1', 'cap-2'] }) });
    expect(redirect).toHaveBeenCalledExactlyOnceWith('/capabilities');
  });
});
