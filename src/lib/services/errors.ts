export class AppError extends Error {
  constructor(
    public code: "no_period" | "locked" | "invalid" | "not_found" | "period_exists",
    message: string,
  ) {
    super(message);
  }
}
