import type { AuraApi } from './index'

declare global {
  interface Window {
    api: AuraApi
  }
}
