export interface ResponsePage {
  total: number;
  page: number;
  pageSize: number;
}

export function createResponsePage(total: number, page: number, pageSize: number): ResponsePage {
  return {
    total,
    page,
    pageSize,
  };
}
