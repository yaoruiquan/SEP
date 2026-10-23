import { z } from 'zod';

export const AccountClosureTokenSchema = z.object({ token: z.string().min(32).max(256) });
export const AccountClosureRequestSchema = AccountClosureTokenSchema.extend({
  confirmation: z.literal('注销账号'),
});
export type AccountClosureRequestDto = z.infer<typeof AccountClosureRequestSchema>;
export type AccountClosureTokenDto = z.infer<typeof AccountClosureTokenSchema>;

export interface AccountClosureEligibility {
  eligible: boolean;
  gracePeriodDays: number;
  blockers: { code: string; message: string }[];
}

export interface AccountClosureResult {
  requestId: string;
  status: 'PENDING';
  scheduledFor: string;
}
