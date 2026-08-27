import { cn } from '@/lib/utils';
import { STAGE_SHORT_LABEL, type PipelineModel, type StageState } from '../pipeline-model';

const DOT: Record<StageState, string> = {
  done: 'bg-gsuccess',
  active: 'bg-gbrand',
  waiting: 'bg-glass-4 ring-1 ring-inset ring-glassline',
  blocked: 'bg-gdanger',
};

const SEGMENT: Record<StageState, string> = {
  done: 'bg-gsuccess/45',
  active: 'bg-gbrand/40',
  waiting: 'bg-glassline',
  blocked: 'bg-gdanger/40',
};

/**
 * 列表行用的迷你流程轨道。
 *
 * 取代重构前那条硬编码百分比的进度条（54% 是写死的常量）：同样的横向空间里，
 * N 个点直接对应真实的 N 个流程节点，不需要编造数字。
 *
 * 用等宽 grid 而不是 flex + flex-1：只有每个节点占据同宽的一列，
 * 点和它下方的文字标签才能落在同一条中轴线上。
 */
export function PipelineMiniTrack({
  model,
  showLabels = true,
  className,
}: {
  model: PipelineModel;
  showLabels?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('grid min-w-0', className)}
      style={{ gridTemplateColumns: `repeat(${model.total}, minmax(0, 1fr))` }}
      role="img"
      aria-label={`发布流程 第 ${model.currentIndex + 1} / ${model.total} 步：${model.current.title}`}
    >
      {model.stages.map((stage, index) => (
        <div key={stage.key} className="relative flex min-w-0 flex-col items-center">
          {index > 0 && (
            <span
              className={cn(
                'absolute right-1/2 top-1 h-px w-full -translate-y-1/2 transition-colors duration-200',
                SEGMENT[model.stages[index - 1].state],
              )}
            />
          )}
          <span className="relative grid h-2 w-2 place-items-center">
            {stage.state === 'active' && (
              <span className="absolute h-3.5 w-3.5 animate-pulse-slow rounded-full bg-gbrand/25" />
            )}
            <span
              className={cn(
                'relative h-2 w-2 rounded-full transition-colors duration-200',
                DOT[stage.state],
                // 当前节点即使还没开始也要能被认出来，否则它和后面几个未开始的点长得一样
                index === model.currentIndex && stage.state === 'waiting' && 'ring-1 ring-gbrand/70',
              )}
            />
          </span>
          {showLabels && (
            <span
              className={cn(
                'mt-2 whitespace-nowrap text-[10px] leading-none transition-colors',
                index === model.currentIndex ? 'font-medium text-gtext-secondary' : 'text-gtext-muted',
              )}
            >
              {STAGE_SHORT_LABEL[stage.key]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
