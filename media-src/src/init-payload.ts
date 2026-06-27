import type { HostMessage } from '../../src/protocol'

// The init/re-init payload: the `update` message body minus the discriminant.
// initVditor is also called with a synthesised `{ content }` fallback and a merged
// re-init object, neither of which carries `command`. Shared by main.ts and the
// extracted edit-sync / finish-init / message-handler modules (task 152 items 1+2)
// so an options/wiki rename in protocol.ts propagates as a compile error everywhere.
export type InitPayload = Omit<
  Extract<HostMessage, { command: 'update' }>,
  'command'
>
