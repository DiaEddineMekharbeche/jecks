/**
 * `draco3dgltf` ships no types. glTF-Transform only needs the two module factories,
 * and it treats the returned modules as opaque, so this is the whole surface.
 */
declare module 'draco3dgltf' {
  export function createDecoderModule(options?: unknown): Promise<unknown>;
  export function createEncoderModule(options?: unknown): Promise<unknown>;
}
