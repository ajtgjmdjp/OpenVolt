/** Common market indices for overlay selection. */

export type IndexDef = {
  symbol: string
  label: string
  region: string
}

export const COMMON_INDICES: IndexDef[] = [
  { symbol: '^N225', label: 'Nikkei 225', region: 'JP' },
  { symbol: '1306.T', label: 'TOPIX ETF', region: 'JP' },
  { symbol: '^GSPC', label: 'S&P 500', region: 'US' },
  { symbol: '^DJI', label: 'Dow Jones', region: 'US' },
  { symbol: '^IXIC', label: 'NASDAQ Composite', region: 'US' },
  { symbol: '^FTSE', label: 'FTSE 100', region: 'UK' },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50', region: 'EU' },
  { symbol: '^HSI', label: 'Hang Seng', region: 'HK' },
  { symbol: '^AXJO', label: 'ASX 200', region: 'AU' },
  { symbol: '^KS11', label: 'KOSPI', region: 'KR' },
  { symbol: '000001.SS', label: 'SSE Composite', region: 'CN' },
]

/** Filter indices by partial match on label or symbol. */
export function filterIndices(query: string): IndexDef[] {
  if (!query.trim()) return COMMON_INDICES
  const q = query.toLowerCase()
  return COMMON_INDICES.filter(
    (idx) => idx.label.toLowerCase().includes(q) || idx.symbol.toLowerCase().includes(q) || idx.region.toLowerCase().includes(q)
  )
}
