export type Book = {
  id: string;
  title: string;
  author: string;
  category: string;
  age: string;
  condition: string;
  owner: string;
  summary: string;
  available: boolean;
  offShelf: boolean;
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
  dueAt: string | null;
  borrowerLoanConfirmed: boolean;
  ownerLoanConfirmed: boolean;
  borrowerReturnConfirmed: boolean;
  ownerReturnConfirmed: boolean;
  renewalRequested: boolean;
  renewed: boolean;
  requestedAt: string;
};
export type Family = {
  id: string;
  displayName: string;
  children: {
    id: string;
    nickname: string;
    age: string;
    readingPreferences: string[];
  }[];
};

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
