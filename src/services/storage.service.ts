import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

export const STORAGE_BUCKETS = {
  publicAssets: 'scalesafe-public-assets',
  privateFiles: 'scalesafe-private-files',
  legacyFiles: 'scalesafe-files',
} as const;

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24;

async function ensureBucket(params: {
  name: string;
  isPublic: boolean;
  fileSizeLimit: number;
  allowedMimeTypes?: string[] | null;
}): Promise<void> {
  const supabase = getSupabase();
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;

  const existing = buckets?.find((b: any) => b.name === params.name);
  const optionsWithMime = {
    public: params.isPublic,
    fileSizeLimit: params.fileSizeLimit,
    allowedMimeTypes: params.allowedMimeTypes ?? null,
  } as any;
  const optionsWithoutMime = {
    public: params.isPublic,
    fileSizeLimit: params.fileSizeLimit,
  } as any;

  if (!existing) {
    const { error } = await supabase.storage.createBucket(params.name, optionsWithMime);
    if (error) throw error;
    logger.info({ bucket: params.name, public: params.isPublic }, 'Storage bucket created');
    return;
  }

  const { error } = await supabase.storage.updateBucket(params.name, optionsWithMime);
  if (error) {
    const retry = await supabase.storage.updateBucket(params.name, optionsWithoutMime);
    if (retry.error) throw retry.error;
  }
  logger.info({ bucket: params.name, public: params.isPublic }, 'Storage bucket verified');
}

async function createPrivateSignedUrl(path: string, expiresInSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKETS.privateFiles)
    .createSignedUrl(path, expiresInSeconds);

  if (!error && data?.signedUrl) return data.signedUrl;

  const { data: legacyData, error: legacyError } = await supabase.storage
    .from(STORAGE_BUCKETS.legacyFiles)
    .createSignedUrl(path, expiresInSeconds);

  if (!legacyError && legacyData?.signedUrl) return legacyData.signedUrl;
  throw error || legacyError || new Error(`Unable to create signed URL for ${path}`);
}

export const storageService = {
  async ensureStorageBuckets(): Promise<void> {
    await ensureBucket({
      name: STORAGE_BUCKETS.publicAssets,
      isPublic: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });

    await ensureBucket({
      name: STORAGE_BUCKETS.privateFiles,
      isPublic: false,
      fileSizeLimit: 16 * 1024 * 1024,
      allowedMimeTypes: null,
    });

    try {
      const supabase = getSupabase();
      const { data: buckets } = await supabase.storage.listBuckets();
      const legacy = buckets?.find((b: any) => b.name === STORAGE_BUCKETS.legacyFiles);
      if (legacy) {
        logger.info(
          { bucket: STORAGE_BUCKETS.legacyFiles, public: (legacy as any).public },
          'Legacy storage bucket left unchanged for read compatibility',
        );
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Could not inspect legacy storage bucket');
    }
  },

  async uploadPublicAsset(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from(STORAGE_BUCKETS.publicAssets)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) throw error;

    const { data } = supabase.storage
      .from(STORAGE_BUCKETS.publicAssets)
      .getPublicUrl(path);

    return data.publicUrl;
  },

  async uploadPrivateFile(path: string, buffer: Buffer, contentType: string): Promise<string> {
    const supabase = getSupabase();
    const { error } = await supabase.storage
      .from(STORAGE_BUCKETS.privateFiles)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) throw error;

    return createPrivateSignedUrl(path);
  },

  async createPrivateSignedUrl(path: string, expiresInSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
    return createPrivateSignedUrl(path, expiresInSeconds);
  },

  async downloadPrivateFileWithLegacy(path: string): Promise<{ buffer: Buffer; bucket: string }> {
    const supabase = getSupabase();

    const privateResult = await supabase.storage
      .from(STORAGE_BUCKETS.privateFiles)
      .download(path);

    if (!privateResult.error && privateResult.data) {
      return {
        buffer: Buffer.from(await privateResult.data.arrayBuffer()),
        bucket: STORAGE_BUCKETS.privateFiles,
      };
    }

    const legacyResult = await supabase.storage
      .from(STORAGE_BUCKETS.legacyFiles)
      .download(path);

    if (!legacyResult.error && legacyResult.data) {
      return {
        buffer: Buffer.from(await legacyResult.data.arrayBuffer()),
        bucket: STORAGE_BUCKETS.legacyFiles,
      };
    }

    throw privateResult.error || legacyResult.error || new Error(`Unable to download ${path}`);
  },
};
