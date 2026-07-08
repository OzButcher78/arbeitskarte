// Shared IPC result envelope. The renderer's apiBridge/electronAPI wrappers
// interpret { status, headers, body } — mirroring an HTTP Response so call
// sites can stay platform-agnostic.
export type IpcResult = {
  status: number;
  headers?: Record<string, string>;
  body: Uint8Array | unknown;
};

export function jsonResult(status: number, data: unknown): IpcResult {
  return { status, headers: { 'Content-Type': 'application/json' }, body: data };
}
