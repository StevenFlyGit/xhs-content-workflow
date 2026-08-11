export type CardMedia = {
  id: string;
  storage: "indexeddb";
  blobKey: string;
  mimeType: string;
  width?: number;
  height?: number;
  crop?: { x: number; y: number; scale: number };
  updatedAt: string;
};

const DB_NAME = "xhs-compiler-media";
const DB_VERSION = 1;
const STORE_NAME = "blobs";
const SUPPORTED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("无法打开本地图片存储"));
  });
}

async function getImageSize(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("图片无法读取"));
      image.src = url;
    });
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function saveCardMedia(file: File): Promise<CardMedia> {
  if (!SUPPORTED_MEDIA_TYPES.has(file.type))
    throw new Error(
      "\u4ec5\u652f\u6301 JPEG\u3001PNG \u6216 WebP \u56fe\u7247",
    );
  if (file.size > 12 * 1024 * 1024) throw new Error("单张图片不能超过 12MB");
  const dimensions = await getImageSize(file);
  const blobKey = crypto.randomUUID();
  const database = await openMediaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(file, blobKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error("图片保存失败"));
      transaction.onabort = () =>
        reject(transaction.error || new Error("图片保存被取消"));
    });
  } finally {
    database.close();
  }
  return {
    id: crypto.randomUUID(),
    storage: "indexeddb",
    blobKey,
    mimeType: file.type,
    ...dimensions,
    updatedAt: new Date().toISOString(),
  };
}

export async function getCardMediaUrl(
  media?: CardMedia,
): Promise<string | undefined> {
  if (!media?.blobKey) return undefined;
  const database = await openMediaDatabase();
  try {
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(media.blobKey);
      request.onsuccess = () =>
        resolve(request.result instanceof Blob ? request.result : undefined);
      request.onerror = () =>
        reject(request.error || new Error("图片读取失败"));
    });
    return blob ? URL.createObjectURL(blob) : undefined;
  } finally {
    database.close();
  }
}

export async function deleteCardMedia(media?: CardMedia) {
  if (!media?.blobKey) return;
  const database = await openMediaDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(media.blobKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error || new Error("图片删除失败"));
    });
  } finally {
    database.close();
  }
}
