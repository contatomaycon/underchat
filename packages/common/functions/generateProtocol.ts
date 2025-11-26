export function generateProtocol(): string {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const randomArray = new Uint32Array(7);
  crypto.getRandomValues(randomArray);
  const randomDigits = Array.from(randomArray, (value) =>
    (value % 10).toString()
  ).join('');

  return `${year}${month}${day}${randomDigits}`;
}
