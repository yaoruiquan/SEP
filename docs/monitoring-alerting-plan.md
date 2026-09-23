# 监控告警系统实施方案（方案 A - 轻量级）

## 目标

实现轻量级监控告警系统，满足生产环境基本可观测性需求，无需引入复杂的 Prometheus/Grafana 技术栈。

## 核心功能

### 1. 错误率监控
- 统计 5xx 错误率（每分钟）
- 阈值：> 5% 触发告警
- 告警渠道：企业微信 webhook

### 2. 响应时间监控
- 统计 API 平均响应时间（每分钟）
- 阈值：> 3000ms 触发告警
- 慢接口日志记录（> 5000ms）

### 3. 余额预警
- 定时检查企业钱包余额（每小时）
- 阈值：< 100 元触发告警
- 通知企业管理员

### 4. 系统健康检查
- 数据库连接状态
- Redis 连接状态
- 外部服务可用性（sub2api、OpenCode）
- 健康检查端点：`/api/health`

## 技术架构

```
┌─────────────────────────────────────────────┐
│         Application Layer                    │
│  ┌─────────────┐    ┌──────────────┐       │
│  │ Metrics     │    │ Health       │       │
│  │ Interceptor │    │ Check Module │       │
│  └──────┬──────┘    └──────┬───────┘       │
│         │                  │                │
│         └──────────┬───────┘                │
│                    ▼                         │
│         ┌─────────────────────┐             │
│         │ Monitoring Service  │             │
│         └──────────┬──────────┘             │
│                    │                         │
│         ┌──────────▼──────────┐             │
│         │ Alerting Service    │             │
│         └──────────┬──────────┘             │
└────────────────────┼──────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
        ▼            ▼            ▼
   企业微信      邮件通知    数据库日志
```

## 实施步骤

### Phase 1: 基础监控模块（4 小时）

#### 1.1 创建 Monitoring Module
```typescript
// backend/src/modules/monitoring/monitoring.module.ts
- MonitoringService: 指标收集和聚合
- MetricsInterceptor: 自动记录请求/响应指标
- AlertingService: 告警逻辑和发送
```

#### 1.2 指标收集
- 请求计数器（总数、成功、失败）
- 响应时间直方图（p50, p95, p99）
- 错误率计算（滑动窗口 1 分钟）

#### 1.3 内存存储
```typescript
interface Metrics {
  requests: {
    total: number;
    success: number;
    error: number;
  };
  responseTimes: number[]; // 最近 1000 个请求
  errors: Array<{
    timestamp: Date;
    path: string;
    statusCode: number;
    message: string;
  }>;
}
```

### Phase 2: 健康检查（2 小时）

#### 2.1 Health Module 增强
```typescript
// backend/src/health/health.controller.ts
@Get('health')
async check() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      sub2api: await this.checkSub2api(),
      opencode: await this.checkOpenCode(),
    },
  };
}
```

#### 2.2 依赖检查
- Prisma: `prisma.$queryRaw('SELECT 1')`
- Redis: `redis.ping()`
- Sub2api: 简单 HTTP 健康检查
- OpenCode: `/health` 端点检查

### Phase 3: 告警实现（2-3 小时）

#### 3.1 企业微信 Webhook
```typescript
// backend/src/modules/monitoring/alerting.service.ts
async sendWeChatAlert(message: string) {
  await fetch(process.env.WECHAT_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({
      msgtype: 'text',
      text: { content: message },
    }),
  });
}
```

#### 3.2 告警规则
```typescript
class AlertingService {
  // 每分钟检查一次
  @Cron('* * * * *')
  async checkMetrics() {
    const errorRate = this.calculateErrorRate();
    if (errorRate > 0.05) {
      await this.sendAlert(`错误率过高: ${(errorRate * 100).toFixed(2)}%`);
    }
    
    const avgResponseTime = this.calculateAvgResponseTime();
    if (avgResponseTime > 3000) {
      await this.sendAlert(`响应时间过慢: ${avgResponseTime}ms`);
    }
  }
  
  // 每小时检查一次
  @Cron('0 * * * *')
  async checkBalances() {
    const lowBalanceEnterprises = await this.findLowBalanceEnterprises(100);
    for (const enterprise of lowBalanceEnterprises) {
      await this.sendAlert(`企业 ${enterprise.name} 余额不足: ${enterprise.balance} 元`);
    }
  }
}
```

### Phase 4: 监控面板（2-3 小时）

#### 4.1 简单 API 端点
```typescript
@Get('metrics')
async getMetrics() {
  return {
    requests: this.monitoringService.getRequestMetrics(),
    responseTime: this.monitoringService.getResponseTimeMetrics(),
    errors: this.monitoringService.getRecentErrors(100),
  };
}
```

#### 4.2 前端展示（可选）
- 简单的 dashboard 页面
- 使用 recharts 展示图表
- 实时刷新（每 5 秒）

## 环境变量

```bash
# .env
# 企业微信 webhook
WECHAT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx

# 邮件通知（可选）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alert@example.com
SMTP_PASSWORD=xxx
ALERT_EMAIL=admin@example.com

# 告警阈值
ALERT_ERROR_RATE_THRESHOLD=0.05      # 5%
ALERT_RESPONSE_TIME_THRESHOLD=3000   # 3 秒
ALERT_BALANCE_THRESHOLD=100          # 100 元
```

## 测试计划

### 单元测试
- MonitoringService: 指标计算逻辑
- AlertingService: 告警触发逻辑
- HealthController: 健康检查逻辑

### 集成测试
- 模拟高错误率场景
- 模拟慢请求场景
- 验证告警发送

### 手动测试
- 触发实际告警
- 验证企业微信消息接收
- 验证健康检查端点

## 性能影响

- MetricsInterceptor: < 0.5ms/请求
- 内存使用: ~10MB（存储最近 1000 个请求数据）
- Cron 任务: 每分钟/每小时执行，对业务无影响

## 优势

### vs Prometheus/Grafana
- ✅ 无需额外基础设施
- ✅ 快速实施（8-12 小时）
- ✅ 低维护成本
- ✅ 轻量级，适合初期
- ❌ 缺少长期指标存储
- ❌ 缺少复杂查询能力
- ❌ 缺少可视化面板

### 后续升级路径
当业务规模增长后，可平滑升级到 Prometheus/Grafana：
1. 保留现有监控逻辑
2. 添加 Prometheus exporter
3. 配置 Grafana dashboard
4. 逐步迁移告警规则

## 实施时间线

| 阶段 | 任务 | 预估时间 |
|------|------|---------|
| Phase 1 | 基础监控模块 | 4 小时 |
| Phase 2 | 健康检查增强 | 2 小时 |
| Phase 3 | 告警实现 | 2-3 小时 |
| Phase 4 | 监控面板（可选） | 2-3 小时 |
| **总计** | | **8-12 小时** |

## 验收标准

- [ ] 错误率监控正常工作，可触发告警
- [ ] 响应时间监控正常工作，可触发告警
- [ ] 余额预警正常工作，每小时检查
- [ ] 健康检查端点返回完整状态
- [ ] 企业微信告警消息正常接收
- [ ] 单元测试覆盖率 > 80%
- [ ] 文档完善（使用指南、配置说明）

## 下一步

1. 创建 MonitoringModule 骨架
2. 实现 MetricsInterceptor
3. 实现 MonitoringService
4. 实现 AlertingService
5. 增强 HealthModule
6. 编写测试
7. 文档编写

准备开始实施？
