import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import axios from 'axios';
import { getSupabase } from '../clients/supabase.client';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { CanonicalEvidenceEvent, EvidenceConnectionRecord } from '../types/evidence-connector.types';
import { ValidationError } from '../utils/errors';
import { hashPayload } from '../utils/evidence-connector-security';
import { STORAGE_BUCKETS } from './storage.service';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv']);

function safeFilename(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 120);
  return cleaned || 'evidence-file';
}

function pendingStoragePath(locationId: string, connectionId: string, attachmentId: string, filename: string): string {
  return `external-evidence-pending/${locationId}/${connectionId}/${attachmentId}/${safeFilename(filename)}`;
}

function finalStoragePath(locationId: string, enrollmentId: string, eventId: string, attachmentId: string, filename: string): string {
  return `external-evidence/${locationId}/${enrollmentId}/${eventId}/${attachmentId}/${safeFilename(filename)}`;
}

function normalizedMime(value: string): string {
  return value.split(';')[0].trim().toLowerCase();
}

function validateMagic(buffer: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (mime === 'text/plain' || mime === 'text/csv') return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
  return false;
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:') || lower === '::';
}

function domainAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.toLowerCase();
  return allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function validateRemoteUrl(raw: string, connection: EvidenceConnectionRecord): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ValidationError('Attachment URL is invalid'); }
  if (url.protocol !== 'https:') throw new ValidationError('Attachment URL must use HTTPS');
  if (url.username || url.password) throw new ValidationError('Attachment URL cannot contain credentials');
  if (url.search || url.hash) throw new ValidationError('Attachment URL cannot contain query credentials; use the signed upload endpoint instead');
  if (!domainAllowed(url.hostname, connection.allowed_attachment_domains || [])) {
    throw new ValidationError('Attachment domain is not approved for this connection');
  }
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new ValidationError('Attachment URL resolves to a blocked network address');
  }
  return url;
}

async function upload(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const { error } = await getSupabase().storage
    .from(STORAGE_BUCKETS.privateFiles)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
}

async function downloadRemote(rawUrl: string, connection: EvidenceConnectionRecord): Promise<{ buffer: Buffer; mime: string; filename: string; safeSourceUrl: string }> {
  let current = await validateRemoteUrl(rawUrl, connection);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await axios.get<ArrayBuffer>(current.toString(), {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      timeout: 10_000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: { 'User-Agent': 'ScaleSafe-Evidence-Connector/1.0' },
    });
    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location || redirects === 3) throw new ValidationError('Attachment redirect could not be validated');
      current = await validateRemoteUrl(new URL(location, current).toString(), connection);
      continue;
    }
    const buffer = Buffer.from(response.data);
    if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new ValidationError('Attachment size is invalid');
    const mime = normalizedMime(String(response.headers['content-type'] || ''));
    if (!ALLOWED_TYPES.has(mime) || !validateMagic(buffer, mime)) throw new ValidationError('Attachment file type is not allowed or did not match its content');
    const filename = safeFilename(current.pathname.split('/').pop() || `evidence.${extensionForMime(mime)}`);
    return {
      buffer,
      mime,
      filename,
      safeSourceUrl: `${current.origin}${current.pathname}`,
    };
  }
  throw new ValidationError('Attachment could not be downloaded');
}

function extensionForMime(mime: string): string {
  return mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'text/csv' ? 'csv' : 'txt';
}

export const externalEvidenceAttachmentService = {
  async createSignedUpload(connection: EvidenceConnectionRecord, filenameInput: string, contentTypeInput: string) {
    const filename = safeFilename(filenameInput);
    const contentType = normalizedMime(contentTypeInput);
    if (!ALLOWED_TYPES.has(contentType)) throw new ValidationError('Attachment type is not allowed');
    const placeholder = await evidenceConnectorRepository.createAttachment({
      connection_id: connection.id,
      location_id: connection.location_id,
      original_filename: filename,
      content_type: contentType,
      validation_status: 'pending',
    });
    const path = pendingStoragePath(connection.location_id, connection.id, placeholder.id, filename);
    const { data, error } = await getSupabase().storage.from(STORAGE_BUCKETS.privateFiles).createSignedUploadUrl(path);
    if (error) {
      await evidenceConnectorRepository.updateAttachment(placeholder.id, { validation_status: 'rejected', validation_error: error.message });
      throw error;
    }
    await evidenceConnectorRepository.updateAttachment(placeholder.id, { storage_path: path });
    return { attachmentId: placeholder.id, uploadUrl: data.signedUrl, uploadToken: data.token, contentType, maxBytes: MAX_BYTES };
  },

  async validateUploaded(connection: EvidenceConnectionRecord, attachmentId: string, eventId: string, enrollmentId: string): Promise<any> {
    const row = await evidenceConnectorRepository.getAttachment(connection.id, attachmentId);
    if (!row || !row.storage_path) throw new ValidationError('Attachment was not prepared by this connection');
    if (row.event_id && row.event_id !== eventId) throw new ValidationError('Attachment is already assigned to another evidence event');
    if (row.event_id === eventId && row.validation_status === 'validated' && row.sha256) {
      return {
        id: row.id, storagePath: row.storage_path, filename: row.original_filename,
        contentType: row.content_type, byteSize: row.byte_size, sha256: row.sha256,
      };
    }
    const finalPath = finalStoragePath(connection.location_id, enrollmentId, eventId, row.id, row.original_filename || 'evidence-file');
    let downloadPath = row.storage_path;
    let { data, error } = await getSupabase().storage.from(STORAGE_BUCKETS.privateFiles).download(downloadPath);
    if ((error || !data) && downloadPath !== finalPath) {
      downloadPath = finalPath;
      ({ data, error } = await getSupabase().storage.from(STORAGE_BUCKETS.privateFiles).download(downloadPath));
    }
    if (error || !data) throw new ValidationError('Uploaded attachment is not available');
    const buffer = Buffer.from(await data.arrayBuffer());
    const mime = normalizedMime(row.content_type || data.type || '');
    if (buffer.length === 0 || buffer.length > MAX_BYTES || !ALLOWED_TYPES.has(mime) || !validateMagic(buffer, mime)) {
      await evidenceConnectorRepository.updateAttachment(row.id, { validation_status: 'rejected', validation_error: 'File size or content validation failed', event_id: eventId });
      throw new ValidationError('Uploaded attachment failed validation');
    }
    if (downloadPath !== finalPath) {
      const { error: moveError } = await getSupabase().storage.from(STORAGE_BUCKETS.privateFiles).move(downloadPath, finalPath);
      if (moveError) throw new ValidationError('Uploaded attachment could not be finalized');
    }
    await evidenceConnectorRepository.updateAttachment(row.id, {
      event_id: eventId,
      storage_path: finalPath,
      byte_size: buffer.length,
      sha256: hashPayload(buffer),
      validation_status: 'validated',
      validation_error: null,
      validated_at: new Date().toISOString(),
    });
    return { id: row.id, storagePath: finalPath, filename: row.original_filename, contentType: mime, byteSize: buffer.length, sha256: hashPayload(buffer) };
  },

  async preserveRemote(connection: EvidenceConnectionRecord, rawUrl: string, filenameInput: string | undefined, eventId: string, enrollmentId: string): Promise<any> {
    const downloaded = await downloadRemote(rawUrl, connection);
    const filename = safeFilename(filenameInput || downloaded.filename);
    const placeholder = await evidenceConnectorRepository.createAttachment({
      connection_id: connection.id,
      event_id: eventId,
      location_id: connection.location_id,
      source_url: downloaded.safeSourceUrl,
      original_filename: filename,
      content_type: downloaded.mime,
      byte_size: downloaded.buffer.length,
      sha256: hashPayload(downloaded.buffer),
      validation_status: 'pending',
    });
    const path = finalStoragePath(connection.location_id, enrollmentId, eventId, placeholder.id, filename);
    try {
      await upload(path, downloaded.buffer, downloaded.mime);
      await evidenceConnectorRepository.updateAttachment(placeholder.id, {
        storage_path: path,
        validation_status: 'validated',
        validated_at: new Date().toISOString(),
      });
      return { id: placeholder.id, storagePath: path, filename, contentType: downloaded.mime, byteSize: downloaded.buffer.length, sha256: hashPayload(downloaded.buffer) };
    } catch (err: any) {
      await evidenceConnectorRepository.updateAttachment(placeholder.id, { validation_status: 'rejected', validation_error: err.message });
      throw err;
    }
  },

  async processEventAttachments(connection: EvidenceConnectionRecord, eventId: string, enrollmentId: string, event: CanonicalEvidenceEvent): Promise<any[]> {
    const output: any[] = [];
    for (const attachment of event.attachments || []) {
      if (attachment.attachment_id) {
        output.push(await this.validateUploaded(connection, attachment.attachment_id, eventId, enrollmentId));
      } else if (attachment.url) {
        output.push(await this.preserveRemote(connection, attachment.url, attachment.filename, eventId, enrollmentId));
      }
    }
    return output;
  },
};
