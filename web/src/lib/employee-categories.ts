export const EMPLOYEE_CATEGORIES = [
  { value: 'TECH', label: '研发与技术' },
  { value: 'PRODUCT_DESIGN', label: '产品与设计' },
  { value: 'MARKETING_GROWTH', label: '营销与增长' },
  { value: 'ECOMMERCE', label: '电商经营' },
  { value: 'SALES_CUSTOMER', label: '销售与客户' },
  { value: 'OPERATIONS_ORG', label: '运营与组织' },
  { value: 'FINANCE_LEGAL', label: '财务与法务' },
] as const;

export type EmployeeCategory = (typeof EMPLOYEE_CATEGORIES)[number]['value'];
