export function generateProtocol(): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const randomDigit = Math.floor(Math.random() * 10).toString();

  return `${year}${day}${month}${hours}${minutes}${seconds}${randomDigit}`;
}
