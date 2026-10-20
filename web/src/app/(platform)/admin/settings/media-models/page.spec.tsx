import { describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import LegacyMediaModelsPage from './page';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

describe('legacy media models route', () => {
  it('redirects directly to the unified model tabs without routing back to itself', () => {
    LegacyMediaModelsPage();
    expect(redirect).toHaveBeenCalledWith('/admin/settings?tab=models&modelTab=image');
  });
});
