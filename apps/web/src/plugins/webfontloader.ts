export async function loadFonts() {
  const webFontLoader = await import('webfontloader');

  webFontLoader.load({
    google: {
      families: [
        'Public+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap',
      ],
    },
  });
}

export default function () {
  loadFonts();
}
