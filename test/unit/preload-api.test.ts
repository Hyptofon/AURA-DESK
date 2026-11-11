import { describe, it, expect } from 'vitest'
import type { AuraApi } from '../../src/preload/index'

describe('AuraApi contract', () => {
  it('validates shape of AuraApi', () => {
    const mockApi: AuraApi = {
      platform: 'win32',
      version: '0.1.0'
    }

    expect(mockApi.platform).toBe('win32')
    expect(mockApi.version).toBe('0.1.0')
    expect(mockApi.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('handles custom platform string', () => {
    const mockApi: AuraApi = {
      platform: 'darwin',
      version: '0.1.0'
    }

    expect(mockApi.platform).toBe('darwin')
  })
})
