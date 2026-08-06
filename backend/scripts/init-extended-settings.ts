import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EXTENDED_SETTINGS = [
  // 平台基础信息
  { key: 'PLATFORM_NAME', label: '平台名称', value: '硅基人才平台', secret: false },
  { key: 'PLATFORM_LOGO_URL', label: '平台Logo地址', value: '', secret: false },
  { key: 'SUPPORT_EMAIL', label: '客服邮箱', value: 'support@sep.local', secret: false },
  { key: 'SUPPORT_PHONE', label: '客服电话', value: '', secret: false },
  { key: 'ICP_NUMBER', label: '备案号', value: '', secret: false },

  // 计费配置
  { key: 'FALLBACK_PRICE_INPUT', label: '保底计费-输入价格 (元/1K tokens)', value: '0.001', secret: false },
  { key: 'FALLBACK_PRICE_OUTPUT', label: '保底计费-输出价格 (元/1K tokens)', value: '0.002', secret: false },
  { key: 'NEW_ENTERPRISE_GIFT_TOKENS', label: '新企业赠送额度 (tokens)', value: '100000', secret: false },
  { key: 'LOW_BALANCE_THRESHOLD', label: '低余额告警阈值 (tokens)', value: '10000', secret: false },

  // 安全与限制
  { key: 'MAX_TOKENS_PER_CONVERSATION', label: '单次对话最大tokens', value: '32000', secret: false },
  { key: 'MAX_CONCURRENT_SESSIONS', label: '单企业并发会话数 (0=不限制)', value: '10', secret: false },
  { key: 'ADMIN_IP_WHITELIST', label: '管理员IP白名单 (逗号分隔)', value: '', secret: false },

  // 注册与审核
  { key: 'ENTERPRISE_REGISTRATION_APPROVAL', label: '企业注册需人工审核', value: 'true', secret: false },
  { key: 'SEND_WELCOME_EMAIL', label: '审核通过发送欢迎邮件', value: 'false', secret: false },

  // 内容审核
  { key: 'CONTENT_FILTER_ENABLED', label: '敏感词过滤开关', value: 'false', secret: false },

  // 数据保留
  { key: 'CONVERSATION_RETENTION_DAYS', label: '对话记录保留天数 (0=永久)', value: '90', secret: false },
  { key: 'OPERATION_LOG_RETENTION_DAYS', label: '操作日志保留天数 (0=永久)', value: '180', secret: false },
  { key: 'SOFT_DELETE_RETENTION_DAYS', label: '软删除数据保留天数', value: '30', secret: false },

  // 性能与缓存
  { key: 'REDIS_CACHE_ENABLED', label: 'Redis缓存开关', value: 'true', secret: false },
  { key: 'CONVERSATION_CACHE_TTL', label: '对话历史缓存时长 (秒)', value: '3600', secret: false },
  { key: 'MODEL_RESPONSE_TIMEOUT', label: '模型响应超时 (秒)', value: '120', secret: false },

  // 通知配置
  { key: 'ADMIN_NOTIFICATION_EMAIL', label: '管理员通知邮箱', value: '', secret: false },
  { key: 'ABNORMAL_USAGE_THRESHOLD', label: '异常消耗告警阈值 (单小时tokens)', value: '100000', secret: false },
  { key: 'SYSTEM_MAINTENANCE_NOTICE', label: '系统维护公告', value: '', secret: false },
];

async function main() {
  console.log('开始初始化扩展配置项...');

  let created = 0;
  let skipped = 0;

  for (const setting of EXTENDED_SETTINGS) {
    try {
      const existing = await prisma.setting.findUnique({
        where: { key: setting.key },
      });

      if (existing) {
        console.log(`⏭️  配置 ${setting.key} 已存在，跳过`);
        skipped++;
        continue;
      }

      await prisma.setting.create({
        data: setting,
      });
      console.log(`✅ 创建配置 ${setting.key}`);
      created++;
    } catch (error) {
      console.error(`❌ 创建配置 ${setting.key} 失败:`, error);
    }
  }

  console.log(`\n配置初始化完成！新增 ${created} 个，跳过 ${skipped} 个`);

  // 显示当前所有配置数量
  const total = await prisma.setting.count();
  console.log(`当前共有 ${total} 个配置项`);
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
