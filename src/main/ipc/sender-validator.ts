export interface FrameLike {
  url?: string
  parent?: unknown | null
  top?: unknown
}

export interface WebContentsLike {
  id?: number
  mainFrame?: FrameLike | null
}

export interface IpcInvokeEventLike {
  sender?: unknown
  senderFrame?: FrameLike | null
}

export interface IpcSenderValidationContext {
  trustedWebContents: unknown
  trustedOrigin?: string
  isAllowedOrigin?: (url: string) => boolean
}

export interface IpcSenderValidator {
  validate(event: unknown): {
    valid: boolean
    errorCode?: 'UNAUTHORIZED_SENDER' | 'UNAUTHORIZED_FRAME'
    message?: string
  }
}

/**
 * Creates a strict fail-closed sender validator.
 * Rejects missing events, untrusted senders, missing or destroyed frames, empty URLs,
 * mismatched mainFrames, and untrusted origins.
 */
export function createSenderValidator(
  context: IpcSenderValidationContext
): IpcSenderValidator {
  if (!context || !context.trustedWebContents) {
    throw new Error('Security violation: IpcSenderValidationContext requires trustedWebContents')
  }

  return {
    validate(event: unknown) {
      if (!event || typeof event !== 'object') {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_SENDER',
          message: 'IPC invocation requires a valid event with authorized sender'
        }
      }

      const invokeEvent = event as IpcInvokeEventLike

      // 1. Verify sender webContents exists and matches trustedWebContents
      if (!invokeEvent.sender || invokeEvent.sender !== context.trustedWebContents) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_SENDER',
          message: 'IPC request originates from an untrusted or missing WebContents sender'
        }
      }

      // 2. Reject missing, null, or destroyed senderFrame (fail-closed)
      if (!invokeEvent.senderFrame) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation rejected: senderFrame is missing, null, or destroyed'
        }
      }

      const frame = invokeEvent.senderFrame

      // 3. Reject missing or empty frame URL
      if (!frame.url || typeof frame.url !== 'string' || frame.url.trim() === '') {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation rejected: senderFrame URL is missing or empty'
        }
      }

      // 4. Verify senderFrame matches trustedWebContents.mainFrame when available
      const trustedWebContents = context.trustedWebContents as WebContentsLike
      if (trustedWebContents.mainFrame !== undefined && trustedWebContents.mainFrame !== null) {
        if (frame !== trustedWebContents.mainFrame) {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_FRAME',
            message: 'IPC invocation rejected: senderFrame does not match trustedWebContents.mainFrame'
          }
        }
      }

      // 5. Verify top-level frame hierarchy (reject nested iframes)
      const isChildFrame = frame.parent !== null && frame.parent !== undefined
      const isNotTop = frame.top !== undefined && frame.top !== frame

      if (isChildFrame || isNotTop) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: 'IPC invocation from nested frame or iframe is prohibited'
        }
      }

      // 6. Verify frame origin if trustedOrigin is specified
      if (context.trustedOrigin) {
        try {
          const frameOrigin = new URL(frame.url).origin
          const expectedOrigin = new URL(context.trustedOrigin).origin
          if (frameOrigin !== expectedOrigin) {
            return {
              valid: false,
              errorCode: 'UNAUTHORIZED_FRAME',
              message: `IPC invocation from untrusted frame origin '${frameOrigin}'`
            }
          }
        } catch {
          return {
            valid: false,
            errorCode: 'UNAUTHORIZED_FRAME',
            message: 'Malformed frame URL in IPC event'
          }
        }
      }

      // 7. Verify frame URL against custom origin policy if provided
      if (context.isAllowedOrigin && !context.isAllowedOrigin(frame.url)) {
        return {
          valid: false,
          errorCode: 'UNAUTHORIZED_FRAME',
          message: `Frame URL '${frame.url}' rejected by origin policy`
        }
      }

      return { valid: true }
    }
  }
}
