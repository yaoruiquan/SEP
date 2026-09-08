import type { Subscription, SubscriptionStatus } from '@/lib/types';

export const TRIAL_DAYS = 7;

/** 与后端 terminate() 对齐，仅用于确认弹窗展示预计退款金额。 */
export function getExpectedRefund(
  subscription: Pick<Subscription, 'status' | 'startDate'> & {
    employee: Pick<Subscription['employee'], 'annualPriceCNY'>;
  },
  now = new Date(),
): number {
  const eligible: SubscriptionStatus[] = ['ACTIVE', 'PAUSED'];
  if (!eligible.includes(subscription.status)) return 0;

  const annualPrice = subscription.employee.annualPriceCNY;
  if (!annualPrice || !subscription.startDate) return 0;

  const trialEnd = new Date(subscription.startDate);
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);
  return now <= trialEnd ? Number(annualPrice) : 0;
}
