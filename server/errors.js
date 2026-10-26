export class AppError extends Error {
  constructor(message, { status = 400, code = 'app_error', detail = '' } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export class GitError extends AppError {
  constructor(message, { args = [], stderr = '', stdout = '', exitCode = null } = {}) {
    const clean = String(stderr || '').trim();
    super(clean || message, {
      status: 400,
      code: 'git_error',
      detail: clean,
    });
    this.name = 'GitError';
    this.args = args;
    this.stderr = clean;
    this.stdout = stdout;
    this.exitCode = exitCode;
  }
}
