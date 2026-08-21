'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EMPLOYEE_CATEGORIES } from '@/lib/employee-categories';

// ─── types ────────────────────────────────────────────────────────────────────

/** 价格滑块拉到最右端 = 不限价，而不是「上限正好 2000」。 */
export const PRICE_MAX = 2000;

export interface FilterState {
  search: string;
  category: string;
  capTypes: string[];
  maxPrice: number;
}

export const INITIAL_FILTERS: FilterState = {
  search: '',
  category: '',
  capTypes: [],
  maxPrice: PRICE_MAX,
};

interface FilterPanelProps {
  filters: FilterState;
  onChange: (next: Partial<FilterState>) => void;
  /** 各职能分类下的员工数，由页面按当前结果集算出 */
  counts: Record<string, number>;
  total: number;
}

// ─── static data ─────────────────────────────────────────────────────────────

const CATEGORIES = EMPLOYEE_CATEGORIES.map(({ label, value }) => ({ label, value }));

const CAP_TYPES = [
  { label: 'AI 对话', value: 'AGENT' },
  { label: 'RPA 自动化', value: 'RPA' },
  { label: '技能脚本', value: 'SKILL' },
  { label: 'AI 应用', value: 'AI_APP' },
];

// ─── component ───────────────────────────────────────────────────────────────

export function FilterPanel({ filters, onChange, counts, total }: FilterPanelProps) {
  function toggleCapType(v: string) {
    const next = filters.capTypes.includes(v)
      ? filters.capTypes.filter((t) => t !== v)
      : [...filters.capTypes, v];
    onChange({ capTypes: next });
  }

  const dirty =
    Boolean(filters.category) ||
    filters.capTypes.length > 0 ||
    filters.maxPrice < PRICE_MAX;

  return (
    <aside
      aria-label="筛选"
      className="sticky top-[76px] flex h-fit w-60 shrink-0 flex-col gap-5 rounded-glass-2xl border border-glassline bg-glass-1 p-4 backdrop-blur-glass-md"
    >
      {/* search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gtext-muted" />
        <input
          type="search"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="搜索员工…"
          aria-label="搜索员工"
          className={cn(
            'w-full rounded-glass-lg border border-glassline bg-glass-2 py-2 pl-8 pr-3',
            'text-[13px] text-gtext-primary placeholder:text-gtext-muted',
            'transition-colors duration-200',
            'focus:border-glassline-brand focus:outline-none focus:ring-2 focus:ring-gbrand/40',
          )}
        />
      </div>

      {/* ── 业务职能 ────────────────────────────────────────────── */}
      <div>
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-gtext-muted">
          业务职能
        </p>
        <ul className="space-y-0.5">
          {[{ label: '全部', value: '' }, ...CATEGORIES].map((cat) => {
            const active = filters.category === cat.value;
            const n = cat.value === '' ? total : (counts[cat.value] ?? 0);
            return (
              <li key={cat.value || '__all__'}>
                <button
                  onClick={() => onChange({ category: cat.value })}
                  aria-pressed={active}
                  className={cn(
                    'flex w-full items-center justify-between rounded-glass-md px-3 py-1.5',
                    'text-[13px] transition-colors duration-150',
                    active
                      ? 'bg-gbrand/15 font-medium text-gbrand-text'
                      : 'text-gtext-secondary hover:bg-glass-2 hover:text-gtext-primary',
                  )}
                >
                  <span>{cat.label}</span>
                  <span className={cn('text-[11px]', active ? 'text-gbrand-text' : 'text-gtext-muted')}>
                    {n}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="h-px bg-glassline" />

      {/* ── 能力形态 ────────────────────────────────────────────── */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gtext-muted">
            能力形态
          </p>
          {filters.capTypes.length > 0 && (
            <span className="rounded-full bg-gbrand/15 px-1.5 py-0.5 text-[10px] font-medium text-gbrand-text">
              已选 {filters.capTypes.length}
            </span>
          )}
        </div>
        <ul className="space-y-0.5">
          {CAP_TYPES.map((ct) => {
            const checked = filters.capTypes.includes(ct.value);
            return (
              <li key={ct.value}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-glass-md px-3 py-1.5 transition-colors hover:bg-glass-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCapType(ct.value)}
                    className="h-3.5 w-3.5 rounded border-glassline accent-[#818cf8]"
                  />
                  <span
                    className={cn(
                      'text-[13px]',
                      checked ? 'text-gtext-primary' : 'text-gtext-secondary',
                    )}
                  >
                    {ct.label}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="h-px bg-glassline" />

      {/* ── 价格区间 ────────────────────────────────────────────── */}
      <div>
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-widest text-gtext-muted">
          价格上限
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '免费', value: 0 },
            { label: '¥100以下', value: 100 },
            { label: '¥100-500', value: 500 },
            { label: '不限', value: PRICE_MAX },
          ].map((opt) => {
            const active = filters.maxPrice === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onChange({ maxPrice: opt.value })}
                aria-pressed={active}
                className={cn(
                  'rounded-glass-md px-3 py-2 text-[12px] transition-all duration-150',
                  active
                    ? 'border border-glassline-brand bg-gbrand/15 font-medium text-gbrand-text shadow-glass-sm'
                    : 'border border-glassline bg-glass-2 text-gtext-secondary hover:bg-glass-3 hover:text-gtext-primary',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── clear ───────────────────────────────────────────────── */}
      {dirty && (
        <button
          onClick={() =>
            onChange({ category: '', capTypes: [], maxPrice: PRICE_MAX })
          }
          className="self-start text-[12px] text-gtext-muted underline underline-offset-2 transition-colors hover:text-gtext-secondary"
        >
          清除筛选
        </button>
      )}
    </aside>
  );
}
