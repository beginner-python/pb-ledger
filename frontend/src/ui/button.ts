export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'icon'

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon'

export type ButtonShape = 'pill' | 'rounded' | 'square'

const base =
  'inline-flex items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-65'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border border-[#1a7b6d] bg-[linear-gradient(135deg,#1b7a6c,#2a9280)] text-[#f6fffb] shadow-[0_8px_18px_rgba(31,146,127,0.28)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(26,123,109,0.28)]',
  secondary:
    'border border-[#d7dee4] bg-white text-[#0f1c22] hover:border-[#157665] hover:bg-[#eff6f7]',
  ghost:
    'border border-[#d7dee4] bg-[#f7f9fb] text-[#0f1c22] hover:border-[#157665] hover:bg-[#eff6f7]',
  danger:
    'border border-[#f2b4b4] bg-[#fff1f2] text-[#b91c1c] hover:border-[#ef4444] hover:bg-[#ffe4e6]',
  success:
    'border border-[#157665] bg-[#e6f4ec] text-[#0e4f2c] hover:bg-[#dff1e9]',
  icon: 'border border-[#d7dee4] bg-white hover:border-[#157665] hover:bg-[#f1faf7]',
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-[0.7rem]',
  sm: 'px-3 py-1 text-xs',
  md: 'px-4 py-2 text-xs',
  lg: 'px-5 py-3 text-sm',
  icon: 'h-11 w-11',
}

const shapeClasses: Record<ButtonShape, string> = {
  pill: 'rounded-full',
  rounded: 'rounded-xl',
  square: 'rounded-[10px]',
}

const cx = (...values: Array<string | null | undefined | false>) =>
  values.filter(Boolean).join(' ')

export const buttonClasses = (options: {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  className?: string
} = {}) => {
  const {
    variant = 'secondary',
    size = 'md',
    shape = 'pill',
    className,
  } = options
  return cx(base, variantClasses[variant], sizeClasses[size], shapeClasses[shape], className)
}

export const tabButtonClasses = (active: boolean) =>
  cx(
    'flex-1 rounded-xl border px-4 py-2.5 text-center font-bold transition duration-150 hover:-translate-y-0.5',
    active
      ? 'border-[#157665] bg-[linear-gradient(135deg,#1b7a6c,#1f927f)] text-[#f6fffb] shadow-[0_8px_20px_rgba(27,122,108,0.26)]'
      : 'border-[#d7dee4] bg-[#f7f9fb] text-[#0f1c22]'
  )
