import { z } from 'zod';

export const SKILL_CONTENT_MAX_BYTES = 500 * 1024;

export const SkillContentSchema = z.string()
  .refine((content) => content.trim().length > 0, '技能正文不能为空')
  .refine((content) => new TextEncoder().encode(content).byteLength <= SKILL_CONTENT_MAX_BYTES,
    '技能正文不能超过 500KiB（UTF-8）');
