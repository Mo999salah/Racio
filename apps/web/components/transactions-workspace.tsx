'use client';

import { useEffect, useMemo, useState } from 'react';

type Labels = Record<string, string>;
type Category = { id: string; name: string; role?: string; status?: string };
type Tag = { id: string; name: string; archivedAt?: string | null };
type Account = { id: string; displayName: string; institutionId: string; currencyCode: string };
type Institution = { id: string; name: string };
type SortState = { field: 'bookingDate' | 'amount' | 'description'; direction: 'asc' | 'desc' };
type FilterState = {
  dateFrom?: string;
  dateTo?: string;
  accountId?: string;
  institutionId?: string;
  direction?: 'credit' | 'debit' | 'unknown';
  currency?: string;
  primaryCategoryId?: string;
  secondaryCategoryId?: string;
  tagId?: string;
  reviewed?: 'true' | 'false';
  categorised?: 'true' | 'false';
  statementId?: string;
  search?: string;
  amountExact?: string;
  amountMin?: string;
  amountMax?: string;
  includeArchived: 'true' | 'false';
};
type SavedView = {
  id: string;
  name: string;
  filters: Partial<FilterState>;
  sort: SortState;
  isDefault: boolean;
};
type Transaction = {
  id: string;
  bookingDate: string;
  amount: string;
  currencyCode: string;
  direction: 'credit' | 'debit' | 'unknown';
  rawDescription: string;
  importedDescription: string;
  userDescription: string | null;
  userCounterparty: string | null;
  userNote: string | null;
  accountName: string;
  institutionName: string;
  sourceType: string;
  reviewed: boolean;
  primaryCategory: Category | null;
  secondaryCategories: Category[];
  tags: Tag[];
  merchantId: string | null;
  merchantName: string | null;
};
type SplitDraft = {
  amount: string;
  currencyCode: string;
  description: string;
  primaryCategoryId: string;
  secondaryCategoryIds: string[];
  tagIds: string[];
  note: string;
};

function displayAmount(amount: string, currency: string) {
  return `${amount} ${currency}`;
}

const emptyFilters: FilterState = { includeArchived: 'false' };

function querySort(sort: SortState) {
  if (sort.field === 'amount') return sort.direction === 'asc' ? 'amountAsc' : 'amountDesc';
  if (sort.field === 'description')
    return sort.direction === 'asc' ? 'descriptionAsc' : 'descriptionDesc';
  return sort.direction === 'asc' ? 'bookingDateAsc' : 'bookingDateDesc';
}

function cleanFilters(filters: FilterState): Partial<FilterState> {
  return Object.fromEntries(
    Object.entries(filters).filter(([key, value]) => key === 'includeArchived' || value),
  ) as Partial<FilterState>;
}

function sanitiseView(
  view: SavedView,
  categories: Category[],
  tags: Tag[],
  accounts: Account[],
  institutions: Institution[],
) {
  const filters = { ...view.filters };
  const invalid: string[] = [];
  const references: Array<[keyof FilterState, Set<string>, string]> = [
    [
      'primaryCategoryId',
      new Set(categories.filter((item) => item.status !== 'archived').map((item) => item.id)),
      'category',
    ],
    [
      'secondaryCategoryId',
      new Set(categories.filter((item) => item.status !== 'archived').map((item) => item.id)),
      'category',
    ],
    ['tagId', new Set(tags.filter((item) => !item.archivedAt).map((item) => item.id)), 'tag'],
    ['accountId', new Set(accounts.map((item) => item.id)), 'account'],
    ['institutionId', new Set(institutions.map((item) => item.id)), 'institution'],
  ];
  for (const [key, valid, label] of references) {
    const value = filters[key];
    if (value && !valid.has(value)) {
      delete filters[key];
      invalid.push(label);
    }
  }
  return { filters: { ...emptyFilters, ...filters }, warning: [...new Set(invalid)].join(', ') };
}

export function TransactionsWorkspace({
  labels,
  advanced,
  locale,
  initialFilters = {},
  hasExplicitFilters = false,
}: {
  labels: Labels;
  advanced: boolean;
  locale: string;
  initialFilters?: Partial<FilterState>;
  hasExplicitFilters?: boolean;
}) {
  const [items, setItems] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [merchants, setMerchants] = useState<{ id: string; displayName: string; status: string }[]>(
    [],
  );
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [filters, setFilters] = useState<FilterState>({ ...emptyFilters, ...initialFilters });
  const [appliedFilters, setAppliedFilters] = useState<FilterState>({
    ...emptyFilters,
    ...initialFilters,
  });
  const [sort, setSort] = useState<SortState>({ field: 'bookingDate', direction: 'desc' });
  const [activeViewId, setActiveViewId] = useState('');
  const [viewWarning, setViewWarning] = useState('');
  const [viewName, setViewName] = useState('');
  const [showViews, setShowViews] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ total: 0, hasMore: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState('mark-reviewed');
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkTagId, setBulkTagId] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [splitDrafts, setSplitDrafts] = useState<SplitDraft[]>([]);
  const [splitHasSavedSet, setSplitHasSavedSet] = useState(false);

  const activeView = useMemo(
    () => savedViews.find((view) => view.id === activeViewId) ?? null,
    [activeViewId, savedViews],
  );

  async function load(nextOffset = offset, nextFilters = appliedFilters, nextSort = sort) {
    setLoading(true);
    const query = new URLSearchParams({
      limit: '25',
      offset: String(nextOffset),
      includeArchived: nextFilters.includeArchived,
      sort: querySort(nextSort),
    });
    for (const [key, value] of Object.entries(nextFilters)) if (value) query.set(key, value);
    const [
      transactionResponse,
      categoryResponse,
      tagResponse,
      accountResponse,
      institutionResponse,
      merchantResponse,
    ] = await Promise.all([
      fetch(`/api/transactions?${query.toString()}`, { cache: 'no-store' }),
      fetch('/api/categories', { cache: 'no-store' }),
      fetch('/api/tags', { cache: 'no-store' }),
      fetch('/api/accounts', { cache: 'no-store' }),
      fetch('/api/institutions', { cache: 'no-store' }),
      fetch('/api/merchants', { cache: 'no-store' }),
    ]);
    if (transactionResponse.ok) {
      const data = await transactionResponse.json();
      setItems(data.items);
      setPage(data.page);
      setSelectedIds([]);
    }
    if (categoryResponse.ok) setCategories(await categoryResponse.json());
    if (tagResponse.ok) setTags(await tagResponse.json());
    if (accountResponse.ok) setAccounts(await accountResponse.json());
    if (institutionResponse.ok) setInstitutions(await institutionResponse.json());
    if (merchantResponse.ok) setMerchants(await merchantResponse.json());
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function initialise() {
      const response = await Promise.all([
        fetch('/api/categories', { cache: 'no-store' }),
        fetch('/api/tags', { cache: 'no-store' }),
        fetch('/api/accounts', { cache: 'no-store' }),
        fetch('/api/institutions', { cache: 'no-store' }),
        fetch('/api/merchants', { cache: 'no-store' }),
        fetch('/api/saved-views', { cache: 'no-store' }),
      ]);
      const [
        categoryResponse,
        tagResponse,
        accountResponse,
        institutionResponse,
        merchantResponse,
        viewResponse,
      ] = response;
      const nextCategories = categoryResponse.ok ? await categoryResponse.json() : [];
      const nextTags = tagResponse.ok ? await tagResponse.json() : [];
      const nextAccounts = accountResponse.ok ? await accountResponse.json() : [];
      const nextInstitutions = institutionResponse.ok ? await institutionResponse.json() : [];
      const nextMerchants = merchantResponse.ok ? await merchantResponse.json() : [];
      const nextViews = viewResponse.ok ? await viewResponse.json() : [];
      if (cancelled) return;
      setCategories(nextCategories);
      setTags(nextTags);
      setAccounts(nextAccounts);
      setInstitutions(nextInstitutions);
      setMerchants(nextMerchants);
      setSavedViews(nextViews);
      const defaultView = !hasExplicitFilters
        ? (nextViews as SavedView[]).find((view) => view.isDefault)
        : undefined;
      const chosen = defaultView
        ? sanitiseView(defaultView, nextCategories, nextTags, nextAccounts, nextInstitutions)
        : { filters: { ...emptyFilters, ...initialFilters }, warning: '' };
      const nextFilters = chosen.filters as FilterState;
      setFilters(nextFilters);
      setAppliedFilters(nextFilters);
      setActiveViewId(defaultView && !hasExplicitFilters ? defaultView.id : '');
      setViewWarning(
        chosen.warning
          ? `${labels.invalidView ?? 'Saved view references were removed'}: ${chosen.warning}`
          : '',
      );
      await load(0, nextFilters, defaultView?.sort ?? { field: 'bookingDate', direction: 'desc' });
      if (defaultView?.sort) setSort(defaultView.sort);
    }
    void initialise();
    return () => {
      cancelled = true;
    };
    // Initial load intentionally runs once so a default view is resolved before the ledger query.
  }, []);

  useEffect(() => {
    if (!selected) {
      setSplitDrafts([]);
      setSplitHasSavedSet(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/transactions/${selected.id}/splits`, { cache: 'no-store' })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.splits) ? data.splits : [];
        setSplitHasSavedSet(rows.length > 0);
        setSplitDrafts(
          rows.map(
            (row: {
              amount: string;
              currencyCode: string;
              description: string | null;
              note: string | null;
              primaryCategory: { categoryId: string } | null;
              secondaryCategories: { categoryId: string }[];
              tags: { tagId: string }[];
            }) => ({
              amount: row.amount,
              currencyCode: row.currencyCode,
              description: row.description ?? '',
              primaryCategoryId: row.primaryCategory?.categoryId ?? '',
              secondaryCategoryIds: row.secondaryCategories.map((item) => item.categoryId),
              tagIds: row.tags.map((item) => item.tagId),
              note: row.note ?? '',
            }),
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function updateFilter(key: keyof FilterState, value: string) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  function applyFilters(nextFilters = filters, nextSort = sort, nextViewId = '') {
    setAppliedFilters(nextFilters);
    setActiveViewId(nextViewId);
    setOffset(0);
    void load(0, nextFilters, nextSort);
  }

  async function saveView(isUpdate = false) {
    const name = viewName.trim() || activeView?.name;
    if (!name)
      return setNotice(labels.viewNameRequired ?? labels.error ?? 'A view name is required.');
    const body = {
      name,
      filters: cleanFilters(appliedFilters),
      sort,
      isDefault: activeView?.isDefault ?? false,
    };
    const response = await fetch(
      isUpdate && activeView ? `/api/saved-views/${activeView.id}` : '/api/saved-views',
      {
        method: isUpdate && activeView ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) return setNotice(labels.error ?? 'Update failed');
    const saved = await response.json();
    setSavedViews((current) => {
      const next = isUpdate
        ? current.map((view) => (view.id === saved.id ? saved : view))
        : [saved, ...current];
      return next;
    });
    setActiveViewId(saved.id);
    setViewName('');
    setNotice(labels.saved ?? 'Saved');
  }

  async function manageView(id: string, action: 'default' | 'delete' | 'rename') {
    const view = savedViews.find((item) => item.id === id);
    if (!view) return;
    if (action === 'delete') {
      const response = await fetch(`/api/saved-views/${id}`, { method: 'DELETE' });
      if (!response.ok) return setNotice(labels.error ?? 'Update failed');
      setSavedViews((current) => current.filter((item) => item.id !== id));
      if (activeViewId === id) {
        setActiveViewId('');
        setFilters(emptyFilters);
        applyFilters(emptyFilters, sort);
      }
      return;
    }
    if (action === 'rename') {
      const name = window.prompt(labels.viewName ?? 'View name', view.name)?.trim();
      if (!name) return;
      const response = await fetch(`/api/saved-views/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return setNotice(labels.error ?? 'Update failed');
      const updated = await response.json();
      setSavedViews((current) => current.map((item) => (item.id === id ? updated : item)));
      return;
    }
    const response = await fetch(`/api/saved-views/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    if (!response.ok) return setNotice(labels.error ?? 'Update failed');
    const updated = await response.json();
    setSavedViews((current) =>
      current.map((item) => ({ ...item, isDefault: item.id === updated.id })),
    );
  }

  async function chooseView(id: string) {
    if (!id) {
      setFilters(emptyFilters);
      applyFilters(emptyFilters, sort);
      return;
    }
    const view = savedViews.find((item) => item.id === id);
    if (!view) return;
    const safe = sanitiseView(view, categories, tags, accounts, institutions);
    const nextFilters = safe.filters as FilterState;
    setFilters(nextFilters);
    setViewWarning(
      safe.warning
        ? `${labels.invalidView ?? 'Saved view references were removed'}: ${safe.warning}`
        : '',
    );
    setSort(view.sort);
    applyFilters(nextFilters, view.sort, view.id);
  }

  async function saveMetadata(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/transactions/${selected.id}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userDescription: String(form.get('userDescription') || '') || null,
        userCounterparty: String(form.get('userCounterparty') || '') || null,
        userNote: String(form.get('userNote') || '') || null,
        reviewed: form.get('reviewed') === 'on',
      }),
    });
    if (response.ok) {
      setSelected(await response.json());
      setNotice(labels.saved ?? 'Saved');
      void load(offset);
    } else setNotice(labels.error ?? 'Update failed');
  }

  async function saveClassification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/transactions/${selected.id}/classification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primaryCategoryId: String(form.get('primaryCategoryId') || '') || null,
        secondaryCategoryIds: form.getAll('secondaryCategoryIds').map(String),
        tagIds: form.getAll('tagIds').map(String),
      }),
    });
    if (response.ok) {
      setSelected(await response.json());
      setNotice(labels.saved ?? 'Saved');
      void load(offset);
    } else setNotice(labels.error ?? 'Update failed');
  }

  async function saveMerchant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/transactions/${selected.id}/merchant`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchantId: String(form.get('merchantId') || '') || null }),
    });
    if (response.ok) {
      const assignment = await response.json();
      setSelected((current) =>
        current
          ? {
              ...current,
              merchantId: assignment.merchantId,
              merchantName:
                merchants.find((merchant) => merchant.id === assignment.merchantId)?.displayName ??
                null,
            }
          : current,
      );
      setNotice(labels.saved ?? 'Saved');
      void load(offset);
    } else setNotice(labels.error ?? 'Update failed');
  }

  async function runBulkAction() {
    if (!selectedIds.length) return;
    const response = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionIds: selectedIds,
        action: bulkAction,
        ...(bulkAction.includes('category') ? { categoryId: bulkCategoryId } : {}),
        ...(bulkAction.includes('tag') ? { tagId: bulkTagId } : {}),
      }),
    });
    if (response.ok) {
      setNotice(labels.saved ?? 'Saved');
      setSelectedIds([]);
      void load(offset);
    } else setNotice(labels.error ?? 'Update failed');
  }

  async function saveSplits() {
    if (!selected) return;
    const response = await fetch(`/api/transactions/${selected.id}/splits`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        splits: splitDrafts.map((split, position) => ({
          ...split,
          position,
          description: split.description || null,
          note: split.note || null,
        })),
      }),
    });
    if (response.ok) {
      setSplitHasSavedSet(splitDrafts.length > 0);
      setNotice(labels.saved ?? 'Saved');
    } else setNotice(labels.error ?? 'Update failed');
  }

  return (
    <div className="ledger-workspace">
      <div className="saved-view-bar">
        <label>
          {labels.savedViews ?? 'Saved views'}
          <select value={activeViewId} onChange={(event) => void chooseView(event.target.value)}>
            <option value="">{labels.currentView ?? 'Current filters'}</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
                {view.isDefault ? ` · ${labels.defaultView ?? 'Default'}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          {labels.viewName ?? 'View name'}
          <input value={viewName} onChange={(event) => setViewName(event.target.value)} />
        </label>
        <button className="primary-button" type="button" onClick={() => void saveView()}>
          {labels.saveView ?? 'Save current view'}
        </button>
        {activeView && (
          <button className="text-button" type="button" onClick={() => void saveView(true)}>
            {labels.updateView ?? 'Update view'}
          </button>
        )}
        <button className="text-button" type="button" onClick={() => setShowViews(true)}>
          {labels.manageViews ?? 'Manage views'}
        </button>
      </div>
      <form
        className="ledger-filters"
        onSubmit={(event) => {
          event.preventDefault();
          applyFilters(filters, sort);
        }}
      >
        <label>
          {labels.search}
          <input
            value={filters.search ?? ''}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </label>
        <label>
          {labels.dateFrom ?? 'From'}
          <input
            type="date"
            value={filters.dateFrom ?? ''}
            onChange={(event) => updateFilter('dateFrom', event.target.value)}
          />
        </label>
        <label>
          {labels.dateTo ?? 'To'}
          <input
            type="date"
            value={filters.dateTo ?? ''}
            onChange={(event) => updateFilter('dateTo', event.target.value)}
          />
        </label>
        <label>
          {labels.reviewed}
          <select
            value={filters.reviewed ?? ''}
            onChange={(event) => updateFilter('reviewed', event.target.value)}
          >
            <option value="">{labels.reviewed}</option>
            <option value="true">{labels.reviewed}</option>
            <option value="false">{labels.notReviewed}</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          {labels.applyFilters}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => {
            setFilters(emptyFilters);
            applyFilters(emptyFilters, sort);
          }}
        >
          {labels.clearFilters}
        </button>
        <button
          className="text-button"
          type="button"
          aria-expanded={showAdvancedFilters}
          onClick={() => setShowAdvancedFilters((value) => !value)}
        >
          {labels.advancedFilters ?? 'More filters'}
        </button>
        <label>
          {labels.sort ?? 'Sort'}
          <select
            value={`${sort.field}:${sort.direction}`}
            onChange={(event) => {
              const [field, direction] = event.target.value.split(':') as [
                SortState['field'],
                SortState['direction'],
              ];
              const next = { field, direction };
              setSort(next);
              applyFilters(appliedFilters, next, activeViewId);
            }}
          >
            <option value="bookingDate:desc">{labels.newest ?? 'Newest'}</option>
            <option value="bookingDate:asc">{labels.oldest ?? 'Oldest'}</option>
            <option value="amount:asc">{labels.amountLow ?? 'Amount low to high'}</option>
            <option value="amount:desc">{labels.amountHigh ?? 'Amount high to low'}</option>
            <option value="description:asc">{labels.descriptionAsc ?? 'Description A-Z'}</option>
            <option value="description:desc">{labels.descriptionDesc ?? 'Description Z-A'}</option>
          </select>
        </label>
      </form>
      {showAdvancedFilters && (
        <div className="ledger-filters ledger-filters-advanced">
          <label>
            {labels.account}
            <select
              value={filters.accountId ?? ''}
              onChange={(event) => updateFilter('accountId', event.target.value)}
            >
              <option value="">{labels.allAccounts ?? 'All accounts'}</option>
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.institution ?? 'Institution'}
            <select
              value={filters.institutionId ?? ''}
              onChange={(event) => updateFilter('institutionId', event.target.value)}
            >
              <option value="">{labels.allInstitutions ?? 'All institutions'}</option>
              {institutions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {labels.direction ?? 'Direction'}
            <select
              value={filters.direction ?? ''}
              onChange={(event) => updateFilter('direction', event.target.value)}
            >
              <option value="">{labels.allDirections ?? 'All directions'}</option>
              <option value="debit">{labels.debit ?? 'Debit'}</option>
              <option value="credit">{labels.credit ?? 'Credit'}</option>
              <option value="unknown">{labels.unknown ?? 'Unknown'}</option>
            </select>
          </label>
          <label>
            {labels.currency ?? 'Currency'}
            <input
              maxLength={3}
              value={filters.currency ?? ''}
              onChange={(event) => updateFilter('currency', event.target.value.toUpperCase())}
            />
          </label>
          <label>
            {labels.primaryCategory}
            <select
              value={filters.primaryCategoryId ?? ''}
              onChange={(event) => updateFilter('primaryCategoryId', event.target.value)}
            >
              <option value="">{labels.allCategories ?? 'All categories'}</option>
              {categories
                .filter((item) => item.status !== 'archived')
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {labels.tags}
            <select
              value={filters.tagId ?? ''}
              onChange={(event) => updateFilter('tagId', event.target.value)}
            >
              <option value="">{labels.allTags ?? 'All tags'}</option>
              {tags
                .filter((item) => !item.archivedAt)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {labels.amountExact ?? 'Exact amount'}
            <input
              inputMode="decimal"
              value={filters.amountExact ?? ''}
              onChange={(event) => updateFilter('amountExact', event.target.value)}
            />
          </label>
          <label>
            {labels.amountMin ?? 'Minimum amount'}
            <input
              inputMode="decimal"
              value={filters.amountMin ?? ''}
              onChange={(event) => updateFilter('amountMin', event.target.value)}
            />
          </label>
          <label>
            {labels.amountMax ?? 'Maximum amount'}
            <input
              inputMode="decimal"
              value={filters.amountMax ?? ''}
              onChange={(event) => updateFilter('amountMax', event.target.value)}
            />
          </label>
          <label>
            {labels.categorised ?? 'Categorised'}
            <select
              value={filters.categorised ?? ''}
              onChange={(event) => updateFilter('categorised', event.target.value)}
            >
              <option value="">{labels.any ?? 'Any'}</option>
              <option value="true">{labels.categorisedYes ?? 'Categorised'}</option>
              <option value="false">{labels.uncategorised}</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={filters.includeArchived === 'true'}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  includeArchived: event.target.checked ? 'true' : 'false',
                }))
              }
            />
            {labels.includeArchived ?? 'Include archived'}
          </label>
        </div>
      )}
      {viewWarning && (
        <p className="form-warning" role="status">
          {viewWarning}
        </p>
      )}
      <p className="accounts-notice form-success" role="status">
        {notice}
      </p>
      {selectedIds.length > 0 && (
        <div className="bulk-actions">
          <span>
            {selectedIds.length} {labels.selected}
          </span>
          <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value)}>
            <option value="mark-reviewed">{labels.markReviewed}</option>
            <option value="mark-unreviewed">{labels.markUnreviewed}</option>
            <option value="set-primary-category">{labels.primaryCategory}</option>
            <option value="add-secondary-category">{labels.secondaryCategories}</option>
            <option value="add-tag">{labels.tags}</option>
          </select>
          {bulkAction.includes('category') && (
            <select
              value={bulkCategoryId}
              onChange={(event) => setBulkCategoryId(event.target.value)}
            >
              <option value="">{labels.primaryCategory}</option>
              {categories
                .filter((category) => category.status !== 'archived')
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          )}
          {bulkAction.includes('tag') && (
            <select value={bulkTagId} onChange={(event) => setBulkTagId(event.target.value)}>
              <option value="">{labels.tags}</option>
              {tags
                .filter((tag) => !tag.archivedAt)
                .map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
            </select>
          )}
          <button className="primary-button" type="button" onClick={() => void runBulkAction()}>
            {labels.applyFilters}
          </button>
        </div>
      )}
      <div className="ledger-layout">
        <section className="ledger-list" aria-busy={loading}>
          <div className="ledger-list-heading">
            <span>{labels.date}</span>
            <span>{labels.descriptionField}</span>
            <span>{labels.amount}</span>
            <span>{labels.category}</span>
          </div>
          {items.map((item) => (
            <div
              className={`ledger-row${selected?.id === item.id ? ' ledger-row-selected' : ''}`}
              key={item.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelected(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelected(item);
              }}
            >
              <label className="ledger-select" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() =>
                    setSelectedIds((current) =>
                      current.includes(item.id)
                        ? current.filter((id) => id !== item.id)
                        : [...current, item.id],
                    )
                  }
                />
                {item.bookingDate}
              </label>
              <span>
                <strong>{item.userDescription || item.importedDescription}</strong>
                <small>{item.accountName}</small>
              </span>
              <span className={item.direction === 'credit' ? 'amount-credit' : ''}>
                {displayAmount(item.amount, item.currencyCode)}
              </span>
              <span>{item.primaryCategory?.name || labels.uncategorised}</span>
            </div>
          ))}
          {!loading && !items.length && <p className="empty-note">{labels.empty}</p>}
          <div className="ledger-pagination">
            <button
              className="text-button"
              type="button"
              disabled={offset === 0}
              onClick={() => {
                const next = Math.max(0, offset - 25);
                setOffset(next);
                void load(next);
              }}
            >
              {labels.previous}
            </button>
            <span>{page.total}</span>
            <button
              className="text-button"
              type="button"
              disabled={!page.hasMore}
              onClick={() => {
                const next = offset + 25;
                setOffset(next);
                void load(next);
              }}
            >
              {labels.next}
            </button>
          </div>
        </section>
        <aside className="ledger-detail">
          {!selected ? (
            <p className="empty-note">{labels.details}</p>
          ) : (
            <>
              <p className="panel-kicker">{selected.bookingDate}</p>
              <h2>{displayAmount(selected.amount, selected.currencyCode)}</h2>
              <p className="detail-source">
                {selected.importedDescription} · {selected.institutionName}
              </p>
              <a
                className="text-button"
                href={`/${locale}/rules?fromTransaction=${encodeURIComponent(selected.id)}`}
              >
                {labels.createRuleFromTransaction ?? 'Create rule from this transaction'}
              </a>
              <form className="ledger-form" onSubmit={saveMetadata}>
                <label>
                  {labels.userDescription}
                  <input name="userDescription" defaultValue={selected.userDescription || ''} />
                </label>
                <label>
                  {labels.counterparty}
                  <input name="userCounterparty" defaultValue={selected.userCounterparty || ''} />
                </label>
                <label>
                  {labels.note}
                  <textarea name="userNote" defaultValue={selected.userNote || ''} rows={3} />
                </label>
                <label className="check-row">
                  <input name="reviewed" type="checkbox" defaultChecked={selected.reviewed} />
                  {selected.reviewed ? labels.reviewed : labels.notReviewed}
                </label>
                <button className="primary-button" type="submit">
                  {labels.saveDetails}
                </button>
              </form>
              <form className="ledger-form" onSubmit={saveClassification}>
                <label>
                  {labels.primaryCategory}
                  <select
                    name="primaryCategoryId"
                    defaultValue={selected.primaryCategory?.id || ''}
                  >
                    <option value="">{labels.uncategorised}</option>
                    {categories
                      .filter((category) => category.status !== 'archived')
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {labels.secondaryCategories}
                  <select
                    name="secondaryCategoryIds"
                    multiple
                    defaultValue={selected.secondaryCategories.map((category) => category.id)}
                  >
                    {categories
                      .filter((category) => category.status !== 'archived')
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  {labels.tags}
                  <select name="tagIds" multiple defaultValue={selected.tags.map((tag) => tag.id)}>
                    {tags
                      .filter((tag) => !tag.archivedAt)
                      .map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary-button" type="submit">
                  {labels.saveClassification}
                </button>
              </form>
              <form className="ledger-form" onSubmit={saveMerchant}>
                <label>
                  {labels.merchant ?? 'Merchant'}
                  <select name="merchantId" defaultValue={selected.merchantId ?? ''}>
                    <option value="">{labels.unassigned ?? 'Unassigned'}</option>
                    {merchants
                      .filter((merchant) => merchant.status === 'active')
                      .map((merchant) => (
                        <option key={merchant.id} value={merchant.id}>
                          {merchant.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary-button" type="submit">
                  {labels.saveMerchant ?? 'Save merchant'}
                </button>
              </form>
              <section className="ledger-splits" aria-labelledby="transaction-splits-title">
                <h3 id="transaction-splits-title">{labels.splits ?? 'Splits'}</h3>
                <p className="form-note">
                  {labels.splitHint ?? 'Split amounts must exactly equal the parent amount.'}
                </p>
                {!splitDrafts.length && !splitHasSavedSet && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      setSplitDrafts([
                        {
                          amount: selected.amount,
                          currencyCode: selected.currencyCode,
                          description: '',
                          primaryCategoryId: '',
                          secondaryCategoryIds: [],
                          tagIds: [],
                          note: '',
                        },
                      ])
                    }
                  >
                    {labels.startSplitting ?? 'Start splitting'}
                  </button>
                )}
                {splitDrafts.map((split, index) => (
                  <div className="split-editor-row" key={`${selected.id}-${index}`}>
                    <label>
                      {labels.amount}
                      <input
                        inputMode="decimal"
                        value={split.amount}
                        onChange={(event) =>
                          setSplitDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, amount: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      {labels.descriptionField}
                      <input
                        value={split.description}
                        onChange={(event) =>
                          setSplitDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, description: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      {labels.primaryCategory}
                      <select
                        value={split.primaryCategoryId}
                        onChange={(event) =>
                          setSplitDrafts((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, primaryCategoryId: event.target.value }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">{labels.uncategorised}</option>
                        {categories
                          .filter((category) => category.status !== 'archived')
                          .map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setSplitDrafts((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      {labels.remove ?? 'Remove'}
                    </button>
                  </div>
                ))}
                {(splitDrafts.length > 0 || splitHasSavedSet) && (
                  <div className="row-actions">
                    {splitDrafts.length < 50 && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setSplitDrafts((current) => [
                            ...current,
                            {
                              amount: '0',
                              currencyCode: selected.currencyCode,
                              description: '',
                              primaryCategoryId: '',
                              secondaryCategoryIds: [],
                              tagIds: [],
                              note: '',
                            },
                          ])
                        }
                      >
                        {labels.addSplit ?? 'Add split'}
                      </button>
                    )}
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void saveSplits()}
                    >
                      {labels.saveSplits ?? 'Save splits'}
                    </button>
                    {splitHasSavedSet && (
                      <span className="form-note">{labels.splitSaved ?? 'Split set saved'}</span>
                    )}
                  </div>
                )}
              </section>
              {advanced && (
                <details className="ledger-advanced">
                  <summary>{labels.advanced}</summary>
                  <p>{selected.rawDescription}</p>
                  <p>
                    {selected.sourceType} · {selected.id}
                  </p>
                </details>
              )}
            </>
          )}
        </aside>
      </div>
      {showViews && (
        <div className="workflow-dialog-backdrop" role="presentation">
          <div
            className="workflow-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-views-title"
          >
            <button
              className="text-button dialog-close"
              autoFocus
              type="button"
              onClick={() => setShowViews(false)}
            >
              {labels.close ?? 'Close'}
            </button>
            <h2 id="saved-views-title">{labels.savedViews ?? 'Saved views'}</h2>
            {savedViews.map((view) => (
              <div className="management-row" key={view.id}>
                <div>
                  <strong>{view.name}</strong>
                  {view.isDefault && <p>{labels.defaultView ?? 'Default'}</p>}
                </div>
                <div className="row-actions">
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void manageView(view.id, 'default')}
                  >
                    {labels.setDefault ?? 'Set default'}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void manageView(view.id, 'rename')}
                  >
                    {labels.rename ?? 'Rename'}
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void manageView(view.id, 'delete')}
                  >
                    {labels.delete ?? 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
