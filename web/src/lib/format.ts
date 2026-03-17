/**
 * Currency and number formatting utilities.
 * Adapts to the current preset's currency.
 */

let _currency = 'JPY'

export function setCurrency(currency: string) {
  _currency = currency
}

export function getCurrency(): string {
  return _currency
}

const currencySymbols: Record<string, string> = {
  JPY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
}

/**
 * Format a monetary value with currency symbol.
 * Handles large numbers with compact notation to prevent overflow.
 */
export function formatMoney(value: number): string {
  const symbol = currencySymbols[_currency] || _currency + ' '
  const absVal = Math.abs(value)
  const sign = value < 0 ? '-' : ''

  if (_currency === 'JPY') {
    // JPY: no decimals, use 万 for readability if large
    if (absVal >= 1_000_000_000) {
      return `${sign}${symbol}${(absVal / 100_000_000).toFixed(1)}B`
    }
    if (absVal >= 10_000_000) {
      return `${sign}${symbol}${(absVal / 10_000).toFixed(0)}万`
    }
    if (absVal >= 1_000_000) {
      return `${sign}${symbol}${(absVal / 10_000).toFixed(1)}万`
    }
    return `${sign}${symbol}${absVal.toLocaleString()}`
  }

  // USD/EUR/GBP: use K/M/B
  if (absVal >= 1_000_000_000) {
    return `${sign}${symbol}${(absVal / 1_000_000_000).toFixed(1)}B`
  }
  if (absVal >= 1_000_000) {
    return `${sign}${symbol}${(absVal / 1_000_000).toFixed(1)}M`
  }
  if (absVal >= 10_000) {
    return `${sign}${symbol}${(absVal / 1_000).toFixed(0)}K`
  }
  return `${sign}${symbol}${absVal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Format a percentage value.
 */
export function formatPct(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`
}
