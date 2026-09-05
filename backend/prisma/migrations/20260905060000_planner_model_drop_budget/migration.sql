-- 「编排与分析模型」入企业配置，同时删掉从未生效的「月度预算控制」。
--
-- 为什么删预算控制（三个字段一起走）：
--   拦截逻辑 assertBudgetAllowsNewSession() 统计「本月已花」用的是
--   compute_transactions 里 type='CONSUME' 的行，而真实账单 2026-08 起就搬到了
--   compute_usage_records。实测本地库：compute_transactions 当月 0 行、最近一行是
--   seed 造的 2026-09-02；对话链路走 chargeUsage() 只写 compute_usage_records。
--   所以 getMonthlySpentCNY() 对当月恒为 0 —— 月度预算设成 ¥1 也拦不住任何对话。
--   另外 alertThreshold 全仓没有任何告警代码读它，hardStopOnBudget 没有 UI 且默认
--   false，budgetExceeded 回给了前端但没人消费。三个字段合起来是一个死开关。
--   真正生效的花钱管控是「算力余额」页那三层：企业钱包、订阅赠送算力、成员算力额度。
--
-- plannerModel 允许为空：空 = 跟随平台系统设置 SUB2API_DEFAULT_MODEL，
-- 与接入前的行为一致，所以存量企业不需要数据回填。
ALTER TABLE "enterprise_model_configs"
  DROP COLUMN "alertThreshold",
  DROP COLUMN "hardStopOnBudget",
  DROP COLUMN "monthlyBudgetCNY",
  ADD COLUMN  "plannerModel" TEXT;
