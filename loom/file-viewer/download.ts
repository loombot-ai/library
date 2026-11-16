/**
 * THE DOWNLOAD: a file's BYTES, asked for by the page in CHUNKS, over the app's own channel.
 *
 * **A FRAME IS JSON, AND A FILE'S BYTES ARE NOT** (card t20261028-002834-882a) — so `show` answers a file it
 * cannot render with a TOKEN instead of a body, and the page asks for the bytes it needs.
 *
 * **AND THEY TRAVEL UNDER THE APP'S OWN PATH** (card t20261028-010039-c7a2). This used to be a listener on
 * `127.0.0.1:0` serving `GET /d/<token>`, and that URL is resolved by THE BROWSER'S machine: on a phone
 * reached through the relay, `127.0.0.1` is the phone, so pressing Download did nothing at all (Xiaohu's
 * phone, 2026-10-28). The app channel is CARRIED by the relay — `relay/peer/sw_source.ts` `CARRIED_FRAME`
 * carries `/d/<device>/a/<session>/app/<name>/...` — so a page asking its own `__event` reaches this file
 * from anywhere, with no loombot change and no second mechanism.
 *
 * **THE LOOPBACK ROUTE IS DELETED RATHER THAN KEPT BESIDE IT**, and that is a decision, not an oversight:
 * it could only ever serve a browser on the machine the server runs on, and the app's own channel serves
 * exactly that case as well. One path, and it is the one a phone can reach.
 *
 * WHAT A CHUNK IS FOR (measured 2026-10-28). An answer is base64 in a JSON frame — 4/3 of the bytes, in
 * memory at every hop — and it has to fit each hop between this app and the page:
 *   - the app's own socket (Deno `WebSocket`): 1, 8, 16 and 32 MiB messages all carried, so no cap found
 *     there and it is not the limit;
 *   - the relay's peer wire: `MAX_MESSAGE_BYTES` = 16 MiB, ONE message;
 *   - the device tunnel: `MAX_PAYLOAD_BYTES` = 1 MiB per frame (`relay/protocol.ts`), a body being chunked
 *     across frames (`relay/peer_http.ts`).
 * So one answer of `CHUNK_BYTES` is 699,052 base64 bytes: ONE tunnel frame, ~4% of the relay's message cap,
 * with room for the JSON around it. A 9 MB file is 18 answers, which is what makes a several-MB download
 * work instead of failing at a cap nobody can see.
 *
 * THE PAGE NEVER NAMES A PATH HERE, which is this app's one rule everywhere: a frame carries a TOKEN minted
 * for a path the server had already decided to show, and `chunk` resolves only a token it minted itself. A
 * page cannot ask this app for a file it was not already given, and a token it invents is refused.
 *
 * ONE DOWNLOAD ON SHOW AT A TIME — `rendered`'s twin in viewer_mcp.ts, and for its reason: what the page may
 * ask for is what is IN FRONT OF THE PERSON. `offer` withdraws the token before it, so a page holding an
 * older frame's token is refused rather than handed a file from a view nobody is looking at. A download
 * still running when the agent shows something else therefore stops there and SAYS SO, which the page turns
 * into "the viewer showed another file — press Download again" rather than a short file saved as if whole.
 */

import { Refused, toBase64 } from "./files.ts";

/**
 * THE SENTENCE A DOWNLOAD FRAME CARRIES, in Xiaohu's own words (card t20261028-002834-882a): the page
 * prints it verbatim where the file would have been, and the menu's Download row is the control it names.
 */
export const DOWNLOAD_SENTENCE = "file cannot be displayed. Click download to download.";

/**
 * THE MOST BYTES ONE ANSWER CARRIES — the whole of the reasoning is in this file's header, and the number is
 * the one measured there: 512 KiB is 699,052 base64 bytes, which is one device-tunnel frame (1 MiB).
 */
export const CHUNK_BYTES = 512 * 1024;

/** What a frame carries for a file that cannot be rendered: where the bytes are, and in what sizes. */
export interface Download {
  /** Minted per offer, good for exactly as long as it is the one on show. Never a path. */
  token: string;
  /** The file's own name: what the browser saves it as. */
  name: string;
  /** The file's size on disk, as the frame states it. */
  bytes: number;
  /** The most bytes one answer carries, so a page need not guess and need not learn it by failing. */
  chunk: number;
}

/** One answer to `download {token, offset}`: the bytes at that offset, base64, and whether it was the end. */
export interface Chunk {
  token: string;
  offset: number;
  /** How many bytes this answer carries — shorter than `CHUNK_BYTES` at the end of a file. */
  length: number;
  /** Those bytes, base64. 4/3 the length, which is why `length` travels beside it. */
  b64: string;
  /** True when this answer reached the end of the file: the page stops asking here and nowhere else. */
  done: boolean;
}

/** Everything a `downloadable` show frame says — the ONE place the download's shape is decided. */
export interface DownloadView {
  kind: "download";
  bytes: number;
  /** Why it cannot be rendered (`files.ts` `Undisplayable.reason`), where a no-edit reason goes. */
  noEdit: string;
  downloadable: true;
  note: string;
  download: Download;
}

export interface DownloadRoute {
  /** Offer `abs`'s bytes, and withdraw whatever was offered before. */
  offer(abs: string, name: string, bytes: number): Download;
  /** The frame fields for a file at `abs` this viewer could not render, and the offer that goes with them. */
  view(abs: string, reason: string, bytes: number): DownloadView;
  /** The bytes at `offset` of the ONE file on offer, in one answer. Throws `Refused` for anything else. */
  chunk(token: string, offset: number): Promise<Chunk>;
}

export function downloadRoute(opts: { log?: (line: string) => void } = {}): DownloadRoute {
  const log = opts.log ?? (() => {});
  /**
   * THE ONE FILE A PAGE MAY ASK FOR: the token it is offered under and the path it was minted for. One
   * slot rather than a map, because "one download on show at a time" is the rule and a map would be a
   * second way to hold a file nobody is looking at.
   */
  let held: { token: string; abs: string } | null = null;

  const offer = (abs: string, name: string, bytes: number): Download => {
    held = { token: crypto.randomUUID().replaceAll("-", ""), abs };
    return { token: held.token, name, bytes, chunk: CHUNK_BYTES };
  };

  async function chunk(token: string, offset: number): Promise<Chunk> {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Refused("refused: a download chunk names a whole offset at or past zero");
    }
    const at = offset;
    if (held === null || held.token !== token) {
      throw new Refused(
        "refused: this viewer is not offering that download any more" +
          (held === null
            ? " — nothing is on show"
            : " — press Download again for what is on show now"),
      );
    }
    const abs = held.abs;
    const name = abs.slice(abs.lastIndexOf("/") + 1);
    let size: number;
    try {
      size = (await Deno.stat(abs)).size;
    } catch (e) {
      throw new Refused(
        "refused: " + name + " is gone: " + (e instanceof Error ? e.message : String(e)),
      );
    }
    if (at > size) {
      throw new Refused(
        "refused: " + name + " is " + size + " bytes, so there is nothing at offset " + at,
      );
    }
    const want = Math.min(CHUNK_BYTES, size - at);
    const bytes = new Uint8Array(want);
    let got = 0;
    if (want > 0) {
      const file = await Deno.open(abs, { read: true }).catch(() => null);
      if (file === null) throw new Refused("refused: " + name + " could not be opened");
      try {
        await file.seek(at, Deno.SeekMode.Start);
        while (got < want) {
          // A SHORT READ IS THE END, not an error: `done` below says so, and the page stops on it rather
          // than on a number it counted itself.
          const n = await file.read(bytes.subarray(got));
          if (n === null) break;
          got += n;
        }
      } finally {
        file.close();
      }
      if (got === 0) throw new Refused("refused: " + name + " could not be read");
    }
    // SHORT OR AT THE END: a file that shrank while it was being downloaded ends here rather than leaving
    // the page asking for offsets that never arrive.
    const done = got < want || at + got >= size;
    log(
      "download: " + abs + " — " + got + " bytes at " + at + " of " + size +
        (done ? " (last)" : ""),
    );
    return {
      token: held.token,
      offset: at,
      length: got,
      b64: toBase64(bytes.subarray(0, got)),
      done,
    };
  }

  return {
    offer,
    view(abs, reason, bytes) {
      const name = abs.slice(abs.lastIndexOf("/") + 1);
      return {
        kind: "download",
        bytes,
        noEdit: reason,
        downloadable: true,
        note: DOWNLOAD_SENTENCE,
        download: offer(abs, name, bytes),
      };
    },
    chunk,
  };
}
