import * as ToastPrimitive from '@radix-ui/react-toast';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '../../lib/cn';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  items: ToastItem[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  items: [],
  push: (tone, message) =>
    set((state) => ({ items: [...state.items, { id: nextId++, tone, message }].slice(-4) })),
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

/** Retour immédiat de chaque action (A.1). */
export const toast = {
  success: (message: string): void => useToasts.getState().push('success', message),
  warning: (message: string): void => useToasts.getState().push('warning', message),
  error: (message: string): void => useToasts.getState().push('danger', message),
  info: (message: string): void => useToasts.getState().push('info', message),
};

const ICONS = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
} as const;

const TONE_CLASS: Readonly<Record<ToastTone, string>> = {
  success: 'border-success bg-success-soft text-success-soft-foreground',
  warning: 'border-warning bg-warning-soft text-warning-soft-foreground',
  danger: 'border-danger bg-danger-soft text-danger-soft-foreground',
  info: 'border-info bg-info-soft text-info-soft-foreground',
};

interface ToasterProps {
  regionLabel: string;
  closeLabel: string;
}

const NOTIFICATIONS_HOTKEY = ['altKey', 'KeyN'];

export function Toaster({ regionLabel, closeLabel }: ToasterProps) {
  const items = useToasts((state) => state.items);
  const dismiss = useToasts((state) => state.dismiss);
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4000} label={regionLabel}>
      {items.map((item) => {
        const Icon = ICONS[item.tone];
        return (
          <ToastPrimitive.Root
            key={item.id}
            type={item.tone === 'danger' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) dismiss(item.id);
            }}
            className={cn(
              'animate-fade-in flex items-start gap-3 rounded-lg border-l-4 p-4 shadow-lg',
              TONE_CLASS[item.tone],
            )}
          >
            <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <ToastPrimitive.Description className="flex-1 text-sm">
              {item.message}
            </ToastPrimitive.Description>
            <ToastPrimitive.Close
              aria-label={closeLabel}
              className="rounded p-0.5 hover:opacity-80"
            >
              <X className="size-4" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      {/* Radix réserve F8 par défaut : F8 appartient à la caisse (mise en attente, A.5). */}
      <ToastPrimitive.Viewport
        hotkey={NOTIFICATIONS_HOTKEY}
        label={`${regionLabel} (Alt+N)`}
        className="fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none"
      />
    </ToastPrimitive.Provider>
  );
}
