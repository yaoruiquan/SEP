import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

/**
 * DI 图探针。
 *
 * providers / imports 漏了一项时，`tsc` 看不出来（构造函数签名是对的），
 * 普通单测也看不出来（都是手 new 服务、自己传 mock）。只有真让 Nest 解析
 * 一遍依赖图才会报 "Nest can't resolve dependencies of ..."。
 *
 * 这里只 compile()、不 init()：compile 会完整解析依赖图，但不触发
 * onModuleInit，所以不连 Postgres、不起 BullMQ Worker，跑起来零 I/O。
 * PrismaService 与 RedisService 仍然要 override —— 它们的构造函数会建客户端。
 */
describe('AppModule 依赖图', () => {
  it('所有模块的依赖都能解析', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService)
      .useValue({ getClient: jest.fn() })
      .compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  }, 60_000);
});
