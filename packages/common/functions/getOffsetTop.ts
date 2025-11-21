export const getOffsetTop = (container: HTMLElement, el: HTMLElement) => {
  let y = 0;
  let n: HTMLElement | null = el;

  while (n && n !== container) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }

  return y;
};
