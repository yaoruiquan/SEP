# SEP 线上视觉素材

维护日期：2026-09-16。这里存放可供产品引用的压缩成品，不放生成原图、候选图、拼图和参考截图。

## 目录与用途

| 目录 | 独立素材 | 尺寸 | 用于 | 不用于 |
| --- | ---: | --- | --- | --- |
| `employees/silicon/` | 64 位人物，每位 3 个文件 | 见下表 | 硅基人才市场、硅基员工、聊天、任务中的同一员工身份 | 真人成员默认头像、技能封面、Hero 背景拼贴 |
| `carbon-defaults/` | 24 | 256×256 | 碳基成员没有上传头像时的可选默认头像 | 硅基员工身份；不可暗示为真人照片 |
| `capabilities/categories/` | 7 | 512×512 | 对应业务分类的入口和分类视觉 | 部门管理横幅、整个技能库的通用横幅 |
| `capabilities/types/` | 4 | 256×256 | AGENT / RPA / SKILL / AI_APP 类型识别 | 员工头像、供应商 Logo |
| `capabilities/featured/` | 8 | 1536×1024 | 对应精选技能的详情场景 | 其他技能、无关页面的装饰横幅 |
| `marketing/hero/` | 2 | 桌面 1536×1024；移动 1024×1536 | 官网营销首页，表达碳基团队和硅基员工协作 | 企业工作台、员工目录、部门页通用配图 |

基线共 **109 张独立素材、237 个 WebP 文件**。头像的派生文件不是不同人物。
`visual-assets.json` 登记碳基、技能与营销素材；硅基身份绑定见 `backend/prisma/seed/employee-avatar-map.ts`（相对仓库根目录）。

快速看图：[硅基员工总览](../../../outputs/silicon-employees-contact-sheet.jpg) · [碳基默认头像](../../../outputs/carbon-defaults-contact-sheet.jpg) · [技能分类与类型](../../../outputs/capabilities-contact-sheet.jpg) · [精选技能与营销场景](../../../outputs/featured-hero-contact-sheet.jpg)。这些预览需要本地 `outputs/` 目录存在。

## 硅基员工：同一人物，按场景选构图

| 文件 | 实际含义 | 推荐场景 |
| --- | --- | --- |
| `<slug>.webp` | 512×512 完整人物构图，部分人物到大腿 | 员工详情的大尺寸身份区、保留服装姿态的展示 |
| `<slug>-face.webp` | 256×256 头肩/胸像裁切，来自同一母版 | 约 104–120px 的正方形员工卡片头像；32–64px 聊天和任务头像 |
| `<slug>-full.webp` | **128×128 完整构图缩略图，不是高清原图** | 需要完整构图的小预览，禁止放大到详情大图 |

- `DigitalEmployee.avatar` 保持 canonical `<slug>.webp`，不要为每个页面改数据库 URL。
- `Avatar portrait` 自动使用 `-face.webp`；`portrait fullBody` 使用 canonical 主图。`fullBody` 属性与 `-full.webp` 文件名不是同一概念。
- 员工卡片使用正方形圆角框；不要把方图强裁为细长竖框。头像不得拉伸。
- 姓名与 slug 使用已有稳定映射，不按列表顺序或刷新随机分配；更名不应换脸。
- `spare-*` 为预备岗位素材，分配前核对映射，不代表一定尚未使用。
- 不随意替换为 `outputs/avatar-*-preview/` 中的旧试验人物。

## 技能素材的准确对应

分类：`technology`（研发技术）、`product-design`（产品设计）、`marketing-growth`（营销增长）、`ecommerce`（电商）、`sales-customer`（销售客户）、`operations-org`（运营组织）、`finance-legal`（财务法务）。文件前缀为 `category-`。

类型：`type-agent.webp`、`type-rpa.webp`、`type-skill.webp`、`type-ai-app.webp`。小尺寸列表中优先保证辨识度，不为用完素材而挤占数据空间。

精选场景按技能主题一一使用：

| 文件名（均为 `.webp`） | 主题 |
| --- | --- |
| `featured-code-review` | 代码审查 |
| `featured-meeting-notes` | 会议纪要 |
| `featured-content-strategy` | 内容策划 |
| `featured-ecommerce-ads` | 电商投放 |
| `featured-knowledge-rag` | 企业知识检索 |
| `featured-workflow-rpa` | 流程自动化 |
| `featured-data-analysis` | 数据分析 |
| `featured-customer-support` | 客户支持 |

## Hero 使用规则

- `marketing/hero/desktop.webp` 和 `mobile.webp` 是同主题的不同构图；移动版不是另一业务页面的配图。
- 企业各板块的专用横幅尚未在本目录交付。没有对应素材时使用标题与副标题，不借用营销图、分类图或头像拼贴。
- 后续后台横幅放 `enterprise/headers/<page-slug>-desktop.webp`，确需独立手机构图时再增加 `-mobile.webp`。
- 新横幅必须按实际宽高和裁切安全区设计，不能仅因为图片横向就直接 `object-cover`。标题、安全留白和人物头部需在目标视口实测。
- Logo 和供应商图标在 `web/public/logo*.png`、`web/public/vendors/`，保留品牌用途，不用生成图片替换。

## 原图、历史候选与预览

以下路径相对仓库根目录；仅供维护和审核，前端不得引用：

- `outputs/silicon-employees-raw/`：现有本地硅基原图，可能不齐全；勿当作完整备份。
- `outputs/remaining-visuals-raw/`：碳基、技能、营销图的生成原图。
- `outputs/*contact-sheet.jpg`：素材总览拼图，只用于人工检视。
- `outputs/avatar-library-preview/`、`avatar-standard-preview/`、`avatar-fusion-test-8/`、`avatar-preview/`：历史风格/构图实验，不是线上资产源。
- `tmp/imagegen/silicon-employees-64-manifest.json`：人物生成清单。
- `tmp/imagegen/derive-silicon-webp.py`：现有头像派生流程；`process-remaining-visuals.py`：其他素材压缩流程。它们属于历史工具，重新运行前检查输入是否齐全，并输出到新目录比较，避免覆盖已验收图片。

## 新增素材流程

1. 先写清主体、用途、页面、显示尺寸、裁切方式，检查现有素材是否已经满足；新人物先确定稳定 slug。
2. 原图与提示词放 `outputs/<batch-name>/`，文件名带版本；记录生成日期、模型/来源与许可，不记录 API 密钥。
3. 人物身份图、技能主题图、Hero 场景图分别评审，不跨用途挑图。用户上传头像始终优先于默认头像。
4. 派生 WebP 到对应目录。采用小写 kebab-case；新用途新增语义目录，不用 `image1`、`banner-final2` 等名字。
5. 新人物更新映射/生成清单；其他资产登记 `visual-assets.json`，含稳定 id、src、alt；新资产组更新本 README 的用途、尺寸和数量。
6. 按稳定 ID/slug 显式绑定页面，不根据列表下标、任意名称关键词或随机数选图。
7. 验证文件存在、实际像素与体积、回退行为、桌面/手机裁切以及暗色模式。只有接入并验收过的素材才标记为已接入。
8. 不直接删除或覆盖已有 URL。替换时先确认所有引用，再更新；未经确认保留原文件。

## 接入状态

- 硅基头像：已由员工数据映射并用于多个页面；本轮将员工卡片切为正方形头肩派生图。
- 碳基默认库、技能类型图、精选技能图：成品已存在，尚未统一接入；不能把“已生成”写成“已上线”。
- 营销 Hero：成品已存在，营销首页仍需单独接入验收。
- 工作台、部门管理、技能库、员工列表：本轮清除跨用途横幅引用；专用横幅另行补齐。
