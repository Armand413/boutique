import type { ReactNode } from 'react';
import { CircleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/basic';

interface LoadingStateProps {
  /** Texte lu par les lecteurs d'écran. */
  label: string;
  rows?: number;
}

/** État de chargement par squelettes (A.6). */
export function LoadingState({ label, rows = 3 }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/3" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Action proposée (A.6 : état vide avec action suggérée). */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="border-border flex flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <Icon className="text-muted-foreground size-10" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  title: string;
  message: string;
  /** Solution proposée à l'utilisateur (A.6). */
  solution: string;
  retryLabel: string;
  onRetry: () => void;
}

export function ErrorState({ title, message, solution, retryLabel, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-danger bg-danger-soft text-danger-soft-foreground flex flex-col items-start gap-4 rounded-lg border p-6"
    >
      <div className="flex items-center gap-2">
        <CircleAlert className="size-5" aria-hidden="true" />
        <p className="text-xl font-semibold">{title}</p>
      </div>
      <p className="text-base">{message}</p>
      <p className="text-sm">{solution}</p>
      <Button variant="secondary" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}
