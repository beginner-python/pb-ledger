import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PeriodTotalEditModal from './PeriodTotalEditModal'

const baseProps = {
  isOpen: true,
  onClose: () => {},
  targetDate: { year: 2026, month: 10 },
  isSubmitting: false,
}

describe('PeriodTotalEditModal', () => {
  it('閉じているときは何も描画しない', () => {
    const { container } = render(
      <PeriodTotalEditModal {...baseProps} isOpen={false} initialAmount={1000} onSubmit={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('既存の上限を初期値として表示し、数値で送信する', async () => {
    const onSubmit = vi.fn()
    render(<PeriodTotalEditModal {...baseProps} initialAmount={250000} onSubmit={onSubmit} />)
    const input = screen.getByPlaceholderText('例: 150000') as HTMLInputElement
    expect(input.value).toBe('250000')
    await userEvent.clear(input)
    await userEvent.type(input, '300000')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalledWith(300000)
  })

  it('空のまま保存すると上限の解除 (null) を送る', async () => {
    const onSubmit = vi.fn()
    render(<PeriodTotalEditModal {...baseProps} initialAmount={null} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalledWith(null)
  })

  it('負の値は送信しない', async () => {
    const onSubmit = vi.fn()
    render(<PeriodTotalEditModal {...baseProps} initialAmount={null} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByPlaceholderText('例: 150000'), '-5')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
