import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, Label } from './basic';
import { Button } from './button';
import { Select, type SelectOption } from './radix';
import { cn } from '../../lib/cn';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}

/** Libellé, aide et message d'erreur reliés au champ (WCAG : aria-describedby, aria-invalid). */
function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint !== undefined && error === undefined && (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} role="alert" className="text-danger text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string): string | undefined {
  if (error !== undefined) return `${id}-error`;
  return hint === undefined ? undefined : `${id}-hint`;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, hint, error, id, ...props }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error}>
        <Input
          ref={ref}
          id={fieldId}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          {...props}
        />
      </FieldShell>
    );
  },
);
TextField.displayName = 'TextField';

export interface SecretFieldProps extends TextFieldProps {
  showLabel: string;
  hideLabel: string;
}

/** Champ secret (mot de passe, PIN, clé) avec bouton pour afficher la saisie. */
export const SecretField = forwardRef<HTMLInputElement, SecretFieldProps>(
  ({ label, hint, error, id, showLabel, hideLabel, className, ...props }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    const [visible, setVisible] = useState(false);
    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error}>
        <div className="relative">
          <Input
            ref={ref}
            id={fieldId}
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy(fieldId, hint, error)}
            className={cn('pr-12', className)}
            {...props}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-0 right-0"
            aria-label={visible ? hideLabel : showLabel}
            aria-pressed={visible}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        </div>
      </FieldShell>
    );
  },
);
SecretField.displayName = 'SecretField';

/** Message d'erreur global d'un formulaire (réponse du processus principal). */
export function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p
      role="alert"
      className="border-danger bg-danger-soft text-danger-soft-foreground rounded-md border px-4 py-3 text-sm font-medium"
    >
      {message}
    </p>
  );
}

export interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <FieldShell id={fieldId} label={label} hint={hint} error={error}>
        <textarea
          ref={ref}
          id={fieldId}
          rows={3}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(
            'border-input bg-surface text-surface-foreground placeholder:text-muted-foreground aria-[invalid=true]:border-danger w-full rounded-md border px-3 py-2 text-base',
            className,
          )}
          {...props}
        />
      </FieldShell>
    );
  },
);
TextAreaField.displayName = 'TextAreaField';

export interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  hint?: string | undefined;
  error?: string | undefined;
}

/** Liste de choix avec son libellé (relié par aria-labelledby) et une aide facultative. */
export function SelectField({
  label,
  value,
  options,
  onValueChange,
  disabled,
  hint,
  error,
}: SelectFieldProps) {
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId}>{label}</Label>
      <Select
        aria-labelledby={labelId}
        value={value}
        options={options}
        onValueChange={onValueChange}
        {...(disabled === undefined ? {} : { disabled })}
      />
      {hint !== undefined && error === undefined && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
      {error !== undefined && error !== '' && (
        <p role="alert" className="text-danger text-sm font-medium">
          {error}
        </p>
      )}
    </div>
  );
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

/** Case à cocher native (clavier et lecteurs d'écran) avec son libellé cliquable. */
export const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  ({ label, id, className, ...props }, ref) => {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          className="accent-primary size-5 shrink-0"
          {...props}
        />
        <Label htmlFor={fieldId}>{label}</Label>
      </div>
    );
  },
);
CheckboxField.displayName = 'CheckboxField';
