import { cn } from '@/lib/utils';

export interface Step {
  id: string;
  title: string;
  description?: string;
  status?: 'pending' | 'current' | 'completed' | 'error';
}

interface StepsProps {
  steps: Step[];
  currentStep: number; // 0-based index
  orientation?: 'horizontal' | 'vertical';
  clickable?: boolean;
  onStepClick?: (stepIndex: number) => void;
  className?: string;
}

export function Steps({
  steps,
  currentStep,
  orientation = 'horizontal',
  clickable = false,
  onStepClick,
  className,
}: StepsProps) {
  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      className={cn(
        'flex',
        isHorizontal ? 'items-start' : 'flex-col',
        className
      )}
      role="list"
      aria-label="进度步骤"
    >
      {steps.map((step, index) => {
        const status = step.status || getDefaultStatus(index, currentStep);
        const isCompleted = status === 'completed';
        const isCurrent = status === 'current';
        const isError = status === 'error';
        const isLast = index === steps.length - 1;

        return (
          <div
            key={step.id}
            className={cn(
              'flex',
              isHorizontal
                ? 'flex-col items-center flex-1'
                : 'flex-row items-start',
              !isLast && (isHorizontal ? 'relative' : 'pb-8')
            )}
            role="listitem"
          >
            {/* Step indicator */}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(index)}
              className={cn(
                'flex items-center justify-center rounded-full transition-all',
                isHorizontal ? 'w-10 h-10 mb-2' : 'w-10 h-10 mr-4 flex-shrink-0',
                clickable && 'cursor-pointer hover:scale-110',
                !clickable && 'cursor-default',
                isCompleted &&
                  'bg-success text-white ring-4 ring-success/20',
                isCurrent &&
                  'bg-primary text-white ring-4 ring-primary/20 animate-pulse-slow',
                isError && 'bg-danger text-white ring-4 ring-danger/20',
                !isCompleted &&
                  !isCurrent &&
                  !isError &&
                  'bg-neutral-200 text-neutral-500'
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isCompleted ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : isError ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <span className="text-sm font-semibold">{index + 1}</span>
              )}
            </button>

            {/* Step content */}
            <div
              className={cn(
                'flex flex-col',
                isHorizontal ? 'items-center text-center' : 'flex-1'
              )}
            >
              <span
                className={cn(
                  'text-sm font-medium transition-colors',
                  isCurrent && 'text-primary',
                  isCompleted && 'text-neutral-900',
                  isError && 'text-danger',
                  !isCurrent && !isCompleted && !isError && 'text-neutral-500'
                )}
              >
                {step.title}
              </span>
              {step.description && (
                <span className="text-xs text-neutral-500 mt-1">
                  {step.description}
                </span>
              )}
            </div>

            {/* Connector line */}
            {!isLast && (
              <div
                className={cn(
                  'transition-colors',
                  isHorizontal
                    ? 'absolute top-5 left-1/2 right-0 h-0.5 -translate-y-1/2'
                    : 'absolute top-10 left-5 bottom-0 w-0.5',
                  isCompleted ? 'bg-success' : 'bg-neutral-200'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function getDefaultStatus(
  index: number,
  currentStep: number
): Step['status'] {
  if (index < currentStep) return 'completed';
  if (index === currentStep) return 'current';
  return 'pending';
}
