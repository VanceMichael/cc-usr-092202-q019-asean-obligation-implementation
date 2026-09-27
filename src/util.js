// 领域错误：以稳定 code 供程序判定，message 仅用于人工阅读。
export class DomainError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    Object.assign(this, extra);
  }
}
