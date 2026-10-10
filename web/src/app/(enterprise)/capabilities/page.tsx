'use client';

import { CapabilityIterationList } from '@/features/capability-iteration/capability-iteration-list';
import { nav } from '@/locales/zh-CN';
import { PageFrame } from '@/components/page/page-frame';
import { PageHero } from '@/components/page/page-hero';

/** 企业技能版本查看、审核与启用。 */
export default function CapabilitiesPage() {
  return (
    <PageFrame>
      <PageHero title={nav.capabilities} />

      <CapabilityIterationList />
    </PageFrame>
  );
}
