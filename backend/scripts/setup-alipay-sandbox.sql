-- 支付宝沙箱配置 SQL 脚本
-- 使用方法：根据你的支付宝沙箱应用信息替换占位符后执行

-- ============================================================================
-- 清理旧配置（可选，首次运行可跳过）
-- ============================================================================
DELETE FROM system_settings WHERE key LIKE 'alipay.%';

-- ============================================================================
-- 插入支付宝沙箱配置
-- ============================================================================

-- 1. 支付宝应用 ID（沙箱）
INSERT INTO system_settings (id, key, value, "isSecret", label, category, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'alipay.appId',
  '9021000166675041',
  false,
  '支付宝应用 ID（沙箱环境）',
  'payment',
  NOW(),
  NOW()
);

-- 2. 应用私钥（RSA2）
-- ⚠️ 注意：这是「应用私钥」，不是「应用公钥」
-- 格式：完整的 PEM 格式，包含 BEGIN 和 END 标记
INSERT INTO system_settings (id, key, value, "isSecret", label, category, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'alipay.privateKey',
  '-----BEGIN RSA PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCecaEjNGyt6ORR
jE0XFSvR5yX9w5mwfxFJ03/ihuwDc56w1xIM7AMOA6g6etxIcgXaFplqo1ScAF3L
rHRQ2hG6ZmD+2gFNFP1xumPA7WFqWhfo2Jbe/rTR3pFjB49fHMXPdo0lTEFeYuzu
xWQ8amoDA4k9YZe5rAmuEsbm8JPDDqhtZxdrv9FJJ14jQtbGgLHS8jhoIeScl9ON
GhpEkdRQt/+M5z/PvKsX6hD0YMir0s/uVM20qutKj5SyBICOeODVI6LbTHzGxTrR
SRlAbae2aLIV+UVJjrDu7JqHn1roL53hwbQJZvzV3skwcitzBldbawZk+z/Ul5zj
+RvNcpEDAgMBAAECggEAewD/9dK3JHQO/HgNSQQ4lqX6Sn1VjT24cDXvrC7Ofwd9
hRAShVGcNX8FVREYfm12uY6d37mY79sg9gOV8Ua6SJk+Z9ta8zp+X5Ix6w7ed7Al
q7Cpv8jBG8TL3bN6zH4L2znP7cq7XMkz41H+tSBv2JMgMjTXk19JzIfrPlI6hExa
KgfF9JGCD8RosPw0wAbhjTxxgF0UGSBz1HEQFLxGn7yCjb7jLKyFZllr1MEi99EY
bTehdQUDeg+Fn5MzdhYP2Po/1KdjK92643753ZTzS0HfqBFTT4aNvQQxGnWrE3vm
WnFRx/EKgANMJCdbG5MgaBK1PZw0L9YDcXJD1py8AQKBgQDsL0/g4Anaa3QiThaP
bC1L7C5rlejbVD6M8Z+D4gB+yPG4nRUz43eVIpLMceYPCqhOFdLmsBpyhAG/VNwp
TyUTcsRhUgh5+1pb2lRBetbsvj8RKty/zyt23GdOPgcDy7tpCBIwQWClPL5jeOuu
4WBUFceG4KXmluB4GgsM6w++AwKBgQCrvKB0zjtZnFOev3EaVqy2PG8DXsYZ4tFE
AarEkQSfUwwYQH2Z09ucsPyllEvupfIfEq7aCwCie4b2OZ61xoKJWeiLnhnBjEky
BVj8YRe6LGAJQ9MNbcdrr7/3Y+qwxO24sqRF4C6+ettxYgzgHtCr0OYe24Ef+xNG
2H4yvtbxAQKBgAXR+Kby/msqgLcjs3yfTtJzJIW0MQPOpKf2gFbQp/B35TUGcfJQ
Za8AJhvxppiyS4l5EjRrHIu74wsi/TXrZF+BUYOQcPMIlaZzz+W5MDivS4CRzNTR
NyH7tnQAJU4bpCenckNMKSSJRavP3Ab4ONZ5nuwc9xmimC99fM45sK6fAoGAL6nZ
arG2PSeq+Zsue93kb2uUb/4Ewzh1VgeUapvJCaMV70Eu2tu2zuU8KYRgEqsR6NfZ
mYCGO5JHId1aFB81KYO/i8hkY5hY1D4xtVIJMM2SFeAyGj8GoveTMskTYN43EBTc
jNwsfQdCElThN+61gYon5BaN3t9jOT1qwRDAPQECgYAiQES0OC5qB3N5zF1xaTF8
DqlEJuUQZIBShCr8JQEi+IkhpE1dbkpnVo14haG0NaGRZ/sZ8zTimWLcMxqkvNOJ
oNI9vdEKNtczZaQvPPzWuh7THDRLCEB+mYM0PKI/adbZ0V80crvSya7FuPseCH/n
//moLTglv/gTdGmO/TrI8A==
-----END RSA PRIVATE KEY-----',
  true,
  '支付宝应用私钥（RSA2）',
  'payment',
  NOW(),
  NOW()
);

-- 3. 支付宝公钥（RSA2）
-- ⚠️ 注意：这是「支付宝公钥」，不是「应用公钥」
-- 从支付宝开放平台下载，不是你本地生成的公钥
INSERT INTO system_settings (id, key, value, "isSecret", label, category, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'alipay.publicKey',
  '-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjLiqEOuDyesKLhs724G5
V+kOyGtN8mcIxRhxPa2b5mvfTOx8adj39966SAtF0c9Tboos3LiXa72+B0esHf1N
0nDb6Z7bMNJyBz7a4fjwgpRTOsxpMKqy117kfVxJN7mRSpyzKxFsEKrXmTlOGRyv
msKWzgSvaLT++4l7ghouCwA5fwCbI+pDjuV0G0C3oaMIBm8/JpSL2NuIyDGY3vQr
Bs9QomZjK8xF7nOmZmRB77YBm/D0NGP5Uq57m40bB8EwXbrB8UNIwmihu6DGhun1
25ORzQ2Q6H2Ul0CTMR/SDx+7Chj1Q/EmTv6JEPu+3NIa4uVMqS382tf8wup5pCPw
lDAQAB
-----END PUBLIC KEY-----',
  true,
  '支付宝公钥（RSA2，从开放平台下载）',
  'payment',
  NOW(),
  NOW()
);

-- 4. 沙箱网关地址
INSERT INTO system_settings (id, key, value, "isSecret", label, category, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'alipay.gateway',
  'https://openapi-sandbox.dl.alipaydev.com/gateway.do',
  false,
  '支付宝网关地址（沙箱环境）',
  'payment',
  NOW(),
  NOW()
);

-- ============================================================================
-- 验证配置
-- ============================================================================
SELECT key,
       CASE WHEN "isSecret" THEN '[已加密]' ELSE value END as value,
       label,
       "createdAt"
FROM system_settings
WHERE key LIKE 'alipay.%'
ORDER BY key;

-- ============================================================================
-- 准备测试数据
-- ============================================================================

-- 1. 检查是否存在测试企业
SELECT id, name, "createdAt"
FROM enterprises
WHERE name LIKE '%测试%' OR name LIKE '%Test%';

-- 如果没有，创建一个测试企业
-- INSERT INTO enterprises (id, name, "contactEmail", "createdAt", "updatedAt")
-- VALUES (gen_random_uuid(), '测试企业 - 支付宝沙箱', 'test@example.com', NOW(), NOW());

-- 2. 确保测试企业有算力账户
-- 替换 'your-enterprise-id' 为实际企业 ID
INSERT INTO compute_accounts (id, "enterpriseId", balance, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'your-enterprise-id', 0, NOW(), NOW())
ON CONFLICT ("enterpriseId") DO NOTHING;

-- 3. 检查可用的员工模板（需要设置价格）
SELECT id, name, "annualPriceCNY", "includedComputeCNY", status
FROM digital_employees
WHERE status = 'APPROVED' AND "annualPriceCNY" IS NOT NULL
LIMIT 5;

-- 如果没有，需要先创建员工模板或更新现有员工的价格
-- UPDATE digital_employees
-- SET "annualPriceCNY" = 5000.00, "includedComputeCNY" = 1000.00
-- WHERE id = 'your-employee-id';

-- ============================================================================
-- 测试完成后的清理脚本（可选）
-- ============================================================================

-- 清理测试订单
-- DELETE FROM orders WHERE "enterpriseId" = 'your-enterprise-id' AND status = 'PENDING';

-- 清理测试购物车
-- DELETE FROM cart_items WHERE "enterpriseId" = 'your-enterprise-id';

-- 清理测试支付通知
-- DELETE FROM payment_notifies WHERE "outTradeNo" LIKE '202608%';

-- ============================================================================
-- 生产环境配置示例（上线前替换）
-- ============================================================================
/*
-- 1. 更新为生产环境 APPID
UPDATE system_settings
SET value = '你的生产APPID'
WHERE key = 'alipay.appId';

-- 2. 更新为生产环境应用私钥
UPDATE system_settings
SET value = '-----BEGIN RSA PRIVATE KEY-----
生产环境应用私钥
-----END RSA PRIVATE KEY-----'
WHERE key = 'alipay.privateKey';

-- 3. 更新为生产环境支付宝公钥
UPDATE system_settings
SET value = '-----BEGIN PUBLIC KEY-----
生产环境支付宝公钥
-----END PUBLIC KEY-----'
WHERE key = 'alipay.publicKey';

-- 4. 更新为生产网关
UPDATE system_settings
SET value = 'https://openapi.alipay.com/gateway.do'
WHERE key = 'alipay.gateway';
*/
