/* Files in the Android app. The app's WebView ignores <a download> on in-memory (blob:) files and
   can't share files with navigator.share, so the app writes the file to its cache
   (@capacitor/filesystem), then hands it to Android's share sheet (@capacitor/share) or saves it
   to the Gallery (@capacitor-community/media, the app's own "Senevon" album). None of this asks
   for a permission: the album lives in the app's media folder (Android/media/<app id>/), which
   the Gallery shows. The plugins load only in the app, never on the website. */
import { isNative } from "./native";

export { isNative };

const ALBUM = "Senevon";

function toBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

/** Write a blob to the app's cache; returns its file:// uri. */
async function cacheFile(blob: Blob, name: string) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
  return uri;
}

/** Android's share sheet with the file attached (WhatsApp, Instagram, Drive, Files…). */
export async function shareFileNative(blob: Blob, name: string, opts: { title?: string; text?: string } = {}) {
  const { Share } = await import("@capacitor/share");
  const uri = await cacheFile(blob, name);
  try {
    await Share.share({ title: opts.title, text: opts.text, files: [uri], dialogTitle: opts.title ?? "Share" });
  } catch (e) {
    // closing the sheet without picking anything is not an error
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

/** Save a video into the Gallery ("Senevon" album). */
export async function saveVideoToGallery(blob: Blob, name: string) {
  const { Media } = await import("@capacitor-community/media");
  const uri = await cacheFile(blob, name);
  const { path } = await Media.getAlbumsPath();
  const album = `${path}/${ALBUM}`;
  try {
    await Media.createAlbum({ name: ALBUM });
  } catch {
    /* already there */
  }
  await Media.saveVideo({ path: uri, albumIdentifier: album, fileName: name.replace(/\.[^.]+$/, "") });
}
