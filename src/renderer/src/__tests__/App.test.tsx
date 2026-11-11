import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { App } from '../App'

describe('<App /> Component', () => {
  beforeEach(() => {
    window.api = {
      platform: 'win32',
      version: '0.1.0'
    }
  })

  it('renders application title and quiet instrument badge', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: /AURA DESK/i })).toBeInTheDocument()
    expect(screen.getByText(/Quiet Instrument · v0\.1\.0/i)).toBeInTheDocument()
  })

  it('renders platform information from window.api', () => {
    render(<App />)

    expect(screen.getByText(/Платформа:/i)).toBeInTheDocument()
    expect(screen.getByText('win32')).toBeInTheDocument()
  })

  it('displays initial idle session status', () => {
    render(<App />)

    expect(screen.getByText(/Очікування \(Сесія вимкнена\)/i)).toBeInTheDocument()
  })

  it('renders session action buttons in disabled state initially', () => {
    render(<App />)

    const startBtn = screen.getByRole('button', { name: /Почати сесію/i })
    const pauseBtn = screen.getByRole('button', { name: /Пауза/i })
    const stopBtn = screen.getByRole('button', { name: /Зупинити/i })

    expect(startBtn).toBeDisabled()
    expect(pauseBtn).toBeDisabled()
    expect(stopBtn).toBeDisabled()
  })
})
