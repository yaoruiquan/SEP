import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';

/**
 * Zod 校验管道。
 *
 * 为什么需要它：`shared` 里的 DTO 是 `z.infer<>` 推导出的 **TypeScript 类型**，
 * 编译后不存在，也没有 class-validator 装饰器。全局的 `ValidationPipe`
 * 对这类 DTO 无从校验，请求会带着缺失/非法字段一路落到 Prisma，
 * 最终抛出 500 —— 而这本该是 400。
 *
 * 用法：`@Body(new ZodValidationPipe(RegisterDtoSchema)) dto: RegisterDto`
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // 汇总所有字段错误，而非只报第一个 —— 前端可一次性标出所有问题
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)',
        message: i.message,
      }));
      throw new BadRequestException({
        message: '请求参数校验失败',
        errors: details,
      });
    }

    // 返回 parse 后的值：Zod 会剥离未声明字段，
    // 这同时挡住了「客户端塞 enterpriseId 试图指定别家企业」这类构造
    return result.data;
  }
}
