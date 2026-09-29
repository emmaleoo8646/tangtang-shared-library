export type Book = {
  id: string;
  title: string;
  author: string;
  category: string;
  categoryOptionId: string | null;
  age: string;
  ageOptionId: string | null;
  condition: string;
  conditionOptionId: string;
  owner: string;
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
  id: string;
  bookId: string;
  bookTitle: string;
  owner: string;
  borrower: string;
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
  children: {
    id: string;
    nickname: string;
    age: string;
    ageOptionId: string;
    readingPreferences: string[];
  }[];
};

export type CatalogOption = { id: string; kind: "CATEGORY" | "AGE" | "CONDITION"; label: string; active: boolean; sortOrder: number };
export type OptionLists = { categories: CatalogOption[]; ages: CatalogOption[]; conditions: CatalogOption[] };

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
    throw new Error(
      value.message instanceof Array
        ? value.message.join("、")
        : value.message || `请求失败（${response.status}）`,
    );
  return value as T;
}
