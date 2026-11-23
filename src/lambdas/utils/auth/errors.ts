export function getErrorName(error: unknown): string | undefined {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name: string }).name);
  }
  return undefined;
}
