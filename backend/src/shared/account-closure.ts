import { z } from 'zod';

export const AccountClosureTokenSchema = z.object({ token: z.string().min(32).max(256) });
export const AccountClosureRequestSchema = AccountClosureTokenSchema.extend({
  confirmation: z.literal('注销账号'),
});
export type AccountClosureRequestDto = z.infer<typeof AccountClosureRequestSchema>;
export type AccountClosureTokenDto = z.infer<typeof AccountClosureTokenSchema>;

export interface AccountClosureEligibility {
  eligible: boolean;
  enterprisesToClose: { id: string; name: string }[];
  blockers: { code: string; message: string }[];
}

export interface AccountClosureResult {
  status: 'CLOSED';
  closedAt: string;
  closedEnterprises: { id: string; name: string }[];
}
