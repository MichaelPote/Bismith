// Gallery ids, on their own so core/serialize.ts can check them without the client (and its import.meta.env, which
// tools/ under tsx don't have).

/** Gallery ids: 10 characters of a lowercase alphabet without look-alikes. */
export const GALLERY_ID = /^[a-z2-9]{10}$/;
