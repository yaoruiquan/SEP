# 监控告警模块

轻量级监控告警系统，提供生产环境基本可观测性，无需额外基础设施。

## 功能特性

### 1. 自动指标收集
- **MetricsInterceptor**: 全局拦截器，自动记录所有 HTTP 请求
- **滑动窗口**: 最近 1 分钟的实时指标（1000 个请求）
- **累计统计**: 应用启动以来的总计指标

### 2. 实时监控指标
- **请求统计**:
  - 总请求数、成功数、失败数
  - 4xx 错误数、5xx 错误数
  - 错误率（error rate）
- **响应时间**:
  - P50、P95、P99 百分位数
  - 平均值、最大值
- **错误记录**:
  - 最近 100 个错误详情
  - 路径、状态码、错误消息

### 3. 自动告警
- **错误率告警**: 错误率 > 5% 时触发（每分钟检查）
- **响应时间告警**: 平均响应时间 > 3000ms 时触发（每分钟检查）
- **余额预警**: 企业余额 < 100 元时触发（每小时检查）
- **告警去重**: 5 分钟冷却期，防止重复告警

### 4. 增强健康检查
- **Liveness**: `GET /health` - 服务存活检查
- **Readiness**: `GET /health/ready` - 依赖服务就绪检查
  - PostgreSQL
  - Redis
  - Task Queue
  - Knowledge Queue
  - Sub2api（生产环境）
  - Embedding Service（生产环境）
  - OpenCode Skills Service（生产环境）

## API 端点

### 获取监控指标
```bash
GET /api/monitoring/metrics
Authorization: Bearer <token>

Response:
{
  "requests": {
    "total": 1234,
    "success": 1200,
    "error": 34,
    "clientError": 20,
    "serverError": 14,
    "errorRate": 0.0275
  },
  "responseTime": {
    "p50": 120,
    "p95": 450,
    "p99": 800,
    "avg": 150,
    "max": 1200
  },
  "cumulative": {
    "total": 50000,
    "success": 49500,
    "error": 500,
    "clientError": 300,
    "serverError": 200
  }
}
```

### 获取最近错误
```bash
GET /api/monitoring/errors
Authorization: Bearer <token>

Response:
{
  "errors": [
    {
      "timestamp": "2024-03-20T10:30:00Z",
      "path": "/api/auth/login",
      "method": "POST",
      "statusCode": 401,
      "message": "Invalid credentials",
      "userAgent": "Mozilla/5.0..."
    }
  ]
}
```

### 发送测试告警
```bash
POST /api/monitoring/test-alert
Authorization: Bearer <token>

Response:
{
  "message": "Test alert sent successfully"
}
```

## 环境变量配置

```bash
# 企业微信 Webhook（必需）
WECHAT_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx

# 告警阈值（可选，有默认值）
ALERT_ERROR_RATE_THRESHOLD=0.05      # 错误率阈值（5%）
ALERT_RESPONSE_TIME_THRESHOLD=3000   # 响应时间阈值（3000ms）
ALERT_BALANCE_THRESHOLD=100          # 余额阈值（100 元）
```

## 告警消息格式

### 错误率告警
```
🚨 【CRITICAL】API 错误率过高

当前错误率: 6.50%
总请求数: 1000
失败数: 65（4xx: 40, 5xx: 25）

⏰ 2024-03-20 18:30:00
```

### 响应时间告警
```
⚠️ 【WARNING】API 响应时间过慢

平均响应时间: 3500ms
P50: 2000ms
P95: 5000ms
P99: 8000ms
最大: 10000ms

⏰ 2024-03-20 18:30:00
```

### 余额预警
```
⚠️ 【WARNING】企业余额不足

企业「数易科技」余额仅剩 ¥85.00，低于阈值 ¥100

⏰ 2024-03-20 18:00:00
```

## 性能影响

- **MetricsInterceptor**: < 0.5ms/请求
- **内存占用**: ~10MB（存储最近 1000 个请求 + 100 个错误）
- **Cron 任务**: 
  - 每分钟检查（错误率、响应时间）
  - 每小时检查（余额）
  - 对业务请求无影响

## 测试覆盖

- **MonitoringService**: 11 个测试用例
  - 请求记录（成功、4xx、5xx）
  - 指标计算（错误率、响应时间）
  - 滑动窗口
  - 错误记录
- **AlertingService**: 7 个测试用例
  - 错误率告警
  - 响应时间告警
  - 余额预警
  - 告警去重

## 使用示例

### 手动触发测试告警
```bash
curl -X POST http://localhost:3000/api/monitoring/test-alert \
  -H "Authorization: Bearer <token>"
```

### 查看实时指标
```bash
curl http://localhost:3000/api/monitoring/metrics \
  -H "Authorization: Bearer <token>"
```

### 查看健康状态
```bash
# Liveness（存活检查）
curl http://localhost:3000/health

# Readiness（就绪检查）
curl http://localhost:3000/health/ready
```

## 架构设计

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
   企业微信      日志输出    数据库（未来）
```

## 后续增强

### 短期（可选）
- [ ] 邮件通知支持
- [ ] Slack webhook 支持
- [ ] 更细粒度的响应时间分组（按端点）

### 长期（升级路径）
- [ ] Prometheus exporter
- [ ] Grafana dashboard
- [ ] 指标持久化（数据库/时序数据库）
- [ ] 自定义告警规则
- [ ] 告警分组和聚合

## 故障排查

### 告警未发送
1. 检查 `WECHAT_WEBHOOK_URL` 是否配置
2. 检查企业微信 webhook 是否有效
3. 查看应用日志：`logger.warn('[ALERT] ...')`
4. 验证告警阈值配置是否合理

### 指标不准确
1. 检查 MetricsInterceptor 是否注册（APP_INTERCEPTOR）
2. 验证请求是否经过拦截器（排除 /health 等路径）
3. 查看滑动窗口大小（1 分钟 = 60000ms）

### 健康检查失败
1. 检查数据库连接：`docker-compose ps`
2. 检查 Redis 连接：`redis-cli ping`
3. 验证外部服务 URL 配置：`SUB2API_BASE_URL`, `OPENCODE_API_BASE_URL`

## 相关文档

- [监控告警实施方案](../../../docs/monitoring-alerting-plan.md)
- [P0 缺口进度](../../../docs/p0-gaps-progress.md)
- [安全加固总结](../../../docs/security-hardening-summary.md)
