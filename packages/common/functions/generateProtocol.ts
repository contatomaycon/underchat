export function generateProtocol(): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const randomDigits = Array.from({ length: 7 }, () =>
    Math.floor(Math.random() * 10)
  ).join('');

  return `${year}${month}${day}${randomDigits}`;
}
