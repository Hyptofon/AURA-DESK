import { contextBridge } from 'electron'

export interface AuraApi {
  platform: string
  version: string
}

const api: AuraApi = {
  platform: process.platform,
  version: '0.1.0'
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('Failed to expose api to main world', error)
  }
} else {
  // @ts-expect-error fallback when context isolation is disabled
  window.api = api
}
