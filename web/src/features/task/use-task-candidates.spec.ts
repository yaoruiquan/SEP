import { describe, expect, it } from 'vitest';
import { normalizeCandidate } from './use-task-candidates';
import type { DigitalEmployee } from '@/lib/types';

describe('normalizeCandidate', () => {
  it('keeps only the employee and capability fields needed by the planner', () => {
    const candidate = normalizeCandidate({
      id: 'employee-1',
      name: '运营分析师',
      description: '负责经营数据分析',
      industry: '电商',
      position: '数据分析',
      functionalCategory: 'ECOMMERCE',
      avatar: null,
      price: 0,
      version: '1.0.0',
      status: 'APPROVED',
      createdAt: '',
      bindings: [
        {
          id: 'binding-1',
          order: 1,
          capability: {
            id: 'cap-1',
            name: '销售分析',
            description: '分析销售趋势',
            type: 'SKILL',
            industry: [],
            position: [],
            status: 'APPROVED',
            createdAt: '',
          },
        },
      ],
    } satisfies DigitalEmployee);

    expect(candidate).toEqual({
      id: 'employee-1',
      name: '运营分析师',
      description: '负责经营数据分析',
      position: '数据分析',
      industry: '电商',
      avatar: null,
      capabilities: [
        { id: 'cap-1', name: '销售分析', description: '分析销售趋势', type: 'SKILL' },
      ],
    });
  });
});
