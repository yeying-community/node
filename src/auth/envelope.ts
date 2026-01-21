export type Envelope<T> = {
  code: number;
  message: string;
  data: T | null;
  timestamp: number;
};

export function ok<T>(data: T): Envelope<T> {
  return {
    code: 0,
    message: 'ok',
    data,
    timestamp: Date.now(),
  };
}

export function fail(code: number, message: string): Envelope<null> {
  return {
    code,
    message,
    data: null,
    timestamp: Date.now(),
  };
}
