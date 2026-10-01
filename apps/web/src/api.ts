export type Book = {
  id: string;
  shopId: string;
  series: { id: string; name: string; summary: string } | null;
  seriesOrder: number | null;
  status: string;
  title: string;
  author: string;
  category: string;
  categoryOptionId: string | null;
  age: string;
  ageOptionId: string | null;
  condition: string;
  conditionOptionId: string;
  owner: string;
  ownerAvatarUrl?: string | null;
  summary: string;
  nonChildren: boolean;
  coverUrl: string | null;
  available: boolean;
  offShelf: boolean;
  editable: boolean;
  mine: boolean;
  tone: string;
};
export type Loan = {
  groupId: string | null;
  message: string;
  id: string;
  bookId: string;
  bookTitle: string;
  owner: string;
  ownerAvatarUrl?: string | null;
  borrower: string;
  borrowerAvatarUrl?: string | null;
  isOwner: boolean;
  stage: string;
  place: string;
  contactPhone: string | null;
  dueAt: string | null;
  borrowerLoanConfirmed: boolean;
  ownerLoanConfirmed: boolean;
  borrowerReturnConfirmed: boolean;
  ownerReturnConfirmed: boolean;
  renewalRequested: boolean;
  renewed: boolean;
  requestedAt: string;
  approvedAt: string | null;
  lentAt: string | null;
  returnedAt: string | null;
};
export type Family = {
  id: string;
  username: string | null;
  email: string;
  phone: string;
  phoneVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  children: {
    id: string;
    nickname: string;
    age: string;
    ageOptionId: string;
    readingPreferences: string[];
  }[];
};

export type CatalogOption = {
  id: string;
  kind: "CATEGORY" | "AGE" | "CONDITION";
  label: string;
  active: boolean;
  sortOrder: number;
};
export type OptionLists = {
  categories: CatalogOption[];
  ages: CatalogOption[];
  conditions: CatalogOption[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public unavailableIds: string[] = [],
  ) {
    super(message);
  }
}
export type BookPage = {
  items: Book[];
  total: number;
  page: number;
  pageSize: number;
};
export async function allBooks(path = "/books") {
  const items: Book[] = [];
  for (let page = 1; ; page++) {
    const result = await api<BookPage>(`${path}?page=${page}&pageSize=200`);
    items.push(...result.items);
    if (items.length >= result.total || !result.items.length) return items;
  }
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      value.message instanceof Array
        ? value.message.join("、")
        : value.message || `请求失败（${response.status}）`,
      response.status,
      value.unavailableIds ?? [],
    );
  return value as T;
}
