import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { authFetcher } from '../../../api/client'
import { buttonClasses } from '../../../ui/button'
import ModalBackdrop from '../../shared/components/ModalBackdrop'

import {
  createCategory,
  deleteCategory,
} from '../services/household'
import type { CreateCategoryInput, UpdateCategoryInput } from '../types/householdTypes'
import {
  DEFAULT_MANUAL_COLOR,
  autoCategoryColor,
  isValidHexColor,
  resolveCategoryColor,
} from '../utils/categoryColors'

type HouseholdCategoryOption = {
  id: number
  name: string
  color: string | null
  notes?: string | null
  parentId: number | null
  hasChildren?: boolean
}

type CategoryGroup = {
  parent: HouseholdCategoryOption
  children: HouseholdCategoryOption[]
}

type CategoryFormState = {
  name: string
  color: string
  notes: string
  parentId: string
}

const parseJsonSafely = async (res: Response) => {
  try {
    return await res.json()
  } catch {
    throw new Error(`サーバーエラー (status: ${res.status})`)
  }
}

type CategoryColorFieldProps = {
  idPrefix: string
  categoryName: string
  color: string
  onChange: (next: string) => void
}

// color が "" のとき = 自動。HEX値のとき = 手動。
// ピッカー/テキスト操作で手動化、「自動に戻す」で空文字列に戻す。
function CategoryColorField({
  idPrefix,
  categoryName,
  color,
  onChange,
}: CategoryColorFieldProps) {
  const [isTextFocused, setIsTextFocused] = useState(false)
  const isAuto = color === ''
  const trimmedName = categoryName.trim()
  const hasName = trimmedName !== ''
  // 自動モードかつ名前ありなら算出色を表示用にする (ピッカー/テキストが追従)。
  // 名前なしの自動モードでは算出対象がないので既定色を仮置き。
  const autoHex = hasName ? autoCategoryColor(trimmedName) : DEFAULT_MANUAL_COLOR
  const previewColor = hasName ? resolveCategoryColor(trimmedName, color) : null
  const pickerValue = isValidHexColor(color) ? color : autoHex
  // フォーカス中は color をそのまま反映 (空のままにできる)。
  // blur 時は自動なら算出色を表示、手動なら入力値をそのまま表示。
  const textValue = isTextFocused ? color : isAuto ? autoHex : color

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <div className="grid gap-2">
        <label className="text-xs font-semibold text-[#0d2b32]" htmlFor={`${idPrefix}-color`}>
          カラー
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${idPrefix}-color`}
            type="color"
            className="h-10 w-10 shrink-0 rounded-lg border border-[#d7dee4] bg-white p-1"
            value={pickerValue}
            onChange={(event) => onChange(event.target.value)}
            aria-label="カラーを選択"
          />
          <input
            type="text"
            className={`w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea] ${
              !isTextFocused && isAuto ? 'text-[#5d6a72]' : ''
            }`}
            value={textValue}
            onChange={(event) => onChange(event.target.value)}
            onFocus={(event) => {
              setIsTextFocused(true)
              // 自動モードで focus されたら算出色を初期値として埋める
              // (空フィールドではなく既存の HEX から編集を始められるように)。
              if (isAuto) onChange(autoHex)
              event.currentTarget.select()
            }}
            onBlur={() => setIsTextFocused(false)}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <label className="text-xs font-semibold text-[#0d2b32]" htmlFor={`${idPrefix}-preview`}>
          プレビュー
        </label>
        <div className="flex items-center gap-2">
          <div
            id={`${idPrefix}-preview`}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#d7dee4] bg-[#fbfbfc] px-3"
          >
            {hasName ? (
              <>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: previewColor ?? undefined }}
                ></span>
                <span className="truncate text-xs font-semibold text-[#0f1c22]">
                  {trimmedName}
                </span>
              </>
            ) : (
              <span className="text-xs text-[#8a98a0]">
                カテゴリ名を入力してください
              </span>
            )}
          </div>
          <button
            type="button"
            className={buttonClasses({
              variant: 'secondary',
              size: 'xs',
              shape: 'pill',
              className: `whitespace-nowrap ${isAuto ? 'cursor-not-allowed opacity-50' : ''}`,
            })}
            onClick={() => onChange('')}
            disabled={isAuto}
          >
            自動
          </button>
        </div>
      </div>
    </div>
  )
}

type CategoryRowProps = {
  category: HouseholdCategoryOption
  onEdit: (category: HouseholdCategoryOption) => void
  onDelete: (category: HouseholdCategoryOption) => void
  deletePending: boolean
  indent?: boolean
}

function CategoryRow({ category, onEdit, onDelete, deletePending, indent }: CategoryRowProps) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border border-[#e6ebef] bg-[#fbfbfc] px-3 py-2 ${
        indent ? 'border-dashed' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full"
          style={{ backgroundColor: resolveCategoryColor(category.name, category.color) }}
        ></span>
        <span className="text-xs font-semibold text-[#0f1c22]">{category.name}</span>
        {category.hasChildren && (
          <span className="rounded-full bg-[#e7f0ed] px-1.5 py-0.5 text-[10px] font-semibold text-[#0d2b32]">
            親
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClasses({ variant: 'secondary', size: 'xs', shape: 'pill' })}
          onClick={() => onEdit(category)}
        >
          編集
        </button>
        <button
          type="button"
          className={buttonClasses({ variant: 'danger', size: 'xs', shape: 'pill' })}
          onClick={() => onDelete(category)}
          disabled={deletePending}
        >
          削除
        </button>
      </div>
    </div>
  )
}

function validateCategory(
  input: CategoryFormState,
  categories?: HouseholdCategoryOption[]
): string | null {
  const name = input.name.trim()
  if (!name) return 'カテゴリ名を入力してください。'

  if (input.color !== '' && !isValidHexColor(input.color)) {
    return 'カラーは #RRGGBB 形式で入力してください。'
  }

  if (categories) {
    const parentId = input.parentId ? Number(input.parentId) : null
    const exists = categories.some(
      (category) => category.name === name && category.parentId === parentId
    )
    if (exists) return '同じ親カテゴリ内に同名のカテゴリが存在します。'
  }

  return null
}

export default function HouseholdCategoryPage() {
  const queryClient = useQueryClient()
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>({
    name: '',
    color: '',
    notes: '',
    parentId: '',
  })
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [categoryEditItem, setCategoryEditItem] = useState<HouseholdCategoryOption | null>(
    null
  )
  const [categoryEditForm, setCategoryEditForm] = useState<CategoryFormState>({
    name: '',
    color: '',
    notes: '',
    parentId: '',
  })
  const [categorySubmitMessage, setCategorySubmitMessage] = useState('')
  const [categoryEditMessage, setCategoryEditMessage] = useState('')

  const {
    data: categoryOptions,
    status: categoryStatus,
    error: categoryError,
  } = useQuery<HouseholdCategoryOption[], Error>({
    queryKey: ['household', 'categories'],
    queryFn: async () => {
      const res = await authFetcher('/api/household/categories/')
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || 'カテゴリ取得に失敗しました。')
      }
      return parsed as HouseholdCategoryOption[]
    },
    staleTime: 0,
  })

  const sortedCategories = useMemo(() => {
    return (categoryOptions ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
  }, [categoryOptions])

  // 親→子の階層構造を組み立てる。親なしカテゴリは parent 自身として 1 グループ扱い。
  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const topLevel = sortedCategories.filter((c) => c.parentId === null)
    const childrenByParent = new Map<number, HouseholdCategoryOption[]>()
    for (const category of sortedCategories) {
      if (category.parentId !== null) {
        const list = childrenByParent.get(category.parentId) ?? []
        list.push(category)
        childrenByParent.set(category.parentId, list)
      }
    }
    return topLevel.map((parent) => ({
      parent,
      children: childrenByParent.get(parent.id) ?? [],
    }))
  }, [sortedCategories])

  // 親に指定できるのはトップレベル (parentId === null) のみ。
  const parentSelectOptions = useMemo(() => {
    return sortedCategories.filter((category) => category.parentId === null)
  }, [sortedCategories])


  const craeteCategoryMutation = useMutation({
    mutationFn: (vars: CreateCategoryInput) => createCategory(vars),
    onSuccess: async () => {
      setCategorySubmitMessage("カテゴリを登録しました。")
      setCategoryForm({
        name: '',
        color: '',
        notes: '',
        parentId: '',
      })
      await queryClient.invalidateQueries({ queryKey: ['household', 'categories'] })
      setTimeout(() => setIsAddModalOpen(false), 500)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'カテゴリの登録に失敗しました。'
      setCategorySubmitMessage(message)
    },
  })

  const submitCategory = () => {
    const errorMessage = validateCategory(
      categoryForm,
      categoryOptions
    )
    if (errorMessage) {
      setCategorySubmitMessage(errorMessage)
      return
    }
    craeteCategoryMutation.mutate({
      name: categoryForm.name,
      color: categoryForm.color,
      notes: categoryForm.notes,
      parentId: categoryForm.parentId ? Number(categoryForm.parentId) : null,
    })
  }

  const handleCategorySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitCategory()
  }

  const openCategoryEdit = (category: HouseholdCategoryOption) => {
    setIsAddModalOpen(false)
    setCategoryEditItem(category)
    setCategoryEditForm({
      name: category.name,
      color: category.color ?? '',
      notes: category.notes ?? '',
      parentId: category.parentId ? String(category.parentId) : '',
    })
    setCategoryEditMessage('')
  }

  const updateCategoryMutation = useMutation({
    mutationFn: async (vars: UpdateCategoryInput) => {
      const res = await authFetcher(`/api/household/categories/${vars.id}/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: vars.name,
          color: vars.color,
          notes: vars.notes,
          parentId: vars.parentId,
        }),
      })
      const parsed = await parseJsonSafely(res)
      if (!res.ok) {
        throw new Error(parsed?.detail || 'カテゴリの更新に失敗しました。')
      }
      return parsed
    },
    onSuccess: async () => {
      setCategoryEditMessage('カテゴリを更新しました。')
      await queryClient.invalidateQueries({ queryKey: ['household', 'categories'] })
      setTimeout(() => setCategoryEditItem(null), 500)
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'カテゴリの更新に失敗しました。'
      setCategoryEditMessage(message)
    },
  })

  const handleCategoryUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!categoryEditItem) return
    setCategoryEditMessage('')

    if (!categoryEditForm.name.trim()) {
      setCategoryEditMessage('カテゴリ名を入力してください。')
      return
    }

    if (categoryEditForm.color !== '' && !isValidHexColor(categoryEditForm.color)) {
      setCategoryEditMessage('カラーは #RRGGBB 形式で入力してください。')
      return
    }

    updateCategoryMutation.mutate({
      id: categoryEditItem.id,
      name: categoryEditForm.name,
      color: categoryEditForm.color,
      notes: categoryEditForm.notes,
      parentId: categoryEditForm.parentId ? Number(categoryEditForm.parentId) : null,
    })
  }

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['household', 'categories'] })
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'カテゴリの削除に失敗しました。'
      window.alert(message)
    },
  })

  const handleCategoryDelete = (category: HouseholdCategoryOption) => {
    if (!window.confirm(`カテゴリ「${category.name}」を削除しますか？`)) return
    deleteCategoryMutation.mutate(category.id)
  }

  return (
    <section className="flex w-full flex-col gap-6">
      <div className="rounded-2xl border border-[#e0e6eb] bg-white p-4 shadow-[0_12px_26px_rgba(16,38,49,0.12)]">
        <div>
          <h2 className="text-xl font-semibold text-[#0d2b32]">カテゴリ管理</h2>
          <p className="mt-1 text-xs text-[#5d6a72]">
            カテゴリの追加や編集をこちらで行います。
          </p>
          <div className="mt-2">
            <button
              type="button"
              className={buttonClasses({ variant: 'primary', size: 'xs', shape: 'pill' })}
              aria-label="カテゴリを追加"
              onClick={() => {
                setCategorySubmitMessage('')
                setIsAddModalOpen(true)
              }}
            >
              ＋カテゴリ
            </button>
          </div>
        </div>
        {categoryStatus === 'error' && (
          <p className="mt-2 text-sm text-[#a33a2b]">
            {categoryError?.message ?? 'カテゴリを取得できませんでした。'}
          </p>
        )}
        <div className="mt-3 space-y-3">
          {categoryGroups.map((group) => (
            <div key={group.parent.id} className="space-y-1">
              <CategoryRow
                category={group.parent}
                onEdit={openCategoryEdit}
                onDelete={handleCategoryDelete}
                deletePending={deleteCategoryMutation.isPending}
              />
              {group.children.length > 0 && (
                <div className="space-y-1 pl-5">
                  {group.children.map((child) => (
                    <CategoryRow
                      key={child.id}
                      category={child}
                      onEdit={openCategoryEdit}
                      onDelete={handleCategoryDelete}
                      deletePending={deleteCategoryMutation.isPending}
                      indent
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isAddModalOpen && (
        <ModalBackdrop
          onClose={() => setIsAddModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#0d2b32]">カテゴリの追加</h3>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  新しいカテゴリを追加します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => {
                  setIsAddModalOpen(false)
                }}
              >
                閉じる
              </button>
            </div>
            <form className="mt-5 grid gap-3" onSubmit={handleCategorySubmit}>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="category-name">
                  カテゴリ名
                </label>
                <input
                  id="category-name"
                  type="text"
                  placeholder="例: 日用品"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>
              <CategoryColorField
                idPrefix="category"
                categoryName={categoryForm.name}
                color={categoryForm.color}
                onChange={(next) =>
                  setCategoryForm((prev) => ({ ...prev, color: next }))
                }
              />
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="category-parent">
                  親カテゴリ
                </label>
                <select
                  id="category-parent"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={categoryForm.parentId}
                  onChange={(event) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      parentId: event.target.value,
                    }))
                  }
                >
                  <option value="">親カテゴリなし</option>
                  {parentSelectOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#5d6a72]">親に指定できるのはトップレベルのカテゴリのみです。</p>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="category-notes">
                  備考
                </label>
                <textarea
                  id="category-notes"
                  rows={3}
                  placeholder="例: 日常の消耗品など"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={categoryForm.notes}
                  onChange={(event) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                ></textarea>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
                  onClick={() =>
                    setCategoryForm({
                      name: '',
                      color: '',
                      notes: '',
                      parentId: '',
                    })
                  }
                >
                  クリア
                </button>
                <div className="flex flex-col items-end gap-1 text-right">
                  <button
                    type="submit"
                    disabled={craeteCategoryMutation.isPending}
                    className={buttonClasses({
                      variant: 'primary',
                      size: 'md',
                      shape: 'pill',
                      className:
                        craeteCategoryMutation.isPending
                          ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                          : 'px-5',
                    })}
                  >
                    {craeteCategoryMutation.isPending ? '保存中...' : '保存'}
                  </button>
                  {categorySubmitMessage !== '' && (
                    <span
                      className={`text-[0.7rem] ${craeteCategoryMutation.isError ||
                          (!craeteCategoryMutation.isSuccess && !craeteCategoryMutation.isPending)
                          ? 'text-[#a33a2b]'
                          : 'text-[#0e4f2c]'
                        }`}
                    >
                      {categorySubmitMessage}
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}

      {categoryEditItem && (
        <ModalBackdrop
          onClose={() => setCategoryEditItem(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
        >
          <div className="max-h-[calc(100vh-3rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-[#d7dee4] bg-white p-6 shadow-[0_30px_60px_rgba(15,28,34,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#0d2b32]">カテゴリの編集</h3>
                <p className="mt-1 text-xs text-[#5d6a72]">
                  既存カテゴリの名称や色を更新します。
                </p>
              </div>
              <button
                type="button"
                className={buttonClasses({ variant: 'secondary', size: 'sm', shape: 'pill' })}
                onClick={() => {
                  setCategoryEditItem(null)
                }}
              >
                閉じる
              </button>
            </div>
            <form className="mt-5 grid gap-3" onSubmit={handleCategoryUpdate}>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-category-name">
                  カテゴリ名
                </label>
                <input
                  id="edit-category-name"
                  type="text"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={categoryEditForm.name}
                  onChange={(event) =>
                    setCategoryEditForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </div>
              <CategoryColorField
                idPrefix="edit-category"
                categoryName={categoryEditForm.name}
                color={categoryEditForm.color}
                onChange={(next) =>
                  setCategoryEditForm((prev) => ({ ...prev, color: next }))
                }
              />
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-category-parent">
                  親カテゴリ
                </label>
                <select
                  id="edit-category-parent"
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea] disabled:cursor-not-allowed disabled:bg-[#f2f4f6]"
                  value={categoryEditForm.parentId}
                  onChange={(event) =>
                    setCategoryEditForm((prev) => ({
                      ...prev,
                      parentId: event.target.value,
                    }))
                  }
                  disabled={categoryEditItem.hasChildren === true}
                >
                  <option value="">親カテゴリなし</option>
                  {parentSelectOptions
                    .filter((category) => category.id !== categoryEditItem.id)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-[#5d6a72]">
                  {categoryEditItem.hasChildren
                    ? '子カテゴリを持つため、別カテゴリの子にはできません。'
                    : '親に指定できるのはトップレベルのカテゴリのみです。'}
                </p>
              </div>
              <div className="grid gap-2">
                <label className="text-xs font-semibold text-[#0d2b32]" htmlFor="edit-category-notes">
                  備考
                </label>
                <textarea
                  id="edit-category-notes"
                  rows={3}
                  className="w-full rounded-xl border border-[#d7dee4] bg-white px-3 py-2 text-sm text-[#0f1c22] shadow-sm outline-none transition focus:border-[#157665] focus:ring-2 focus:ring-[#d7f1ea]"
                  value={categoryEditForm.notes}
                  onChange={(event) =>
                    setCategoryEditForm((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                ></textarea>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  className={buttonClasses({ variant: 'secondary', size: 'md', shape: 'pill' })}
                  onClick={() =>
                    setCategoryEditForm({
                      name: categoryEditItem.name,
                      color: categoryEditItem.color ?? '',
                      notes: categoryEditItem.notes ?? '',
                      parentId: categoryEditItem.parentId ? String(categoryEditItem.parentId) : '',
                    })
                  }
                >
                  リセット
                </button>
                <div className="flex flex-col items-end gap-1 text-right">
                  <button
                    type="submit"
                    disabled={updateCategoryMutation.isPending}
                    className={buttonClasses({
                      variant: 'primary',
                      size: 'md',
                      shape: 'pill',
                      className:
                        updateCategoryMutation.isPending
                          ? 'border-transparent bg-[#cfd8dd] text-[#60707a] shadow-none hover:translate-y-0'
                          : 'px-5',
                    })}
                  >
                    {updateCategoryMutation.isPending ? '更新中...' : '更新'}
                  </button>
                  {categoryEditMessage !== '' && (
                    <span
                      className={`text-[0.7rem] ${updateCategoryMutation.isError ||
                          (!updateCategoryMutation.isSuccess && !updateCategoryMutation.isPending)
                          ? 'text-[#a33a2b]'
                          : 'text-[#0e4f2c]'
                        }`}
                    >
                      {categoryEditMessage}
                    </span>
                  )}
                </div>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      )}
    </section>
  )
}
