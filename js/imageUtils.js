const MAX_WIDTH = 800;
const JPEG_QUALITY = 0.6;
const MAX_SIZE_BYTES = 500 * 1024;

export async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = calcSize(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let quality = JPEG_QUALITY;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        while (dataUrl.length > MAX_SIZE_BYTES && quality > 0.2) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function calcSize(w, h) {
  if (w <= MAX_WIDTH && h <= MAX_WIDTH) return { width: w, height: h };
  if (w >= h) {
    return { width: MAX_WIDTH, height: Math.round(h * MAX_WIDTH / w) };
  } else {
    return { width: Math.round(w * MAX_WIDTH / h), height: MAX_WIDTH };
  }
}

export async function fileToBase64(file) {
  return compressImage(file);
}

export function base64Size(base64) {
  const withoutHeader = base64.split(',')[1] || base64;
  return Math.ceil(withoutHeader.length * 3 / 4);
}
