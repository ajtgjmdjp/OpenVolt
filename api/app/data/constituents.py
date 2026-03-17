"""Static constituent lists for major indices.

In production, these should come from official sources (JPX, S&P Global, etc.)
or the user's japan-finance-codes project. These are approximate top-N lists
for MVP/demo purposes.
"""

# Nikkei 225 top 30 by weight (price-weighted, approximate)
NIKKEI225_TOP30 = {
    "9983.T": "Fast Retailing",
    "8035.T": "Tokyo Electron",
    "6857.T": "Advantest",
    "9984.T": "SoftBank Group",
    "4063.T": "Shin-Etsu Chemical",
    "6762.T": "TDK",
    "6098.T": "Recruit Holdings",
    "4568.T": "Daiichi Sankyo",
    "6367.T": "Daikin Industries",
    "7203.T": "Toyota Motor",
    "6758.T": "Sony Group",
    "6861.T": "Keyence",
    "6501.T": "Hitachi",
    "7741.T": "HOYA",
    "6902.T": "Denso",
    "9433.T": "KDDI",
    "8306.T": "MUFG",
    "6645.T": "Omron",
    "4543.T": "Terumo",
    "6954.T": "Fanuc",
    "7267.T": "Honda Motor",
    "9432.T": "NTT",
    "4519.T": "Chugai Pharmaceutical",
    "6971.T": "Kyocera",
    "8766.T": "Tokio Marine",
    "6503.T": "Mitsubishi Electric",
    "2802.T": "Ajinomoto",
    "7974.T": "Nintendo",
    "3382.T": "Seven & i Holdings",
    "4911.T": "Shiseido",
}

# S&P 500 top 30 by market cap (approximate)
SP500_TOP30 = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "AMZN": "Amazon",
    "GOOGL": "Alphabet",
    "META": "Meta Platforms",
    "BRK-B": "Berkshire Hathaway",
    "LLY": "Eli Lilly",
    "AVGO": "Broadcom",
    "JPM": "JPMorgan Chase",
    "TSLA": "Tesla",
    "UNH": "UnitedHealth",
    "V": "Visa",
    "XOM": "Exxon Mobil",
    "MA": "Mastercard",
    "COST": "Costco",
    "PG": "Procter & Gamble",
    "JNJ": "Johnson & Johnson",
    "HD": "Home Depot",
    "ABBV": "AbbVie",
    "WMT": "Walmart",
    "NFLX": "Netflix",
    "CRM": "Salesforce",
    "BAC": "Bank of America",
    "ORCL": "Oracle",
    "CVX": "Chevron",
    "MRK": "Merck",
    "KO": "Coca-Cola",
    "AMD": "AMD",
    "PEP": "PepsiCo",
}

# TOPIX top 30 (market-cap weighted, approximate)
TOPIX_TOP30 = {
    "7203.T": "Toyota Motor",
    "8306.T": "MUFG",
    "6758.T": "Sony Group",
    "6861.T": "Keyence",
    "8035.T": "Tokyo Electron",
    "6501.T": "Hitachi",
    "7741.T": "HOYA",
    "9432.T": "NTT",
    "4063.T": "Shin-Etsu Chemical",
    "9984.T": "SoftBank Group",
    "6902.T": "Denso",
    "8766.T": "Tokio Marine",
    "9433.T": "KDDI",
    "4568.T": "Daiichi Sankyo",
    "6098.T": "Recruit Holdings",
    "8316.T": "SMFG",
    "8058.T": "Mitsubishi Corp",
    "6367.T": "Daikin Industries",
    "7267.T": "Honda Motor",
    "4519.T": "Chugai Pharmaceutical",
    "8001.T": "ITOCHU",
    "6503.T": "Mitsubishi Electric",
    "8031.T": "Mitsui & Co",
    "4502.T": "Takeda Pharmaceutical",
    "6857.T": "Advantest",
    "7974.T": "Nintendo",
    "6762.T": "TDK",
    "9983.T": "Fast Retailing",
    "3382.T": "Seven & i Holdings",
    "6954.T": "Fanuc",
}

CONSTITUENTS = {
    "nikkei225": NIKKEI225_TOP30,
    "sp500": SP500_TOP30,
    "topix": TOPIX_TOP30,
}


def get_constituents(index_id: str) -> tuple[list[str], dict[str, str]]:
    """Get constituent tickers and names for an index.

    Returns:
        (tickers: list[str], names: dict[str, str])
    """
    data = CONSTITUENTS.get(index_id, {})
    tickers = list(data.keys())
    return tickers, data
