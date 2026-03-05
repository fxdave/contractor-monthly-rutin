import { ImapFlow, type MailboxObject } from "imapflow";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface MailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface AttachmentQuery {
  from: string;
  attachmentPrefix: string;
  downloadDir: string;
}

interface PendingDownload {
  uid: number;
  filename: string;
  part: string;
}

export class MailService {
  constructor(private config: MailConfig) {}

  async downloadAttachments(query: AttachmentQuery): Promise<string[]> {
    mkdirSync(query.downloadDir, { recursive: true });

    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: true,
      auth: {
        user: this.config.user,
        pass: this.config.password,
      },
      logger: {
        debug: () => {},
        info: (msg: object) => console.log(`[IMAP] ${(msg as { msg: string }).msg}`),
        warn: (msg: object) => console.warn(`[IMAP] ${(msg as { msg: string }).msg}`),
        error: (msg: object) => console.error(`[IMAP] ${(msg as { msg: string }).msg}`),
      },
    });

    client.on("error", (err: Error) => {
      throw new Error(`IMAP connection error (${this.config.host}): ${err.message}`);
    });

    const savedFiles: string[] = [];

    try {
      await client.connect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to connect to ${this.config.host}:${this.config.port} — check host, port, and credentials. (${message})`
      );
    }

    try {
      console.log("[IMAP] Opening INBOX...");
      const lock = await client.getMailboxLock("INBOX");
      const mailbox = client.mailbox as MailboxObject;
      console.log(`[IMAP] INBOX opened (${mailbox.exists} messages)`);

      try {
        console.log(`[IMAP] Searching for emails from: ${query.from}`);
        const uids = await client.search({ from: query.from }, { uid: true });

        if (!uids || uids.length === 0) {
          console.log("[IMAP] No matching emails found");
          return savedFiles;
        }

        console.log(`[IMAP] Found ${uids.length} matching emails`);

        // Phase 1: collect attachment info from message structures
        const pending: PendingDownload[] = [];
        const uidRange = uids.join(",");
        const messages = client.fetch(uidRange, { bodyStructure: true, uid: true }, { uid: true });

        for await (const msg of messages) {
          const parts = this.findAttachmentParts(msg.bodyStructure, query.attachmentPrefix);

          for (const part of parts) {
            const filePath = join(query.downloadDir, part.filename);
            if (existsSync(filePath)) {
              console.log(`[IMAP] Skipping (exists): ${part.filename}`);
              continue;
            }
            pending.push({ uid: msg.uid, ...part });
          }
        }

        if (pending.length === 0) {
          console.log("[IMAP] No new attachments to download");
          return savedFiles;
        }

        // Phase 2: download attachments one by one (after fetch iterator is done)
        console.log(`[IMAP] Downloading ${pending.length} attachment(s)...`);

        for (const item of pending) {
          console.log(`[IMAP] Downloading: ${item.filename} (UID ${item.uid}, part ${item.part})`);
          const { content } = await client.download(String(item.uid), item.part, { uid: true });

          const chunks: Buffer[] = [];
          for await (const chunk of content) {
            chunks.push(Buffer.from(chunk));
          }

          const filePath = join(query.downloadDir, item.filename);
          writeFileSync(filePath, Buffer.concat(chunks));
          console.log(`[IMAP] Saved: ${item.filename}`);
          savedFiles.push(filePath);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }

    return savedFiles;
  }

  private findAttachmentParts(
    structure: unknown,
    prefix: string
  ): { filename: string; part: string }[] {
    const results: { filename: string; part: string }[] = [];

    const walk = (node: Record<string, unknown>) => {
      const children = node.childNodes as Record<string, unknown>[] | undefined;
      if (children) {
        for (const child of children) {
          walk(child);
        }
        return;
      }

      const disposition = node.dispositionParameters as Record<string, string> | undefined;
      const params = node.parameters as Record<string, string> | undefined;
      const filename = disposition?.filename ?? params?.name;

      if (filename && filename.startsWith(prefix)) {
        results.push({ filename, part: node.part as string });
      }
    };

    walk(structure as Record<string, unknown>);
    return results;
  }
}
