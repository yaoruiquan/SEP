// 模型列表已改为运行时从上游实时拉取（见 features/model/use-models.ts）。
// 这里只保留一个系统默认模型常量，用于表单兜底默认值。

/**
 * 系统默认模型（与后端 DEFAULT_MODEL_ID 保持一致）。
 * 必须支持 function calling，否则绑定了能力的员工无法对话。
 */
export const DEFAULT_MODEL_ID = 'gemini-3.5-flash-high';
