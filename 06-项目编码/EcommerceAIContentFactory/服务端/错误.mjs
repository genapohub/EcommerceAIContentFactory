export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function assert(condition, message, status = 400, code) {
  if (!condition) throw new AppError(message, status, code);
}

export function publicError(error) {
  if (error instanceof AppError) return error;
  return new AppError('处理未完成，请检查服务状态后重试。', 500, 'INTERNAL_ERROR');
}
