import { z } from 'zod';

export const INVITATION_NEXT_ACTIONS = ['REGISTER', 'LOGIN', 'CONTACT_SUPPORT'] as const;
export const InvitationNextActionSchema = z.enum(INVITATION_NEXT_ACTIONS);
export type InvitationNextAction = z.infer<typeof InvitationNextActionSchema>;
